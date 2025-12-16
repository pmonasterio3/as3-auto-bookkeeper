/**
 * Normalizer for orphan bank transactions
 * Bank transactions >5 days old with no matching expense report
 */

import type { BankTransaction, VendorRule } from '@/types/database'
import type { ReviewItem, ReviewAction, BankSource, PredictionMethod } from '../types'
import { ITEM_TYPE_PRIORITIES, DEFAULT_ACTIONS } from '../constants'

interface NearbyCourse {
  name: string
  state: string
  distance: number
}

/**
 * Normalize an orphan bank transaction to the unified ReviewItem interface
 */
export function normalizeOrphan(
  txn: BankTransaction,
  vendorRule?: VendorRule | null,
  nearbyCourse?: NearbyCourse | null
): ReviewItem {
  const itemType = 'orphan'

  // Determine available actions
  const actions = (DEFAULT_ACTIONS[itemType] || ['approve', 'reject']) as ReviewAction[]

  // Calculate days old
  const daysOld = Math.floor(
    (Date.now() - new Date(txn.transaction_date).getTime()) / (1000 * 60 * 60 * 24)
  )

  // Determine prediction method and values
  let method: PredictionMethod = 'manual'
  let suggestedCategory: string | null = null
  let suggestedState: string | null = null
  let confidence = 50 // Default low confidence for orphans

  if (vendorRule) {
    method = 'vendor_rule'
    suggestedCategory = vendorRule.default_category
    suggestedState = vendorRule.default_state
    confidence = vendorRule.confidence || 90
  } else if (txn.extracted_state) {
    method = 'parsed'
    suggestedState = txn.extracted_state
    confidence = 70
  } else if (nearbyCourse) {
    method = 'course_nearby'
    suggestedState = nearbyCourse.state
    confidence = 80
  }

  // Build reason string
  const reason = `Bank transaction with no matching expense report (${daysOld} days old)`

  return {
    // Identity
    id: `bank_transactions:${txn.id}`,
    sourceTable: 'bank_transactions',
    sourceId: txn.id,
    itemType,
    priority: ITEM_TYPE_PRIORITIES[itemType] || 5,

    // Always visible
    amount: txn.amount,
    vendor: txn.extracted_vendor || txn.description.substring(0, 50),
    reason,

    // Submitter (from Zoho if previously matched then rejected)
    submitter: txn.submitter_name
      ? {
          name: txn.submitter_name,
          email: txn.submitter_email || '',
        }
      : undefined,

    // Dates
    date: txn.transaction_date,
    daysWaiting: daysOld,
    createdAt: txn.created_at || '',

    // Bank transaction is itself
    bankTransaction: {
      id: txn.id,
      description: txn.description,
      source: txn.source as BankSource,
      amount: txn.amount,
      date: txn.transaction_date,
    },

    // AI predictions
    predictions: {
      category: suggestedCategory,
      state: suggestedState,
      confidence,
      method,
    },

    // Event context if nearby course found
    event: nearbyCourse
      ? {
          name: nearbyCourse.name,
          venue: '',
          state: nearbyCourse.state,
          dateRange: `${nearbyCourse.distance} day(s) from expense`,
        }
      : undefined,

    // Available actions
    availableActions: actions,
  }
}
