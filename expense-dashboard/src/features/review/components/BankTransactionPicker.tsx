/**
 * BankTransactionPicker - Search and select bank transactions for manual matching
 *
 * Allows users to search unmatched bank transactions by:
 * - Amount (with tolerance)
 * - Date range
 * - Vendor/description text
 */

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Search, CreditCard, Check, X, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { BankTransaction } from '@/types/database'

interface BankTransactionPickerProps {
  expenseAmount: number
  expenseDate: string
  expenseVendor: string
  currentBankTxnId?: string | null
  onSelect: (txn: BankTransaction | null) => void
  onCancel: () => void
}

export function BankTransactionPicker({
  expenseAmount,
  expenseDate,
  expenseVendor,
  currentBankTxnId,
  onSelect,
  onCancel,
}: BankTransactionPickerProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [transactions, setTransactions] = useState<BankTransaction[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(currentBankTxnId || null)

  // Fetch candidate bank transactions
  const fetchTransactions = useCallback(async () => {
    setIsLoading(true)

    // Calculate date range (+/- 7 days from expense date)
    const expDate = new Date(expenseDate)
    const startDate = new Date(expDate)
    startDate.setDate(startDate.getDate() - 7)
    const endDate = new Date(expDate)
    endDate.setDate(endDate.getDate() + 7)

    // Query unmatched transactions within date range
    let query = supabase
      .from('bank_transactions')
      .select('*')
      .eq('status', 'unmatched')
      .gte('transaction_date', startDate.toISOString().split('T')[0])
      .lte('transaction_date', endDate.toISOString().split('T')[0])
      .order('transaction_date', { ascending: false })
      .limit(50)

    const { data, error } = await query

    if (error) {
      console.error('Error fetching bank transactions:', error)
      setTransactions([])
    } else {
      // Cast to BankTransaction[] and sort by amount similarity to expense
      const txns = (data || []) as BankTransaction[]
      const sorted = txns.sort((a, b) => {
        const diffA = Math.abs(a.amount - expenseAmount)
        const diffB = Math.abs(b.amount - expenseAmount)
        return diffA - diffB
      })
      setTransactions(sorted)
    }

    setIsLoading(false)
  }, [expenseDate, expenseAmount])

  useEffect(() => {
    fetchTransactions()
  }, [fetchTransactions])

  // Filter transactions by search query
  const filteredTransactions = transactions.filter((txn) => {
    if (!searchQuery) return true
    const query = searchQuery.toLowerCase()
    return (
      txn.description.toLowerCase().includes(query) ||
      (txn.extracted_vendor || '').toLowerCase().includes(query)
    )
  })

  // Calculate amount difference for display
  const getAmountDiff = (txnAmount: number) => {
    const diff = txnAmount - expenseAmount
    if (Math.abs(diff) < 0.01) return null
    return diff
  }

  const handleConfirm = () => {
    if (selectedId) {
      const selected = transactions.find((t) => t.id === selectedId)
      onSelect(selected || null)
    } else {
      onSelect(null)
    }
  }

  return (
    <>
      {/* Modal Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-50"
        onClick={onCancel}
      />

      {/* Modal Content */}
      <div className="fixed inset-4 md:inset-10 lg:inset-20 bg-white rounded-xl shadow-2xl z-50 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 bg-blue-600 text-white">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Select Bank Transaction</h2>
              <p className="text-blue-100 text-sm mt-1">
                Looking for: <span className="font-semibold">{formatCurrency(expenseAmount)}</span> on {formatDate(expenseDate)} from <span className="font-semibold">{expenseVendor}</span>
              </p>
            </div>
            <button
              onClick={onCancel}
              className="p-2 text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
            >
              <X className="h-6 w-6" />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
          <div className="relative max-w-xl">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search by description or vendor..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-12 pr-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
              autoFocus
            />
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Showing unmatched transactions within ±7 days of expense date • {filteredTransactions.length} results
          </p>
        </div>

        {/* Transaction List */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
              <span className="ml-3 text-lg text-gray-500">Loading transactions...</span>
            </div>
          ) : filteredTransactions.length === 0 ? (
            <div className="py-16 text-center">
              <CreditCard className="h-12 w-12 text-gray-300 mx-auto mb-3" />
              <p className="text-lg text-gray-500">No matching transactions found</p>
              <p className="text-sm text-gray-400 mt-1">Try adjusting your search or check different date ranges</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {filteredTransactions.map((txn) => {
                const amountDiff = getAmountDiff(txn.amount)
                const isExactMatch = amountDiff === null
                const isSelected = selectedId === txn.id

                return (
                  <button
                    key={txn.id}
                    onClick={() => setSelectedId(isSelected ? null : txn.id)}
                    className={cn(
                      'w-full px-6 py-4 text-left hover:bg-blue-50 transition-colors',
                      isSelected && 'bg-blue-100 hover:bg-blue-100 border-l-4 border-l-blue-600'
                    )}
                  >
                    <div className="flex items-center gap-4">
                      {/* Selection indicator */}
                      <div
                        className={cn(
                          'h-6 w-6 rounded-full border-2 flex items-center justify-center flex-shrink-0',
                          isSelected
                            ? 'border-blue-600 bg-blue-600'
                            : 'border-gray-300 bg-white'
                        )}
                      >
                        {isSelected && <Check className="h-4 w-4 text-white" />}
                      </div>

                      {/* Transaction details */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3">
                          <span className={cn(
                            "px-2 py-0.5 rounded text-xs font-semibold uppercase",
                            txn.source === 'amex'
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-amber-100 text-amber-700'
                          )}>
                            {txn.source === 'amex' ? 'AMEX' : 'Wells Fargo'}
                          </span>
                          <span className="text-sm text-gray-600">{formatDate(txn.transaction_date)}</span>
                          {isExactMatch && (
                            <span className="px-2 py-0.5 rounded bg-green-100 text-green-700 text-xs font-semibold">
                              EXACT MATCH
                            </span>
                          )}
                        </div>
                        <div className="text-base font-semibold text-gray-900 mt-1">
                          {txn.extracted_vendor || txn.description.substring(0, 50)}
                        </div>
                        <div className="text-sm text-gray-500 mt-0.5 truncate">
                          {txn.description}
                        </div>
                      </div>

                      {/* Amount */}
                      <div className="text-right flex-shrink-0 pl-4">
                        <div
                          className={cn(
                            'text-xl font-bold tabular-nums',
                            isExactMatch ? 'text-green-600' : 'text-gray-900'
                          )}
                        >
                          {formatCurrency(txn.amount)}
                        </div>
                        {amountDiff !== null && (
                          <div
                            className={cn(
                              'text-sm font-medium tabular-nums',
                              Math.abs(amountDiff) <= 5 ? 'text-amber-600' : 'text-red-500'
                            )}
                          >
                            {amountDiff > 0 ? '+' : ''}{formatCurrency(amountDiff)} difference
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
          <span className="text-sm text-gray-600">
            {selectedId ? (
              <span className="flex items-center gap-2">
                <Check className="h-4 w-4 text-green-600" />
                <span className="font-medium text-green-700">1 transaction selected</span>
              </span>
            ) : (
              'Select a transaction to match'
            )}
          </span>
          <div className="flex gap-3">
            <button
              onClick={onCancel}
              className="px-5 py-2.5 text-sm font-medium text-gray-700 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={!selectedId}
              className={cn(
                'px-6 py-2.5 text-sm font-semibold rounded-lg transition-colors',
                selectedId
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              )}
            >
              Confirm Match
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
