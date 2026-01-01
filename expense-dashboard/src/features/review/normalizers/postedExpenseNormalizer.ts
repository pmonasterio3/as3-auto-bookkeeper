/**
 * Normalizer for posted zoho_expenses items (Match History)
 *
 * Transforms zoho_expenses rows with status='posted' into ReviewItem interface
 * for viewing and editing completed matches. These items were successfully
 * processed through n8n and posted to QBO.
 */

import type { ZohoExpense, BankTransaction } from '@/types/database'
import type { ReviewItem, ReviewAction, BankSource } from '../types'
import { ITEM_TYPE_PRIORITIES } from '../constants'
import { formatRelativeTime } from '@/lib/utils'

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
 * Extract submitter name from raw_payload
 * Zoho stores submitter info in line_items[0].user_name or documents[0].uploaded_by
 */
function extractSubmitterFromPayload(rawPayload: unknown): string | null {
  if (!rawPayload || typeof rawPayload !== 'object') return null

  const payload = rawPayload as Record<string, unknown>

  // Try line_items[0].user_name first (most reliable)
  const lineItems = payload.line_items as Array<Record<string, unknown>> | undefined
  if (lineItems?.[0]?.user_name) {
    return lineItems[0].user_name as string
  }

  // Fallback to documents[0].uploaded_by
  const documents = payload.documents as Array<Record<string, unknown>> | undefined
  if (documents?.[0]?.uploaded_by) {
    return documents[0].uploaded_by as string
  }

  return null
}

/**
 * Normalize a posted zoho_expenses item to the unified ReviewItem interface
 *
 * @param expense - The zoho_expenses row from database (status='posted')
 * @param reportData - Joined data from zoho_expense_reports (optional)
 * @param bankTxn - Matched bank transaction (required for posted items)
 * @param receiptSignedUrl - Signed URL for receipt from Supabase Storage (optional)
 */
export function normalizePostedExpense(
  expense: ZohoExpense,
  reportData?: ZohoReportJoin | null,
  bankTxn?: BankTransaction | null,
  receiptSignedUrl?: string | null
): ReviewItem {
  const itemType = 'posted'

  // Available actions for posted items - can edit and reprocess
  const actions: ReviewAction[] = ['edit_match', 'create_vendor_rule']

  // Calculate days since posting
  const daysSincePosted = expense.processed_at
    ? Math.floor((Date.now() - new Date(expense.processed_at).getTime()) / (1000 * 60 * 60 * 24))
    : 0

  // Build info string showing when it was posted and QBO status
  const postedInfo: string[] = []

  if (expense.processed_at) {
    postedInfo.push(`Posted ${formatRelativeTime(expense.processed_at)}`)
  }

  if (expense.qbo_purchase_id) {
    postedInfo.push(`QBO #${expense.qbo_purchase_id}`)
  }

  if (expense.match_confidence !== null) {
    postedInfo.push(`${expense.match_confidence}% confidence`)
  }

  const reason = postedInfo.length > 0 ? postedInfo.join(' | ') : 'Posted to QBO'

  return {
    // Identity
    id: `zoho_expenses:${expense.id}`,
    sourceTable: 'zoho_expenses',
    sourceId: expense.id,
    itemType,
    priority: ITEM_TYPE_PRIORITIES[itemType] || 10, // Low priority since already processed

    // Always visible
    amount: Number(expense.amount) || 0,
    vendor: expense.merchant_name || expense.vendor_name || 'Unknown Vendor',
    reason,

    // Submitter - from report data or raw_payload fallback
    submitter: (() => {
      // First try report data
      if (reportData?.submitter_name) {
        return { name: reportData.submitter_name, email: reportData.submitter_email || '' }
      }
      // Fallback to extracting from raw_payload
      const payloadSubmitter = extractSubmitterFromPayload(expense.raw_payload)
      if (payloadSubmitter) {
        return { name: payloadSubmitter, email: '' }
      }
      return undefined
    })(),

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
    daysWaiting: daysSincePosted,
    createdAt: expense.created_at || '',

    // Bank transaction (should always have one for posted items)
    bankTransaction: bankTxn
      ? {
          id: bankTxn.id,
          description: bankTxn.description,
          source: bankTxn.source as BankSource,
          amount: bankTxn.amount,
          date: bankTxn.transaction_date,
        }
      : undefined,

    // Final values (not predictions for posted items)
    predictions: {
      category: expense.category_name,
      state: expense.state_tag,
      confidence: expense.match_confidence || 100,
      method: 'manual',
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

    // Processing attempts (for reference)
    processingAttempts: expense.processing_attempts || 0,

    // Available actions
    availableActions: actions,
  }
}
