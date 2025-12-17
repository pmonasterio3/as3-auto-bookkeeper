/**
 * Unified Review System Types
 *
 * All items requiring human review are normalized to these interfaces,
 * regardless of their source table (expense_queue, flagged_expenses,
 * processing_errors, or bank_transactions).
 */

export type SourceTable =
  | 'expense_queue'
  | 'flagged_expenses'
  | 'processing_errors'
  | 'bank_transactions'
  | 'zoho_expenses'

export type ItemType =
  | 'reimbursement'
  | 'low_confidence'
  | 'flagged'
  | 'orphan'
  | 'processing_error'

export type ReviewAction =
  | 'approve'
  | 'correct_and_approve'
  | 'reject'
  | 'reimburse_check'
  | 'reimburse_zelle'
  | 'reimburse_payroll'
  | 'exclude'
  | 'retry'
  | 'investigate'
  | 'resolve'
  | 'ignore'
  | 'create_vendor_rule'
  | 'resubmit'
  | 'delete'

export type PredictionMethod =
  | 'vendor_rule'
  | 'parsed'
  | 'course_nearby'
  | 'ai_match'
  | 'manual'

export type BankSource = 'amex' | 'wells_fargo'

/**
 * Unified data structure for all items requiring human review.
 * Each source table maps to this interface via normalizer functions.
 */
export interface ReviewItem {
  // === Identity ===
  id: string                    // Composite: "sourceTable:sourceId"
  sourceTable: SourceTable      // Which table this came from
  sourceId: string              // Original ID in source table
  itemType: ItemType            // Classification for UI styling/actions
  priority: number              // Lower = more urgent (0-10 scale)

  // === ALWAYS VISIBLE (at-a-glance) ===
  amount: number
  vendor: string
  reason: string                // WHY this needs review (human-readable)

  // === Submitter Info ===
  submitter?: {
    name: string
    email: string
  }

  // === Approver Info ===
  approver?: {
    name: string
    email: string
    approvedAt: string
  }

  // === Dates ===
  date: string                  // Transaction/expense date (YYYY-MM-DD)
  daysWaiting: number           // Days since item was flagged
  createdAt: string             // When item entered queue

  // === Bank Transaction Context ===
  bankTransaction?: {
    id: string
    description: string
    source: BankSource
    amount: number
    date: string
  }

  // === AI Predictions ===
  predictions?: {
    category: string | null
    state: string | null
    confidence: number
    method?: PredictionMethod
  }

  // === Receipt ===
  receipt?: {
    url: string
    thumbnailUrl?: string       // Future: generate thumbnails
  }

  // === Zoho Context ===
  zoho?: {
    expenseId: string
    reportId: string
    reportName: string
    reportNumber?: string
    categoryName: string | null
    paidThrough: string | null
    submittedAt?: string
  }

  // === Processing Error Context (only for processing_errors) ===
  errorDetails?: {
    node: string
    message: string
    qboErrorCode?: string
    qboErrorElement?: string
    retryCount: number
    rawPayload?: Record<string, unknown>
  }

  // === Processing Attempts (for zoho_expenses queue items) ===
  processingAttempts?: number

  // === Monday.com Event Context (for COS expenses) ===
  event?: {
    name: string
    venue: string
    state: string
    dateRange: string
  }

  // === Available Actions ===
  availableActions: ReviewAction[]
}

/**
 * Filter options for the review queue
 */
export type ReviewFilter =
  | 'all'
  | 'reimbursement'
  | 'low_confidence'
  | 'flagged'
  | 'orphan'
  | 'processing_error'

/**
 * Result from executing a review action
 */
export interface ActionResult {
  success: boolean
  message: string
  data?: Record<string, unknown>
}

/**
 * Correction data submitted by user
 */
export interface CorrectionData {
  category?: string
  state?: string
  notes?: string
  createVendorRule?: boolean
  bankTransactionId?: string  // For manual bank transaction matching
}
