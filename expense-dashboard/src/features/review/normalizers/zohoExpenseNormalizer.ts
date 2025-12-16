/**
 * Normalizer for zoho_expenses items (Queue-based architecture v3.0)
 *
 * Transforms zoho_expenses rows with status='flagged' into ReviewItem interface
 * for human review. These items were flagged due to low confidence, missing
 * data, or business rule violations during n8n processing.
 */

import type { ZohoExpense, BankTransaction } from '@/types/database'
import type { ReviewItem, ReviewAction, BankSource } from '../types'
import { ITEM_TYPE_PRIORITIES } from '../constants'

// Report data from zoho_expense_reports join
interface ZohoReportJoin {
  submitter_name: string | null
  submitter_email: string | null
  approver_name: string | null
  approver_email: string | null
  approved_at: string | null
  submitted_at: string | null
  report_name: string | null
  report_number: string | null
}

/**
 * Normalize a zoho_expenses item to the unified ReviewItem interface
 *
 * @param expense - The zoho_expenses row from database
 * @param reportData - Joined data from zoho_expense_reports (optional)
 * @param bankTxn - Matched bank transaction (optional)
 * @param receiptSignedUrl - Signed URL for receipt from Supabase Storage (optional)
 */
export function normalizeZohoExpense(
  expense: ZohoExpense,
  reportData?: ZohoReportJoin | null,
  bankTxn?: BankTransaction | null,
  receiptSignedUrl?: string | null
): ReviewItem {
  const itemType = 'flagged'

  // Determine available actions for zoho_expenses flagged items
  const actions: ReviewAction[] = [
    'approve',
    'correct_and_approve',
    'resubmit',
    'reject',
    'create_vendor_rule',
  ]

  // Calculate days waiting
  const daysWaiting = expense.created_at
    ? Math.floor((Date.now() - new Date(expense.created_at).getTime()) / (1000 * 60 * 60 * 24))
    : 0

  // Determine reason for flagging
  let reason = 'Flagged for review'
  if (expense.last_error) {
    reason = expense.last_error
  } else if (expense.match_confidence !== null && expense.match_confidence < 95) {
    reason = `Low match confidence (${expense.match_confidence}%) - needs verification`
  } else if (!expense.bank_transaction_id) {
    reason = 'No matching bank transaction found'
  } else if (!expense.state_tag) {
    reason = 'Missing state tag - needs manual assignment'
  }

  return {
    // Identity
    id: `zoho_expenses:${expense.id}`,
    sourceTable: 'zoho_expenses',
    sourceId: expense.id,
    itemType,
    priority: ITEM_TYPE_PRIORITIES[itemType] || 1.5,

    // Always visible
    amount: Number(expense.amount) || 0,
    vendor: expense.merchant_name || expense.vendor_name || 'Unknown Vendor',
    reason,

    // Submitter - from report data
    submitter: reportData?.submitter_name
      ? {
          name: reportData.submitter_name,
          email: reportData.submitter_email || '',
        }
      : undefined,

    // Approver - from report data
    approver: reportData?.approver_name
      ? {
          name: reportData.approver_name,
          email: reportData.approver_email || '',
          approvedAt: reportData.approved_at || '',
        }
      : undefined,

    // Dates
    date: expense.expense_date || '',
    daysWaiting,
    createdAt: expense.created_at || '',

    // Bank transaction if matched
    bankTransaction: bankTxn
      ? {
          id: bankTxn.id,
          description: bankTxn.description,
          source: bankTxn.source as BankSource,
          amount: bankTxn.amount,
          date: bankTxn.transaction_date,
        }
      : undefined,

    // AI predictions / parsed data
    predictions: {
      category: expense.category_name,
      state: expense.state_tag,
      confidence: expense.match_confidence || 0,
      method: 'parsed',
    },

    // Receipt from Supabase Storage
    receipt: receiptSignedUrl
      ? {
          url: receiptSignedUrl,
        }
      : undefined,

    // Zoho context
    zoho: {
      expenseId: expense.zoho_expense_id,
      reportId: expense.zoho_report_id,
      reportName: expense.zoho_report_name || reportData?.report_name || '',
      reportNumber: reportData?.report_number || undefined,
      categoryName: expense.category_name,
      paidThrough: expense.paid_through,
      submittedAt: reportData?.submitted_at || undefined,
    },

    // Processing attempts (for display)
    processingAttempts: expense.processing_attempts || 0,

    // Available actions
    availableActions: actions,
  }
}
