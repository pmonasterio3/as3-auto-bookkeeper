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

    case 'save_corrections':
      return handleSaveCorrections(item, data)

    case 'edit_match':
      return handleEditMatch(item, data)

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
    // Delete incomplete categorization_history to prevent false duplicate detection
    if (item.zoho?.expenseId) {
      await supabase
        .from('categorization_history')
        .delete()
        .eq('zoho_expense_id', item.zoho.expenseId)
        .is('qbo_transaction_id', null)
    }

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
 * Map state tag to state code
 */
function mapStateTagToCode(stateTag: string | null | undefined): string {
  const stateMap: Record<string, string> = {
    'California': 'CA',
    'Texas': 'TX',
    'Colorado': 'CO',
    'Washington': 'WA',
    'New Jersey': 'NJ',
    'Florida': 'FL',
    'Montana': 'MT',
    'Other': 'NC',
    'Admin': 'NC',
  }
  return stateMap[stateTag || ''] || 'NC'
}

/**
 * Map bank transaction source to paid_through value
 * Bank transaction source is the SOURCE OF TRUTH for payment method
 */
function mapBankSourceToPaidThrough(source: string | null | undefined): string {
  const sourceMap: Record<string, string> = {
    'amex': 'AMEX Business',
    'wf_as3dt': 'Wells Fargo Debit',
    'wf_as3int': 'Wells Fargo AS3 International',
  }
  return sourceMap[source || ''] || 'Unknown'
}

/**
 * Human Approved Processor endpoint
 * Uses Supabase Edge Function as proxy to avoid CORS issues
 * Edge Function -> Lambda (server-to-server)
 */
const HUMAN_APPROVED_URL = import.meta.env.VITE_HUMAN_APPROVED_URL ||
  'https://fzwozzqwyzztadxgjryl.supabase.co/functions/v1/human-approved-proxy'

/**
 * Handle resubmit for zoho_expenses - calls AWS Lambda Human Approved Processor
 *
 * When a human has reviewed and matched an expense, we call the Lambda which:
 * 1. Fetches expense from Supabase
 * 2. Applies any human corrections
 * 3. Creates/finds vendor in QBO
 * 4. Posts Purchase to QBO
 * 5. Uploads receipt to QBO
 * 6. Creates Monday.com subitem (for COS expenses)
 * 7. Updates bank_transaction and zoho_expense statuses
 */
async function handleResubmit(
  item: ReviewItem,
  data?: CorrectionData
): Promise<ActionResult> {
  if (item.sourceTable !== 'zoho_expenses') {
    return { success: false, message: 'Can only resubmit zoho_expenses items' }
  }

  // Require bank transaction match for resubmit
  if (!data?.bankTransactionId) {
    return { success: false, message: 'Bank transaction match is required for resubmit' }
  }

  // Fetch the bank transaction to get corrected amount
  const { data: bankTxn, error: fetchBankError } = await supabase
    .from('bank_transactions')
    .select('id, amount, description, transaction_date, source')
    .eq('id', data.bankTransactionId)
    .single()

  if (fetchBankError || !bankTxn) {
    console.error('Failed to fetch bank transaction:', fetchBankError)
    return { success: false, message: `Failed to fetch bank transaction: ${fetchBankError?.message}` }
  }

  // Use corrections if provided, otherwise use item data
  const finalStateTag = data?.state || item.predictions?.state || 'Admin'
  const finalState = mapStateTagToCode(finalStateTag)
  const finalDate = data?.date || item.date

  // Use bank transaction amount (source of truth)
  const finalAmount = bankTxn.amount

  // Build Lambda payload - simplified format per Lambda handler.py
  const payload = {
    expense_id: item.sourceId,
    bank_transaction_id: data.bankTransactionId,
    state: finalState,
    corrections: {
      ...(Math.abs(finalAmount - item.amount) > 0.01 && { amount: finalAmount }),
      ...(data?.date && data.date !== item.date && { expense_date: data.date }),
    },
  }

  console.log('Calling Lambda Human Approved Processor:', payload)

  // Update expense status to 'processing' while we wait
  const finalCategory = data?.category || item.predictions?.category || 'Office Supplies & Software'
  const finalPaidThrough = mapBankSourceToPaidThrough(bankTxn.source)

  await supabase
    .from('zoho_expenses')
    .update({
      status: 'processing',
      bank_transaction_id: data.bankTransactionId,
      match_confidence: 100,
      amount: finalAmount,
      original_amount: Math.abs(finalAmount - item.amount) > 0.01 ? item.amount : null,
      expense_date: finalDate,
      category_name: finalCategory,
      state_tag: finalStateTag,
      paid_through: finalPaidThrough,
      updated_at: new Date().toISOString(),
    })
    .eq('id', item.sourceId)

  try {
    // Call the Human Approved Processor via Edge Function proxy
    const response = await fetch(HUMAN_APPROVED_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
      },
      body: JSON.stringify(payload),
    })

    const result = await response.json()

    if (!response.ok || !result.success) {
      const errorMessage = result.error || result.message || `HTTP ${response.status}`
      console.error('Lambda failed:', response.status, result)

      // Revert status to flagged on failure
      await supabase
        .from('zoho_expenses')
        .update({
          status: 'flagged',
          last_error: `Lambda failed: ${errorMessage}`,
          updated_at: new Date().toISOString(),
        })
        .eq('id', item.sourceId)

      return {
        success: false,
        message: `Failed to process: ${errorMessage}`,
      }
    }

    // Lambda succeeded - update with QBO purchase ID
    await supabase
      .from('zoho_expenses')
      .update({
        status: 'posted',
        qbo_purchase_id: result.qbo_purchase_id,
        processed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', item.sourceId)

    // Create vendor rule if requested
    if (data?.createVendorRule && item.vendor) {
      await createVendorRule(item.vendor, finalCategory, finalState)
    }

    const amountWasCorrected = Math.abs(finalAmount - item.amount) > 0.01
    let message = result.message || 'Expense posted to QBO successfully'
    if (amountWasCorrected) {
      message = `Posted to QBO (amount corrected: $${item.amount.toFixed(2)} → $${finalAmount.toFixed(2)})`
    }

    return {
      success: true,
      message,
      data: { qbo_purchase_id: result.qbo_purchase_id },
    }
  } catch (error) {
    console.error('Lambda error:', error)

    // Revert status to flagged on error
    await supabase
      .from('zoho_expenses')
      .update({
        status: 'flagged',
        last_error: `Network error: ${error instanceof Error ? error.message : 'Unknown'}`,
        updated_at: new Date().toISOString(),
      })
      .eq('id', item.sourceId)

    return {
      success: false,
      message: `Network error: ${error instanceof Error ? error.message : 'Failed to connect'}`,
    }
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
 * Handle save_corrections for submitters
 *
 * Saves corrections (category, state) to the expense but does NOT resubmit.
 * The expense stays flagged for an admin/bookkeeper to review and resubmit.
 * This allows submitters to fix their own mistakes without posting to QBO.
 */
async function handleSaveCorrections(
  item: ReviewItem,
  data?: CorrectionData
): Promise<ActionResult> {
  if (item.sourceTable !== 'zoho_expenses') {
    return { success: false, message: 'Can only save corrections on zoho_expenses items' }
  }

  // Build update object with only the corrections
  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  }

  // Apply corrections if provided
  if (data?.category) {
    updates.category_name = data.category
  }
  if (data?.state) {
    updates.state_tag = data.state
  }
  if (data?.date) {
    updates.expense_date = data.date
  }

  // If bank transaction was selected, save it but don't process
  if (data?.bankTransactionId) {
    updates.bank_transaction_id = data.bankTransactionId
    updates.match_confidence = 100 // Human matched = 100% confidence
  }

  // Store a note that corrections were made by submitter
  updates.corrections = {
    saved_at: new Date().toISOString(),
    saved_by: 'submitter',
    category: data?.category || null,
    state: data?.state || null,
    date: data?.date || null,
    bank_transaction_id: data?.bankTransactionId || null,
  }

  const { error } = await supabase
    .from('zoho_expenses')
    .update(updates)
    .eq('id', item.sourceId)

  if (error) {
    console.error('Failed to save corrections:', error)
    return { success: false, message: `Failed to save corrections: ${error.message}` }
  }

  return {
    success: true,
    message: 'Corrections saved. An admin will review and resubmit.',
  }
}

/**
 * Handle edit_match for posted items - edit and reprocess through Lambda
 *
 * This is used when a match was already posted to QBO but needs correction.
 * The Lambda will:
 * 1. Process with human-provided corrections
 * 2. Create new QBO Purchase (note: does NOT void previous - manual cleanup needed)
 * 3. Update statuses
 *
 * IMPORTANT: The previous QBO transaction should be manually voided in QBO.
 */
async function handleEditMatch(
  item: ReviewItem,
  data?: CorrectionData
): Promise<ActionResult> {
  if (item.sourceTable !== 'zoho_expenses') {
    return { success: false, message: 'Can only edit matches for zoho_expenses items' }
  }

  // Require bank transaction match for edit
  const bankTxnId = data?.bankTransactionId || item.bankTransaction?.id
  if (!bankTxnId) {
    return { success: false, message: 'Bank transaction match is required' }
  }

  // Fetch the full expense data to get previous QBO ID
  const { data: expenseData, error: fetchExpenseError } = await supabase
    .from('zoho_expenses')
    .select('qbo_purchase_id, expense_date, category_name, state_tag')
    .eq('id', item.sourceId)
    .single()

  if (fetchExpenseError || !expenseData) {
    console.error('Failed to fetch expense:', fetchExpenseError)
    return { success: false, message: `Failed to fetch expense: ${fetchExpenseError?.message}` }
  }

  const previousQboId = expenseData.qbo_purchase_id

  // Fetch the bank transaction
  const { data: bankTxn, error: fetchBankError } = await supabase
    .from('bank_transactions')
    .select('id, amount, description, transaction_date, source')
    .eq('id', bankTxnId)
    .single()

  if (fetchBankError || !bankTxn) {
    console.error('Failed to fetch bank transaction:', fetchBankError)
    return { success: false, message: `Failed to fetch bank transaction: ${fetchBankError?.message}` }
  }

  // Use corrections if provided, otherwise use expense data
  const finalCategory = data?.category || expenseData.category_name || 'Office Supplies & Software'
  const finalStateTag = data?.state || expenseData.state_tag || 'Admin'
  const finalState = mapStateTagToCode(finalStateTag)
  const finalDate = data?.date || expenseData.expense_date
  const finalAmount = bankTxn.amount
  const finalPaidThrough = mapBankSourceToPaidThrough(bankTxn.source)

  // Build Lambda payload
  const payload = {
    expense_id: item.sourceId,
    bank_transaction_id: bankTxnId,
    state: finalState,
    corrections: {
      ...(Math.abs(finalAmount - item.amount) > 0.01 && { amount: finalAmount }),
      ...(data?.date && data.date !== item.date && { expense_date: data.date }),
    },
  }

  console.log('Calling Lambda Human Approved Processor for edit_match:', payload)

  // Update expense status to 'processing' and store correction info
  await supabase
    .from('zoho_expenses')
    .update({
      status: 'processing',
      bank_transaction_id: bankTxnId,
      match_confidence: 100,
      amount: finalAmount,
      original_amount: Math.abs(finalAmount - item.amount) > 0.01 ? item.amount : null,
      expense_date: finalDate,
      category_name: finalCategory,
      state_tag: finalStateTag,
      paid_through: finalPaidThrough,
      corrections: {
        edited_at: new Date().toISOString(),
        edited_by: 'human',
        previous_qbo_purchase_id: previousQboId,
        category: data?.category || null,
        state: data?.state || null,
        date: data?.date || null,
        bank_transaction_id: bankTxnId,
      },
      updated_at: new Date().toISOString(),
    })
    .eq('id', item.sourceId)

  try {
    // Call the Human Approved Processor via Edge Function proxy
    const response = await fetch(HUMAN_APPROVED_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
      },
      body: JSON.stringify(payload),
    })

    const result = await response.json()

    if (!response.ok || !result.success) {
      const errorMessage = result.error || result.message || `HTTP ${response.status}`
      console.error('Lambda failed:', response.status, result)

      // Revert status to 'posted' on failure (it was already posted before)
      await supabase
        .from('zoho_expenses')
        .update({
          status: 'posted',
          last_error: `Edit failed: ${errorMessage}`,
          updated_at: new Date().toISOString(),
        })
        .eq('id', item.sourceId)

      return {
        success: false,
        message: `Failed to process edit: ${errorMessage}`,
      }
    }

    // Lambda succeeded - update with new QBO purchase ID
    await supabase
      .from('zoho_expenses')
      .update({
        status: 'posted',
        qbo_purchase_id: result.qbo_purchase_id,
        processed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', item.sourceId)

    // Create vendor rule if requested
    if (data?.createVendorRule && item.vendor) {
      await createVendorRule(item.vendor, finalCategory, finalState)
    }

    return {
      success: true,
      message: previousQboId
        ? `Match edited - new QBO #${result.qbo_purchase_id} (please void old #${previousQboId} in QBO)`
        : `Match edited and posted to QBO #${result.qbo_purchase_id}`,
      data: { qbo_purchase_id: result.qbo_purchase_id },
    }
  } catch (error) {
    console.error('Lambda error:', error)

    // Revert status to 'posted' on error
    await supabase
      .from('zoho_expenses')
      .update({
        status: 'posted',
        last_error: `Network error: ${error instanceof Error ? error.message : 'Unknown'}`,
        updated_at: new Date().toISOString(),
      })
      .eq('id', item.sourceId)

    return {
      success: false,
      message: `Network error: ${error instanceof Error ? error.message : 'Failed to connect'}`,
    }
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
