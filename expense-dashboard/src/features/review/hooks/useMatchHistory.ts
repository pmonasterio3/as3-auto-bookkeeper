/**
 * useMatchHistory - Data fetching hook for posted matches
 *
 * Fetches recently posted zoho_expenses with their bank transaction matches
 * for viewing and editing in the Match History page.
 */

import { useState, useCallback, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import type { BankTransaction, ZohoExpense } from '@/types/database'
import type { ReviewItem } from '../types'
import { normalizePostedExpense } from '../normalizers/postedExpenseNormalizer'

interface UseMatchHistoryResult {
  items: ReviewItem[]
  totalCount: number
  isLoading: boolean
  error: string | null
  refetch: () => Promise<void>
}

interface UseMatchHistoryOptions {
  /** Number of days to look back for posted expenses (default: 30) */
  daysBack?: number
  /** Maximum number of items to fetch (default: 100) */
  limit?: number
  /** Search term to filter by vendor or description */
  searchTerm?: string
}

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

export function useMatchHistory(options: UseMatchHistoryOptions = {}): UseMatchHistoryResult {
  const { daysBack = 30, limit = 100, searchTerm = '' } = options

  const [items, setItems] = useState<ReviewItem[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchItems = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      // Calculate date range
      const startDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0]

      // Build query for posted expenses
      let query = supabase
        .from('zoho_expenses')
        .select('*', { count: 'exact' })
        .eq('status', 'posted')
        .gte('processed_at', startDate)
        .order('processed_at', { ascending: false })
        .limit(limit)

      // Add search filter if provided
      if (searchTerm) {
        query = query.or(
          `merchant_name.ilike.%${searchTerm}%,vendor_name.ilike.%${searchTerm}%,description.ilike.%${searchTerm}%`
        )
      }

      const { data: postedExpenses, error: fetchError, count } = await query

      if (fetchError) {
        console.error('Error fetching posted expenses:', fetchError)
        throw new Error(`Failed to fetch posted expenses: ${fetchError.message}`)
      }

      const expenses = (postedExpenses || []) as ZohoExpense[]
      setTotalCount(count || 0)

      if (expenses.length === 0) {
        setItems([])
        return
      }

      // Fetch report data for each expense
      const reportIds = [...new Set(expenses.map((e) => e.zoho_report_id))]
      let reportsMap = new Map<string, ZohoReportJoin>()
      if (reportIds.length > 0) {
        const { data: reportsData } = await supabase
          .from('zoho_expense_reports')
          .select(
            'zoho_report_id, submitter_name, submitter_email, approver_name, approver_email, approved_at, submitted_at, report_name, report_number'
          )
          .in('zoho_report_id', reportIds)
        if (reportsData) {
          reportsMap = new Map(reportsData.map((r) => [r.zoho_report_id, r as ZohoReportJoin]))
        }
      }

      // Fetch bank transactions for matched expenses
      const bankIds = expenses
        .map((e) => e.bank_transaction_id)
        .filter((id): id is string => id !== null)

      let bankTxns: BankTransaction[] = []
      if (bankIds.length > 0) {
        const { data } = await supabase
          .from('bank_transactions')
          .select('*')
          .in('id', bankIds)
        bankTxns = (data || []) as BankTransaction[]
      }
      const bankMap = new Map(bankTxns.map((t) => [t.id, t]))

      // Generate signed URLs for receipts in parallel
      const receiptUrlPromises = expenses.map(async (expense) => {
        if (!expense.receipt_storage_path) return { id: expense.id, url: null }
        const { data: signedData } = await supabase.storage
          .from('expense-receipts')
          .createSignedUrl(expense.receipt_storage_path, 3600)
        return { id: expense.id, url: signedData?.signedUrl || null }
      })
      const receiptUrls = await Promise.all(receiptUrlPromises)
      const receiptUrlMap = new Map(receiptUrls.map((r) => [r.id, r.url]))

      // Normalize all expenses to ReviewItem format
      const results: ReviewItem[] = []
      for (const expense of expenses) {
        const reportData = reportsMap.get(expense.zoho_report_id) || null
        const bankTxn = expense.bank_transaction_id
          ? bankMap.get(expense.bank_transaction_id) || null
          : null
        const receiptUrl = receiptUrlMap.get(expense.id) || null

        results.push(normalizePostedExpense(expense, reportData, bankTxn, receiptUrl))
      }

      setItems(results)
    } catch (err) {
      console.error('Error in useMatchHistory:', err)
      setError(err instanceof Error ? err.message : 'Failed to fetch match history')
    } finally {
      setIsLoading(false)
    }
  }, [daysBack, limit, searchTerm])

  useEffect(() => {
    fetchItems()
  }, [fetchItems])

  return { items, totalCount, isLoading, error, refetch: fetchItems }
}
