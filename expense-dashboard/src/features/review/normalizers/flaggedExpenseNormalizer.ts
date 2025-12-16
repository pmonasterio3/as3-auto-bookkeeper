/**
 * Normalizer for flagged_expenses items
 * Items flagged by AI for human verification
 */

import type { FlaggedExpense, BankTransaction } from '@/types/database'
import type { ReviewItem, ReviewAction, BankSource } from '../types'
import { ITEM_TYPE_PRIORITIES, DEFAULT_ACTIONS } from '../constants'

// Report data from zoho_expense_reports join
interface ZohoReportData {
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
 * Normalize a flagged_expenses item to the unified ReviewItem interface
 */
export function normalizeFlaggedExpense(
  item: FlaggedExpense,
  bankTxn?: BankTransaction | null,
  reportData?: ZohoReportData | null
): ReviewItem {
  const itemType = 'flagged'

  // Determine available actions
  const actions = (DEFAULT_ACTIONS[itemType] || ['approve', 'reject']) as ReviewAction[]

  // Calculate days waiting
  const daysWaiting = item.created_at
    ? Math.floor((Date.now() - new Date(item.created_at).getTime()) / (1000 * 60 * 60 * 24))
    : 0

  return {
    // Identity
    id: `flagged_expenses:${item.id}`,
    sourceTable: 'flagged_expenses',
    sourceId: item.id,
    itemType,
    priority: ITEM_TYPE_PRIORITIES[itemType] || 5,

    // Always visible
    amount: Number(item.amount),
    vendor: item.vendor_raw || 'Unknown Vendor',
    reason: item.flag_reason || 'Flagged for manual review',

    // Submitter - use report data first, then bank transaction
    submitter: reportData?.submitter_name
      ? {
          name: reportData.submitter_name,
          email: reportData.submitter_email || '',
        }
      : bankTxn?.submitter_name
        ? {
            name: bankTxn.submitter_name,
            email: bankTxn.submitter_email || '',
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
    date: item.transaction_date,
    daysWaiting,
    createdAt: item.created_at || '',

    // Bank transaction if linked
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
      category: item.predicted_category,
      state: item.predicted_state,
      confidence: item.predicted_confidence || 0,
      method: 'ai_match',
    },

    // Zoho context - use report data when available
    zoho: item.zoho_expense_id
      ? {
          expenseId: item.zoho_expense_id,
          reportId: item.zoho_report_id || '',
          reportName: reportData?.report_name || '',
          reportNumber: reportData?.report_number || undefined,
          categoryName: item.description,
          paidThrough: item.source,
          submittedAt: reportData?.submitted_at || undefined,
        }
      : undefined,

    // Available actions
    availableActions: actions,
  }
}
