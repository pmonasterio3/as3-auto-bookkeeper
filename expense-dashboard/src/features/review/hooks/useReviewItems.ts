/**
 * useReviewItems - Data fetching hook for the unified review system
 *
 * Fetches from all source tables and normalizes to ReviewItem[]
 */

import { useState, useCallback, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import type {
  BankTransaction,
  ExpenseQueueItem,
  FlaggedExpense,
  ProcessingError,
  VendorRule,
  ZohoExpense,
} from '@/types/database'
import type { ReviewItem, ReviewFilter } from '../types'
import { normalizeExpenseQueue } from '../normalizers/expenseQueueNormalizer'
import { normalizeFlaggedExpense } from '../normalizers/flaggedExpenseNormalizer'
import { normalizeOrphan } from '../normalizers/orphanNormalizer'
import { normalizeProcessingError } from '../normalizers/processingErrorNormalizer'
import { normalizeZohoExpense } from '../normalizers/zohoExpenseNormalizer'
import { ORPHAN_GRACE_DAYS } from '../constants'

interface UseReviewItemsResult {
  items: ReviewItem[]
  counts: {
    all: number
    reimbursement: number
    low_confidence: number
    flagged: number
    orphan: number
    processing_error: number
  }
  isLoading: boolean
  error: string | null
  refetch: () => Promise<void>
}

// Extended type for joined zoho_expense_reports
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

// Extended type for expense_queue with report data (attached after lookup)
type ExpenseQueueWithReport = ExpenseQueueItem & {
  zoho_expense_reports?: ZohoReportJoin | null
}


export function useReviewItems(filter: ReviewFilter = 'all'): UseReviewItemsResult {
  const [items, setItems] = useState<ReviewItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchItems = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const results: ReviewItem[] = []

      // Fetch vendor rules for orphan processing
      const { data: vendorRulesData } = await supabase.from('vendor_rules').select('*')
      const vendorRules = (vendorRulesData || []) as VendorRule[]

      // 1. Fetch expense_queue items (reimbursements + low confidence)
      // Note: No FK to zoho_expense_reports, so we fetch separately like flagged_expenses
      if (filter === 'all' || filter === 'reimbursement' || filter === 'low_confidence') {
        const { data: expenseQueueData, error: eqError } = await supabase
          .from('expense_queue')
          .select('*')
          .eq('status', 'pending')
          .order('created_at', { ascending: true })

        if (eqError) {
          console.error('Error fetching expense_queue:', eqError)
        }

        const expenseQueue = (expenseQueueData || []) as ExpenseQueueItem[]

        // Fetch zoho_expense_reports for items that have zoho_report_id
        const eqReportIds = expenseQueue
          .map((e) => e.zoho_report_id)
          .filter((id): id is string => id !== null && id !== undefined)

        let eqReportsMap = new Map<string, ZohoReportJoin>()
        if (eqReportIds.length > 0) {
          const { data: reportsData } = await supabase
            .from('zoho_expense_reports')
            .select('zoho_report_id, submitter_name, submitter_email, approver_name, approver_email, approved_at, submitted_at, report_name, report_number')
            .in('zoho_report_id', eqReportIds)
          if (reportsData) {
            eqReportsMap = new Map(reportsData.map((r) => [r.zoho_report_id, r as ZohoReportJoin]))
          }
        }

        // Fetch bank transactions for suggested matches
        const bankTxnIds = expenseQueue
          .map((e) => e.suggested_bank_txn_id)
          .filter((id): id is string => id !== null && id !== undefined)

        let bankTxns: BankTransaction[] = []
        if (bankTxnIds.length > 0) {
          const { data } = await supabase
            .from('bank_transactions')
            .select('*')
            .in('id', bankTxnIds)
          bankTxns = (data || []) as BankTransaction[]
        }

        const bankTxnMap = new Map(bankTxns.map((t) => [t.id, t]))

        for (const item of expenseQueue) {
          const bankTxn = item.suggested_bank_txn_id
            ? bankTxnMap.get(item.suggested_bank_txn_id) || null
            : null
          // Attach report data to the item
          const reportData = item.zoho_report_id
            ? eqReportsMap.get(item.zoho_report_id) || null
            : null
          const itemWithReport: ExpenseQueueWithReport = {
            ...item,
            zoho_expense_reports: reportData,
          }
          const normalized = normalizeExpenseQueue(itemWithReport, bankTxn)

          if (filter === 'all' || filter === normalized.itemType) {
            results.push(normalized)
          }
        }
      }

      // 2. Fetch flagged_expenses (no FK to zoho_expense_reports, so fetch separately)
      if (filter === 'all' || filter === 'flagged') {
        const { data: flaggedData, error: fError } = await supabase
          .from('flagged_expenses')
          .select('*')
          .eq('status', 'pending')
          .order('created_at', { ascending: true })

        if (fError) {
          console.error('Error fetching flagged_expenses:', fError)
        }

        const flagged = (flaggedData || []) as FlaggedExpense[]

        // Fetch zoho_expense_reports for items that have zoho_report_id
        const reportIds = flagged
          .map((f) => f.zoho_report_id)
          .filter((id): id is string => id !== null && id !== undefined)

        let reportsMap = new Map<string, ZohoReportJoin>()
        if (reportIds.length > 0) {
          const { data: reportsData } = await supabase
            .from('zoho_expense_reports')
            .select('zoho_report_id, submitter_name, submitter_email, approver_name, approver_email, approved_at, submitted_at, report_name, report_number')
            .in('zoho_report_id', reportIds)
          if (reportsData) {
            reportsMap = new Map(reportsData.map((r) => [r.zoho_report_id, r as ZohoReportJoin]))
          }
        }

        // Fetch related bank transactions
        const flaggedBankIds = flagged
          .map((f) => f.bank_transaction_id)
          .filter((id): id is string => id !== null && id !== undefined)

        let flaggedBankTxns: BankTransaction[] = []
        if (flaggedBankIds.length > 0) {
          const { data } = await supabase
            .from('bank_transactions')
            .select('*')
            .in('id', flaggedBankIds)
          flaggedBankTxns = (data || []) as BankTransaction[]
        }

        const flaggedBankMap = new Map(flaggedBankTxns.map((t) => [t.id, t]))

        for (const item of flagged) {
          const bankTxn = item.bank_transaction_id
            ? flaggedBankMap.get(item.bank_transaction_id) || null
            : null
          const reportData = item.zoho_report_id
            ? reportsMap.get(item.zoho_report_id) || null
            : null
          results.push(normalizeFlaggedExpense(item, bankTxn, reportData))
        }
      }

      // 2.5. Fetch flagged zoho_expenses (queue-based architecture v3.0)
      if (filter === 'all' || filter === 'flagged') {
        const { data: zohoFlaggedData, error: zfError } = await supabase
          .from('zoho_expenses')
          .select('*')
          .eq('status', 'flagged')
          .order('created_at', { ascending: true })

        if (zfError) {
          console.error('Error fetching flagged zoho_expenses:', zfError)
        }

        const zohoFlagged = (zohoFlaggedData || []) as ZohoExpense[]

        // Fetch report data for each expense
        const zfReportIds = [...new Set(zohoFlagged.map((e) => e.zoho_report_id))]
        let zfReportsMap = new Map<string, ZohoReportJoin>()
        if (zfReportIds.length > 0) {
          const { data: reportsData } = await supabase
            .from('zoho_expense_reports')
            .select('zoho_report_id, submitter_name, submitter_email, approver_name, approver_email, approved_at, submitted_at, report_name, report_number')
            .in('zoho_report_id', zfReportIds)
          if (reportsData) {
            zfReportsMap = new Map(reportsData.map((r) => [r.zoho_report_id, r as ZohoReportJoin]))
          }
        }

        // Fetch bank transactions for matched expenses
        const zfBankIds = zohoFlagged
          .map((e) => e.bank_transaction_id)
          .filter((id): id is string => id !== null)

        let zfBankTxns: BankTransaction[] = []
        if (zfBankIds.length > 0) {
          const { data } = await supabase
            .from('bank_transactions')
            .select('*')
            .in('id', zfBankIds)
          zfBankTxns = (data || []) as BankTransaction[]
        }
        const zfBankMap = new Map(zfBankTxns.map((t) => [t.id, t]))

        // Generate signed URLs for receipts in parallel
        const receiptUrlPromises = zohoFlagged.map(async (expense) => {
          if (!expense.receipt_storage_path) return { id: expense.id, url: null }
          const { data: signedData } = await supabase.storage
            .from('expense-receipts')
            .createSignedUrl(expense.receipt_storage_path, 3600)
          return { id: expense.id, url: signedData?.signedUrl || null }
        })
        const receiptUrls = await Promise.all(receiptUrlPromises)
        const receiptUrlMap = new Map(receiptUrls.map((r) => [r.id, r.url]))

        for (const expense of zohoFlagged) {
          const reportData = zfReportsMap.get(expense.zoho_report_id) || null
          const bankTxn = expense.bank_transaction_id
            ? zfBankMap.get(expense.bank_transaction_id) || null
            : null
          const receiptUrl = receiptUrlMap.get(expense.id) || null

          results.push(normalizeZohoExpense(expense, reportData, bankTxn, receiptUrl))
        }
      }

      // 3. Fetch orphan bank transactions
      if (filter === 'all' || filter === 'orphan') {
        const graceDaysAgo = new Date(Date.now() - ORPHAN_GRACE_DAYS * 24 * 60 * 60 * 1000)
          .toISOString()
          .split('T')[0]

        const { data: orphansData, error: oError } = await supabase
          .from('bank_transactions')
          .select('*')
          .eq('status', 'unmatched')
          .lt('transaction_date', graceDaysAgo)
          .order('transaction_date', { ascending: true })

        if (oError) {
          console.error('Error fetching orphans:', oError)
        }

        const orphans = (orphansData || []) as BankTransaction[]

        for (const txn of orphans) {
          // Find matching vendor rule
          const vendorLower = (txn.extracted_vendor || txn.description || '').toLowerCase()
          const matchedRule = vendorRules.find((r) =>
            vendorLower.includes((r.vendor_pattern || '').toLowerCase())
          )

          results.push(normalizeOrphan(txn, matchedRule || null, null))
        }
      }

      // 4. Fetch processing_errors
      if (filter === 'all' || filter === 'processing_error') {
        const { data: errorsData, error: pError } = await supabase
          .from('processing_errors')
          .select('*')
          .eq('status', 'new')
          .order('created_at', { ascending: false })
          .limit(50)

        if (pError) {
          console.error('Error fetching processing_errors:', pError)
        }

        const errors = (errorsData || []) as ProcessingError[]

        for (const err of errors) {
          results.push(normalizeProcessingError(err))
        }
      }

      // Sort by priority (lower = more urgent)
      results.sort((a, b) => a.priority - b.priority)

      setItems(results)
    } catch (err) {
      console.error('Error in useReviewItems:', err)
      setError(err instanceof Error ? err.message : 'Failed to fetch items')
    } finally {
      setIsLoading(false)
    }
  }, [filter])

  useEffect(() => {
    fetchItems()
  }, [fetchItems])

  // Calculate counts by type
  const counts = {
    all: items.length,
    reimbursement: items.filter((i) => i.itemType === 'reimbursement').length,
    low_confidence: items.filter((i) => i.itemType === 'low_confidence').length,
    flagged: items.filter((i) => i.itemType === 'flagged').length,
    orphan: items.filter((i) => i.itemType === 'orphan').length,
    processing_error: items.filter((i) => i.itemType === 'processing_error').length,
  }

  return { items, counts, isLoading, error, refetch: fetchItems }
}
