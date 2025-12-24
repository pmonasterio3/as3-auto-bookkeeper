/**
 * Normalizer for stuck zoho_expenses items
 *
 * Transforms zoho_expenses rows with status='processing' that have been
 * stuck for more than 5 minutes into ReviewItem interface for manual intervention.
 */

import type { ZohoExpense } from '@/types/database'
import type { ReviewItem, ReviewAction } from '../types'
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
 * Normalize a stuck zoho_expenses item to the unified ReviewItem interface
 *
 * @param expense - The zoho_expenses row from database (status='processing')
 * @param reportData - Joined data from zoho_expense_reports (optional)
 * @param stuckDuration - How long the expense has been stuck (in minutes)
 */
export function normalizeStuckExpense(
  expense: ZohoExpense,
  reportData?: ZohoReportJoin | null,
  stuckDuration?: number
): ReviewItem {
  const itemType = 'stuck'

  // Determine available actions for stuck items
  const actions: ReviewAction[] = [
    'retry',
    'reject',
  ]

  // Calculate days waiting
  const daysWaiting = expense.created_at
    ? Math.floor((Date.now() - new Date(expense.created_at).getTime()) / (1000 * 60 * 60 * 24))
    : 0

  // Build reason string
  const stuckMinutes = stuckDuration || 0
  const stuckText = stuckMinutes >= 60
    ? `${Math.floor(stuckMinutes / 60)}h ${stuckMinutes % 60}m`
    : `${stuckMinutes}m`

  let reason = `Stuck in processing for ${stuckText}`
  if (expense.processing_attempts && expense.processing_attempts > 1) {
    reason += ` (attempt ${expense.processing_attempts}/3)`
  }
  if (expense.last_error) {
    reason += ` - Last error: ${expense.last_error.substring(0, 50)}...`
  }

  return {
    // Identity
    id: `zoho_expenses:${expense.id}`,
    sourceTable: 'zoho_expenses',
    sourceId: expense.id,
    itemType,
    priority: ITEM_TYPE_PRIORITIES[itemType] || 0,

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

    // AI predictions / parsed data
    predictions: {
      category: expense.category_name,
      state: expense.state_tag,
      confidence: 0,
      method: 'parsed',
    },

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

    // Error details for stuck items
    errorDetails: expense.last_error
      ? {
          node: 'n8n workflow',
          message: expense.last_error,
          retryCount: expense.processing_attempts || 0,
        }
      : undefined,

    // Available actions
    availableActions: actions,
  }
}
