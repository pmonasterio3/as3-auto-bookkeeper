/**
 * Review Actions Service
 *
 * Handles executing review actions via n8n webhooks and updating database.
 * All QBO posting goes through n8n - no direct API calls from UI.
 */

import { supabase } from '@/lib/supabase'
import {
  callApprovalWebhook,
  type HumanApprovalRequest,
} from '@/features/attention/approvalWebhook'
import type { ReviewItem, ReviewAction, CorrectionData, ActionResult } from '../types'

/**
 * Execute a review action on an item
 *
 * Routes to appropriate handler based on action type and item source
 */
export async function executeReviewAction(
  item: ReviewItem,
  action: ReviewAction,
  data?: CorrectionData
): Promise<ActionResult> {
  switch (action) {
    case 'approve':
    case 'correct_and_approve':
      return handleApproval(item, action, data)

    case 'reject':
      return handleRejection(item)

    case 'reimburse_check':
    case 'reimburse_zelle':
    case 'reimburse_payroll':
      return handleReimbursement(item, action)

    case 'exclude':
      return handleExclusion(item)

    case 'retry':
      return handleRetry(item)

    case 'investigate':
    case 'resolve':
    case 'ignore':
      return handleErrorStatusChange(item, action)

    case 'create_vendor_rule':
      return handleCreateVendorRule(item, data)

    case 'resubmit':
      return handleResubmit(item, data)

    case 'delete':
      return handleDelete(item)

    default:
      return { success: false, message: `Unknown action: ${action}` }
  }
}

/**
 * Handle approve and correct_and_approve for flagged/low_confidence/orphan items
 */
async function handleApproval(
  item: ReviewItem,
  action: ReviewAction,
  data?: CorrectionData
): Promise<ActionResult> {
  // Use corrections if provided, otherwise use predictions
  const finalCategory =
    data?.category || item.predictions?.category || 'Office Supplies & Software'
  const finalState = data?.state || item.predictions?.state || 'Admin'
  const wasCorrect = action === 'correct_and_approve'

  // Build webhook payload for n8n
  const payload: HumanApprovalRequest = {
    expense_queue_id: item.sourceId,
    action: wasCorrect ? 'correct' : 'approve',
    zoho_expense_id: item.zoho?.expenseId || '',
    is_reimbursement: false,
    final_category: finalCategory,
    final_state: finalState,
    bank_transaction_id: item.bankTransaction?.id,
    vendor_name: item.vendor,
    amount: item.amount,
    expense_date: item.date,
    receipt_url: item.receipt?.url,
    paid_through: item.zoho?.paidThrough || undefined,
  }

  // Call n8n webhook
  const result = await callApprovalWebhook(payload)

  if (!result.success) {
    return {
      success: false,
      message: result.message || 'QBO posting failed',
    }
  }

  // Update source table status
  await updateSourceTableStatus(item, wasCorrect ? 'corrected' : 'approved', {
    qbo_purchase_id: result.qbo_transaction_id,
    reviewed_at: new Date().toISOString(),
    corrections: wasCorrect ? { category: finalCategory, state: finalState } : undefined,
  })

  // Log correction to categorization_history if corrected
  if (wasCorrect) {
    await logCorrection(item, finalCategory, finalState)
  }

  // Create vendor rule if requested
  if (data?.createVendorRule && item.vendor) {
    await createVendorRule(item.vendor, finalCategory, finalState)
  }

  return {
    success: true,
    message: `Expense approved and posted to QBO`,
    data: { qbo_transaction_id: result.qbo_transaction_id },
  }
}

/**
 * Handle rejection
 */
async function handleRejection(item: ReviewItem): Promise<ActionResult> {
  await updateSourceTableStatus(item, 'rejected', {
    reviewed_at: new Date().toISOString(),
  })

  return {
    success: true,
    message: 'Item rejected',
  }
}

/**
 * Handle reimbursement (creates QBO Bill)
 */
async function handleReimbursement(
  item: ReviewItem,
  action: ReviewAction
): Promise<ActionResult> {
  const methodMap: Record<string, 'check' | 'zelle' | 'payroll'> = {
    reimburse_check: 'check',
    reimburse_zelle: 'zelle',
    reimburse_payroll: 'payroll',
  }
  const method = methodMap[action] || 'check'

  const payload: HumanApprovalRequest = {
    expense_queue_id: item.sourceId,
    action: 'approve',
    zoho_expense_id: item.zoho?.expenseId || '',
    is_reimbursement: true,
    final_category: item.predictions?.category || 'Office Supplies & Software',
    final_state: item.predictions?.state || 'Admin',
    reimbursement_method: method,
    employee_name: item.submitter?.name,
    employee_email: item.submitter?.email,
    vendor_name: item.vendor,
    amount: item.amount,
    expense_date: item.date,
    receipt_url: item.receipt?.url,
    paid_through: item.zoho?.paidThrough || undefined,
  }

  const result = await callApprovalWebhook(payload)

  if (!result.success) {
    return { success: false, message: result.message || 'Failed to create QBO Bill' }
  }

  await updateSourceTableStatus(item, 'approved', {
    reimbursement_method: method,
    reimbursed_at: new Date().toISOString(),
    qbo_bill_id: result.qbo_transaction_id,
    qbo_vendor_id: result.qbo_vendor_id,
  })

  return {
    success: true,
    message: `Reimbursement processed via ${method}`,
    data: { qbo_bill_id: result.qbo_transaction_id },
  }
}

/**
 * Handle exclusion (for orphan bank transactions)
 */
async function handleExclusion(item: ReviewItem): Promise<ActionResult> {
  if (item.sourceTable !== 'bank_transactions') {
    return { success: false, message: 'Can only exclude bank transactions' }
  }

  const { error } = await supabase
    .from('bank_transactions')
    .update({
      status: 'excluded',
      orphan_processed_at: new Date().toISOString(),
    })
    .eq('id', item.sourceId)

  if (error) {
    return { success: false, message: error.message }
  }

  return {
    success: true,
    message: 'Transaction excluded from processing',
  }
}

/**
 * Handle retry for processing errors and stuck expenses
 *
 * For stuck zoho_expenses: Calls the manual_reset_expense() database function
 * to reset status to 'pending' so the queue controller will pick it up again.
 *
 * For processing_errors: Marks as retried for n8n to pick up.
 */
async function handleRetry(item: ReviewItem): Promise<ActionResult> {
  // Handle stuck zoho_expenses
  if (item.sourceTable === 'zoho_expenses' && item.itemType === 'stuck') {
    // Reset expense to pending status for reprocessing
    const { error } = await supabase
      .from('zoho_expenses')
      .update({
        status: 'pending',
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', item.sourceId)

    if (error) {
      return { success: false, message: `Failed to reset expense: ${error.message}` }
    }

    return {
      success: true,
      message: 'Expense reset to pending - queue will retry automatically',
    }
  }

  // Handle processing_errors
  if (item.sourceTable === 'processing_errors') {
    const { error } = await supabase
      .from('processing_errors')
      .update({
        status: 'retried',
        retry_count: (item.errorDetails?.retryCount || 0) + 1,
      })
      .eq('id', item.sourceId)

    if (error) {
      return { success: false, message: error.message }
    }

    return {
      success: true,
      message: 'Queued for retry',
    }
  }

  return { success: false, message: 'Can only retry processing errors or stuck expenses' }
}

/**
 * Handle status changes for processing errors
 */
async function handleErrorStatusChange(
  item: ReviewItem,
  action: ReviewAction
): Promise<ActionResult> {
  if (item.sourceTable !== 'processing_errors') {
    return { success: false, message: 'Invalid action for this item type' }
  }

  const statusMap: Record<string, string> = {
    investigate: 'investigating',
    resolve: 'resolved',
    ignore: 'ignored',
  }
  const newStatus = statusMap[action] || 'investigating'

  const { error } = await supabase
    .from('processing_errors')
    .update({
      status: newStatus,
      resolved_at: ['resolved', 'ignored'].includes(newStatus)
        ? new Date().toISOString()
        : null,
    })
    .eq('id', item.sourceId)

  if (error) {
    return { success: false, message: error.message }
  }

  return {
    success: true,
    message: `Status updated to ${newStatus}`,
  }
}

/**
 * Create a vendor rule for auto-categorization
 */
async function handleCreateVendorRule(
  item: ReviewItem,
  data?: CorrectionData
): Promise<ActionResult> {
  if (!item.vendor) {
    return { success: false, message: 'No vendor to create rule for' }
  }

  return createVendorRule(
    item.vendor,
    data?.category || item.predictions?.category || 'Office Supplies & Software',
    data?.state || item.predictions?.state || 'Admin'
  )
}

/**
 * Handle resubmit for zoho_expenses - reset to pending for reprocessing
 *
 * This is specific to the queue-based architecture v3.0. When a user
 * corrects a flagged expense and resubmits, we reset the status to 'pending'
 * so the queue controller will pick it up again and trigger n8n processing.
 *
 * If a manual bank transaction match is provided, we:
 * 1. Set bank_transaction_id on the zoho_expense
 * 2. Update the bank_transaction status to 'matched' with matched_expense_id
 */
async function handleResubmit(
  item: ReviewItem,
  data?: CorrectionData
): Promise<ActionResult> {
  if (item.sourceTable !== 'zoho_expenses') {
    return { success: false, message: 'Can only resubmit zoho_expenses items' }
  }

  // Build update object - reset for reprocessing
  const updates: Record<string, unknown> = {
    status: 'pending',
    processing_attempts: 0,
    processing_started_at: null,
    last_error: null,
    updated_at: new Date().toISOString(),
  }

  // Apply corrections if provided
  if (data?.state) {
    updates.state_tag = data.state
  }
  if (data?.category) {
    updates.category_name = data.category
  }

  // Handle manual bank transaction matching
  if (data?.bankTransactionId) {
    updates.bank_transaction_id = data.bankTransactionId
    updates.match_confidence = 100 // Manual match = 100% confidence

    // Update the bank_transactions table to mark as matched
    const { error: bankError } = await supabase
      .from('bank_transactions')
      .update({
        status: 'matched',
        matched_expense_id: item.sourceId,
        matched_at: new Date().toISOString(),
        matched_by: 'human', // CHECK constraint only allows: 'agent', 'human', NULL
      })
      .eq('id', data.bankTransactionId)

    if (bankError) {
      console.error('Failed to update bank transaction:', bankError)
      return { success: false, message: `Failed to link bank transaction: ${bankError.message}` }
    }
  }

  const { error } = await supabase
    .from('zoho_expenses')
    .update(updates)
    .eq('id', item.sourceId)

  if (error) {
    return { success: false, message: `Failed to resubmit: ${error.message}` }
  }

  // Create vendor rule if requested
  if (data?.createVendorRule && item.vendor) {
    await createVendorRule(
      item.vendor,
      data.category || item.predictions?.category || 'Office Supplies & Software',
      data.state || item.predictions?.state || 'Admin'
    )
  }

  // Log correction if changes were made
  if (data?.category || data?.state || data?.bankTransactionId) {
    await logCorrection(
      item,
      data.category || item.predictions?.category || 'Office Supplies & Software',
      data.state || item.predictions?.state || 'Admin'
    )
  }

  const message = data?.bankTransactionId
    ? 'Expense matched to bank transaction and resubmitted for processing'
    : 'Expense resubmitted for processing'

  return {
    success: true,
    message,
  }
}

/**
 * Handle deletion of zoho_expenses items
 *
 * Used when an expense was:
 * - Paid through another account (not a corporate card)
 * - Uploaded by mistake
 * - A duplicate that shouldn't be processed
 *
 * This permanently removes the record from zoho_expenses and any
 * associated receipt from storage.
 */
async function handleDelete(item: ReviewItem): Promise<ActionResult> {
  if (item.sourceTable !== 'zoho_expenses') {
    return { success: false, message: 'Can only delete zoho_expenses items' }
  }

  // First, get the expense to check for receipt storage path
  const { data: expense, error: fetchError } = await supabase
    .from('zoho_expenses')
    .select('receipt_storage_path')
    .eq('id', item.sourceId)
    .single()

  if (fetchError) {
    console.error('Failed to fetch expense for deletion:', fetchError)
    return { success: false, message: `Failed to fetch expense: ${fetchError.message}` }
  }

  // Delete receipt from storage if it exists
  if (expense?.receipt_storage_path) {
    const { error: storageError } = await supabase.storage
      .from('expense-receipts')
      .remove([expense.receipt_storage_path])

    if (storageError) {
      console.warn('Failed to delete receipt from storage:', storageError)
      // Continue with deletion even if storage cleanup fails
    }
  }

  // Delete the expense record
  const { error: deleteError } = await supabase
    .from('zoho_expenses')
    .delete()
    .eq('id', item.sourceId)

  if (deleteError) {
    console.error('Failed to delete expense:', deleteError)
    return { success: false, message: `Failed to delete expense: ${deleteError.message}` }
  }

  return {
    success: true,
    message: 'Expense deleted successfully',
  }
}

/**
 * Update the source table status
 */
async function updateSourceTableStatus(
  item: ReviewItem,
  status: string,
  additionalData?: Record<string, unknown>
): Promise<void> {
  const { sourceTable, sourceId } = item

  // Build update object based on table
  const updates: Record<string, unknown> = { status }

  // Add table-specific timestamp fields
  if (sourceTable === 'zoho_expenses') {
    updates.processed_at = new Date().toISOString()
    updates.updated_at = new Date().toISOString()
  }

  // Add additional data if provided
  if (additionalData) {
    Object.assign(updates, additionalData)
  }

  const { error } = await supabase.from(sourceTable).update(updates).eq('id', sourceId)

  if (error) {
    console.error(`Failed to update ${sourceTable}:`, error)
    throw new Error(`Failed to update status: ${error.message}`)
  }
}

/**
 * Log correction to categorization_history for AI learning
 */
async function logCorrection(
  item: ReviewItem,
  finalCategory: string,
  finalState: string
): Promise<void> {
  const { error } = await supabase.from('categorization_history').insert({
    source: item.bankTransaction?.source || 'unknown',
    transaction_date: item.date,
    vendor_raw: item.vendor,
    amount: item.amount,
    predicted_category: item.predictions?.category || null,
    predicted_state: item.predictions?.state || null,
    predicted_confidence: item.predictions?.confidence || 0,
    final_category: finalCategory,
    final_state: finalState,
    was_corrected: true,
    zoho_expense_id: item.zoho?.expenseId || null,
    bank_transaction_id: item.bankTransaction?.id || null,
    created_at: new Date().toISOString(),
  })

  if (error) {
    console.error('Failed to log correction:', error)
    // Don't throw - this is a non-critical operation
  }
}

/**
 * Create or update a vendor rule
 */
async function createVendorRule(
  vendorPattern: string,
  category: string,
  state: string
): Promise<ActionResult> {
  const { error } = await supabase.from('vendor_rules').upsert(
    {
      vendor_pattern: vendorPattern.toLowerCase().trim(),
      default_category: category,
      default_state: state,
      confidence: 90,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'vendor_pattern' }
  )

  if (error) {
    return { success: false, message: `Failed to create vendor rule: ${error.message}` }
  }

  return {
    success: true,
    message: `Vendor rule created for "${vendorPattern}"`,
  }
}
