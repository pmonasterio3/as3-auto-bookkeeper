import type { BankTransaction, ExpenseQueueItem, FlaggedExpense } from '@/types/database'

export type AttentionItemType = 'reimbursement' | 'orphan' | 'low_confidence' | 'flagged'

export interface AttentionItem {
  type: AttentionItemType
  id: string
  priority: number
  data: ReimbursementData | OrphanData | LowConfidenceData | FlaggedExpenseData
}

export interface ReimbursementData {
  expense: ExpenseQueueItem
  daysWaiting: number
}

export interface OrphanData {
  transaction: BankTransaction
  daysOld: number
  suggestedCategory: string | null
  suggestedState: string | null
  determinationMethod: 'vendor_rule' | 'parsed' | 'course_nearby' | 'manual'
  nearbyCourse?: {
    name: string
    state: string
    distance: number
  }
}

export interface LowConfidenceData {
  expense: ExpenseQueueItem
  suggestedTransaction: BankTransaction | null
  confidence: number
  flagReasons: string[]
}

export interface FlaggedExpenseData {
  expense: FlaggedExpense
  suggestedTransaction: BankTransaction | null
  confidence: number
  flagReasons: string[]
}
