/**
 * Human Approval Webhook Utility
 *
 * Calls the n8n "Human Approval Processor" workflow to post approved expenses to QBO.
 *
 * For reimbursements: Creates QBO Bill to employee
 * For low-confidence matches: Creates QBO Purchase
 */

// Types for the webhook request/response
export interface HumanApprovalRequest {
  // Required identifiers
  expense_queue_id: string
  action: 'approve' | 'correct'

  // Context from expense_queue
  zoho_expense_id: string
  is_reimbursement: boolean

  // Final values (after human correction if any)
  final_category: string
  final_state: string

  // For low-confidence matches - the bank transaction being matched
  bank_transaction_id?: string

  // For reimbursements - payment method and employee info
  reimbursement_method?: 'check' | 'zelle' | 'payroll'
  employee_name?: string
  employee_email?: string

  // Original expense data needed for QBO posting
  vendor_name: string
  amount: number
  expense_date: string
  receipt_url?: string
  description?: string
  paid_through?: string // "AMEX Business 61002" or "Wells Fargo..."
}

export interface HumanApprovalResponse {
  success: boolean
  message: string

  // If successful - the QBO transaction created
  qbo_transaction_id?: string // Purchase ID or Bill ID
  qbo_vendor_id?: string

  // If failed
  error_code?: string
  error_details?: string
}

// Webhook URL from environment variable, fallback to production URL
const WEBHOOK_URL = import.meta.env.VITE_N8N_APPROVAL_WEBHOOK ||
  'https://as3driving.app.n8n.cloud/webhook/human-approval-processor'

/**
 * Call the n8n Human Approval Processor workflow to create QBO records
 *
 * @param payload - The approval request data
 * @returns Promise with the webhook response
 * @throws Error if network fails or webhook returns non-200
 */
export async function callApprovalWebhook(
  payload: HumanApprovalRequest
): Promise<HumanApprovalResponse> {
  try {
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    // Parse response even if not 200, as n8n returns structured errors
    const result = await response.json()

    // If HTTP error but n8n returned structured response, use it
    if (!response.ok && !result.message) {
      return {
        success: false,
        message: `Webhook failed with status ${response.status}`,
        error_code: `HTTP_${response.status}`,
      }
    }

    return result as HumanApprovalResponse
  } catch (error) {
    // Network error - could not reach n8n
    console.error('Approval webhook error:', error)
    return {
      success: false,
      message: error instanceof Error
        ? `Network error: ${error.message}`
        : 'Failed to connect to approval processor',
      error_code: 'NETWORK_ERROR',
    }
  }
}

// Helper type to extract submitter info from original_data JSON
interface OriginalDataWithSubmitter {
  submitter_name?: string
  submitter_email?: string
}

/**
 * Helper to build the webhook payload for a reimbursement approval
 */
export function buildReimbursementPayload(
  expense: {
    id: string
    zoho_expense_id: string
    vendor_name: string
    amount: number
    expense_date: string
    receipt_url?: string | null
    category_name?: string | null
    category_suggested?: string | null
    state_suggested?: string | null
    original_data?: unknown // Json type from Supabase
    paid_through?: string | null
  },
  method: 'check' | 'zelle' | 'payroll'
): HumanApprovalRequest {
  // Safely extract submitter info from original_data JSON
  const originalData = expense.original_data as OriginalDataWithSubmitter | null | undefined

  return {
    expense_queue_id: expense.id,
    action: 'approve',
    zoho_expense_id: expense.zoho_expense_id,
    is_reimbursement: true,
    final_category: expense.category_name || expense.category_suggested || 'Office Supplies & Software',
    final_state: expense.state_suggested || 'Admin',
    reimbursement_method: method,
    employee_name: originalData?.submitter_name,
    employee_email: originalData?.submitter_email,
    vendor_name: expense.vendor_name,
    amount: expense.amount,
    expense_date: expense.expense_date,
    receipt_url: expense.receipt_url || undefined,
    paid_through: expense.paid_through || undefined,
  }
}

/**
 * Helper to build the webhook payload for a low-confidence match approval
 */
export function buildLowConfidencePayload(
  expense: {
    id: string
    zoho_expense_id: string
    vendor_name: string
    amount: number
    expense_date: string
    receipt_url?: string | null
    paid_through?: string | null
  },
  bankTransactionId: string | undefined,
  finalCategory: string,
  finalState: string,
  wasCorrect: boolean
): HumanApprovalRequest {
  return {
    expense_queue_id: expense.id,
    action: wasCorrect ? 'correct' : 'approve',
    zoho_expense_id: expense.zoho_expense_id,
    is_reimbursement: false,
    final_category: finalCategory,
    final_state: finalState,
    bank_transaction_id: bankTransactionId,
    vendor_name: expense.vendor_name,
    amount: expense.amount,
    expense_date: expense.expense_date,
    receipt_url: expense.receipt_url || undefined,
    paid_through: expense.paid_through || undefined,
  }
}
