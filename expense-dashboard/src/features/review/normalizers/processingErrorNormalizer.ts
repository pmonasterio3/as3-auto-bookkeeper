/**
 * Normalizer for processing_errors items
 * n8n workflow failures and QBO API errors
 */

import type { ProcessingError, Json } from '@/types/database'
import type { ReviewItem, ReviewAction } from '../types'
import { ITEM_TYPE_PRIORITIES, DEFAULT_ACTIONS } from '../constants'

/**
 * Parse QBO error response to extract useful fields
 */
function parseQBOError(errorMessage: string | null): {
  summary: string
  code?: string
  element?: string
} {
  if (!errorMessage) {
    return { summary: 'Unknown processing error' }
  }

  // Try to parse as JSON
  try {
    const parsed = JSON.parse(errorMessage)

    // Handle nested Fault structure from QBO
    if (parsed?.Fault?.Error?.[0]) {
      const qboError = parsed.Fault.Error[0]
      return {
        summary: qboError.Message || qboError.Detail || 'QBO API Error',
        code: qboError.code,
        element: qboError.element,
      }
    }

    // Handle flat error structure
    if (parsed?.message) {
      return {
        summary: parsed.message,
        code: parsed.code,
        element: parsed.element,
      }
    }
  } catch {
    // Not JSON, try regex extraction
  }

  // Try regex patterns for common error formats
  const codeMatch = errorMessage.match(/code[:\s]+(\d+)/i)
  const elementMatch = errorMessage.match(/element[:\s]+["']?([^"'\s]+)/i)

  return {
    summary: errorMessage.length > 150 ? errorMessage.substring(0, 150) + '...' : errorMessage,
    code: codeMatch?.[1],
    element: elementMatch?.[1],
  }
}

/**
 * Extract expense info from raw_payload JSON
 */
function extractPayloadInfo(rawPayload: Json | null): {
  merchantName: string
  amount: number
  expenseDate: string
  category: string | null
  state: string | null
  confidence: number
} {
  if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) {
    return {
      merchantName: 'Unknown',
      amount: 0,
      expenseDate: '',
      category: null,
      state: null,
      confidence: 0,
    }
  }

  const payload = rawPayload as Record<string, unknown>

  return {
    merchantName: (payload.merchant_name as string) || (payload.vendor_name as string) || 'Unknown',
    amount: Number(payload.amount) || 0,
    expenseDate: (payload.date as string) || (payload.expense_date as string) || '',
    category: (payload.category_name as string) || (payload.category as string) || null,
    state: (payload.state as string) || null,
    confidence: Number(payload.ai_confidence) || 0,
  }
}

/**
 * Normalize a processing_errors item to the unified ReviewItem interface
 */
export function normalizeProcessingError(error: ProcessingError): ReviewItem {
  const itemType = 'processing_error'

  // Determine available actions
  const actions = (DEFAULT_ACTIONS[itemType] || ['retry', 'resolve']) as ReviewAction[]

  // Calculate days waiting
  const daysWaiting = error.created_at
    ? Math.floor((Date.now() - new Date(error.created_at).getTime()) / (1000 * 60 * 60 * 24))
    : 0

  // Parse error message
  const parsedError = parseQBOError(error.error_message)

  // Extract expense info from raw_payload
  const payloadInfo = extractPayloadInfo(error.raw_payload)

  // Build reason string
  const reason = `${error.error_node}: ${parsedError.summary}`

  return {
    // Identity
    id: `processing_errors:${error.id}`,
    sourceTable: 'processing_errors',
    sourceId: error.id,
    itemType,
    priority: ITEM_TYPE_PRIORITIES[itemType] || 0.5, // Highest priority

    // Always visible
    amount: payloadInfo.amount,
    vendor: payloadInfo.merchantName,
    reason,

    // No submitter info directly available
    submitter: undefined,

    // Dates
    date: payloadInfo.expenseDate || error.created_at || '',
    daysWaiting,
    createdAt: error.created_at || '',

    // Predictions from payload
    predictions: payloadInfo.category || payloadInfo.state
      ? {
          category: payloadInfo.category,
          state: payloadInfo.state,
          confidence: payloadInfo.confidence,
        }
      : undefined,

    // Zoho context if available
    zoho: error.zoho_report_id
      ? {
          expenseId: error.expense_id || '',
          reportId: error.zoho_report_id,
          reportName: '',
          categoryName: null,
          paidThrough: null,
        }
      : undefined,

    // Error details
    errorDetails: {
      node: error.error_node,
      message: error.error_message || '',
      qboErrorCode: parsedError.code,
      qboErrorElement: parsedError.element,
      retryCount: error.retry_count || 0,
      rawPayload:
        error.raw_payload && typeof error.raw_payload === 'object' && !Array.isArray(error.raw_payload)
          ? (error.raw_payload as Record<string, unknown>)
          : undefined,
    },

    // Available actions
    availableActions: actions,
  }
}
