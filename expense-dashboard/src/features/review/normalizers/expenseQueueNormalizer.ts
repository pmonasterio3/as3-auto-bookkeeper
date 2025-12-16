/**
 * Normalizer for expense_queue items
 * Handles both reimbursements (is_reimbursement=true) and low confidence matches
 */

import type { ExpenseQueueItem, BankTransaction } from '@/types/database'
import type { ReviewItem, ReviewAction, BankSource } from '../types'
import { ITEM_TYPE_PRIORITIES, DEFAULT_ACTIONS } from '../constants'

interface ExpenseQueueWithReport extends ExpenseQueueItem {
  zoho_expense_reports?: {
    submitter_name: string | null
    submitter_email: string | null
    approver_name: string | null
    approver_email: string | null
    approved_at: string | null
    submitted_at: string | null
    report_name: string | null
    report_number: string | null
  } | null
}

/**
 * Normalize an expense_queue item to the unified ReviewItem interface
 */
export function normalizeExpenseQueue(
  item: ExpenseQueueWithReport,
  bankTxn?: BankTransaction | null
): ReviewItem {
  const isReimbursement = item.is_reimbursement ?? false
  const itemType = isReimbursement ? 'reimbursement' : 'low_confidence'
  const report = item.zoho_expense_reports

  // Determine available actions based on type
  const actions = (DEFAULT_ACTIONS[itemType] || ['approve', 'reject']) as ReviewAction[]

  // Calculate days waiting
  const daysWaiting = item.created_at
    ? Math.floor((Date.now() - new Date(item.created_at).getTime()) / (1000 * 60 * 60 * 24))
    : 0

  // Build the reason string
  let reason: string
  if (item.flag_reason) {
    reason = item.flag_reason
  } else if (isReimbursement) {
    reason = 'No matching bank transaction - employee used personal card'
  } else {
    reason = `Low confidence match (${item.confidence_score || 0}%)`
  }

  return {
    // Identity
    id: `expense_queue:${item.id}`,
    sourceTable: 'expense_queue',
    sourceId: item.id,
    itemType,
    priority: ITEM_TYPE_PRIORITIES[itemType] || 5,

    // Always visible
    amount: Number(item.amount),
    vendor: item.vendor_name,
    reason,

    // Submitter from joined zoho_expense_reports
    submitter: report?.submitter_name
      ? {
          name: report.submitter_name,
          email: report.submitter_email || '',
        }
      : undefined,

    // Approver from joined zoho_expense_reports
    approver: report?.approver_name
      ? {
          name: report.approver_name,
          email: report.approver_email || '',
          approvedAt: report.approved_at || '',
        }
      : undefined,

    // Dates
    date: item.expense_date,
    daysWaiting,
    createdAt: item.created_at || '',

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

    // AI predictions
    predictions: {
      category: item.category_suggested || item.category_name,
      state: item.state_suggested,
      confidence: item.confidence_score || 0,
      method: 'ai_match',
    },

    // Receipt
    receipt: item.receipt_url ? { url: item.receipt_url } : undefined,

    // Zoho context
    zoho: {
      expenseId: item.zoho_expense_id,
      reportId: item.zoho_report_id || '',
      reportName: report?.report_name || item.zoho_report_name || '',
      reportNumber: report?.report_number || undefined,
      categoryName: item.category_name,
      paidThrough: item.paid_through,
      submittedAt: report?.submitted_at || undefined,
    },

    // Available actions
    availableActions: actions,
  }
}
