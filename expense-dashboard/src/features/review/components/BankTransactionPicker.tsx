/**
 * BankTransactionPicker - Search and select bank transactions for manual matching
 *
 * Allows users to search unmatched bank transactions by:
 * - Amount (with tolerance)
 * - Date range (adjustable)
 * - Vendor/description text
 *
 * Features:
 * - Sort by: Date (newest/oldest), Amount (high/low/closest), Vendor (A-Z/Z-A)
 * - Adjustable date range with start/end date pickers
 * - Exact amount match filter toggle
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { Search, CreditCard, Check, X, Loader2, ArrowUpDown, Calendar, Filter, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { BankTransaction } from '@/types/database'

// Sort options for the transaction list
type SortOption = 'amount_closest' | 'amount_high' | 'amount_low' | 'date_newest' | 'date_oldest' | 'vendor_az' | 'vendor_za'

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'amount_closest', label: 'Amount (Closest Match)' },
  { value: 'date_newest', label: 'Date (Newest First)' },
  { value: 'date_oldest', label: 'Date (Oldest First)' },
  { value: 'amount_high', label: 'Amount (High to Low)' },
  { value: 'amount_low', label: 'Amount (Low to High)' },
  { value: 'vendor_az', label: 'Vendor (A-Z)' },
  { value: 'vendor_za', label: 'Vendor (Z-A)' },
]

interface BankTransactionPickerProps {
  expenseAmount: number
  expenseDate: string
  expenseVendor: string
  currentBankTxnId?: string | null
  onSelect: (txn: BankTransaction | null) => void
  onCancel: () => void
}

// Helper to format date for input[type="date"]
function toDateInputValue(date: Date): string {
  return date.toISOString().split('T')[0]
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
  const [fetchError, setFetchError] = useState<string | null>(null)

  // Filter & Sort state
  const [sortBy, setSortBy] = useState<SortOption>('amount_closest')
  const [showFilters, setShowFilters] = useState(false)
  const [exactAmountOnly, setExactAmountOnly] = useState(false)

  // Date filter enabled state - when false, shows ALL unmatched transactions
  const [useDateFilter, setUseDateFilter] = useState(true)

  // Date range state (default: ±7 days from expense date)
  const [dateStart, setDateStart] = useState(() => {
    const d = new Date(expenseDate)
    d.setDate(d.getDate() - 7)
    return toDateInputValue(d)
  })
  const [dateEnd, setDateEnd] = useState(() => {
    const d = new Date(expenseDate)
    d.setDate(d.getDate() + 7)
    return toDateInputValue(d)
  })

  // Fetch candidate bank transactions
  // IMPORTANT: Sort is applied at DB level to ensure limit doesn't cut off wrong records
  const fetchTransactions = useCallback(async () => {
    setIsLoading(true)
    setFetchError(null)

    // Build query - conditionally apply date filter
    let query = supabase
      .from('bank_transactions')
      .select('id, transaction_date, description, amount, status, source, extracted_vendor')
      .eq('status', 'unmatched')

    // Only apply date constraints when filter is enabled
    if (useDateFilter) {
      query = query
        .gte('transaction_date', dateStart)
        .lte('transaction_date', dateEnd)
    }

    // Apply DB-level ordering based on sort preference
    // This ensures the LIMIT doesn't cut off the wrong end of results
    switch (sortBy) {
      case 'date_oldest':
        query = query.order('transaction_date', { ascending: true })
        break
      case 'date_newest':
        query = query.order('transaction_date', { ascending: false })
        break
      case 'amount_high':
        query = query.order('amount', { ascending: false })
        break
      case 'amount_low':
        query = query.order('amount', { ascending: true })
        break
      case 'vendor_az':
        query = query.order('extracted_vendor', { ascending: true, nullsFirst: false })
        break
      case 'vendor_za':
        query = query.order('extracted_vendor', { ascending: false, nullsFirst: true })
        break
      case 'amount_closest':
      default:
        // For amount_closest, we need all data to calculate - use date as secondary sort
        // Fetch more records when using this sort since we need client-side calculation
        query = query.order('transaction_date', { ascending: false })
        break
    }

    // When date filter is ON: no limit needed (date range constrains data)
    // When date filter is OFF: use limit to prevent huge fetches
    // When using amount_closest: fetch more to ensure we find the closest match
    const limit = useDateFilter ? 1000 : (sortBy === 'amount_closest' ? 500 : 500)

    const { data, error } = await query.limit(limit)

    if (error) {
      console.error('Error fetching bank transactions:', error)
      setFetchError('Failed to load transactions. Please try again.')
      setTransactions([])
    } else {
      // Cast to BankTransaction[] - we only fetched needed columns
      const txns = (data || []) as BankTransaction[]
      setTransactions(txns)
    }

    setIsLoading(false)
  }, [useDateFilter, dateStart, dateEnd, sortBy])

  useEffect(() => {
    fetchTransactions()
  }, [fetchTransactions])

  // Filter and sort transactions using useMemo for performance
  const filteredTransactions = useMemo(() => {
    let result = [...transactions]

    // Apply text search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      result = result.filter((txn) =>
        txn.description.toLowerCase().includes(query) ||
        (txn.extracted_vendor || '').toLowerCase().includes(query)
      )
    }

    // Apply exact amount filter
    if (exactAmountOnly) {
      result = result.filter((txn) => Math.abs(txn.amount - expenseAmount) < 0.01)
    }

    // Apply sorting
    result.sort((a, b) => {
      switch (sortBy) {
        case 'amount_closest': {
          const diffA = Math.abs(a.amount - expenseAmount)
          const diffB = Math.abs(b.amount - expenseAmount)
          return diffA - diffB
        }
        case 'amount_high':
          return b.amount - a.amount
        case 'amount_low':
          return a.amount - b.amount
        case 'date_newest':
          return new Date(b.transaction_date).getTime() - new Date(a.transaction_date).getTime()
        case 'date_oldest':
          return new Date(a.transaction_date).getTime() - new Date(b.transaction_date).getTime()
        case 'vendor_az': {
          const vendorA = (a.extracted_vendor || a.description).toLowerCase()
          const vendorB = (b.extracted_vendor || b.description).toLowerCase()
          return vendorA.localeCompare(vendorB)
        }
        case 'vendor_za': {
          const vendorA = (a.extracted_vendor || a.description).toLowerCase()
          const vendorB = (b.extracted_vendor || b.description).toLowerCase()
          return vendorB.localeCompare(vendorA)
        }
        default:
          return 0
      }
    })

    return result
  }, [transactions, searchQuery, exactAmountOnly, sortBy, expenseAmount])

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

        {/* Search & Sort Bar */}
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 space-y-3">
          {/* Top row: Search + Sort */}
          <div className="flex flex-col sm:flex-row gap-3">
            {/* Search input */}
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
              <input
                type="text"
                placeholder="Search by description or vendor..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-12 pr-4 py-2.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#C10230] focus:border-[#C10230] bg-white"
                autoFocus
              />
            </div>

            {/* Sort dropdown */}
            <div className="flex items-center gap-2">
              <ArrowUpDown className="h-4 w-4 text-gray-500 flex-shrink-0" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortOption)}
                className="px-3 py-2.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#C10230] focus:border-[#C10230] bg-white min-w-[180px]"
              >
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            {/* Filter toggle button */}
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={cn(
                "flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg border transition-colors",
                showFilters
                  ? "bg-blue-50 border-blue-300 text-blue-700"
                  : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50"
              )}
            >
              <Filter className="h-4 w-4" />
              Filters
              {showFilters ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          </div>

          {/* Expandable filters panel */}
          {showFilters && (
            <div className="p-4 bg-white rounded-lg border border-gray-200 space-y-4">
              {/* Date filter toggle + range row */}
              <div className="flex flex-wrap items-end gap-4">
                {/* Date filter enable/disable toggle */}
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useDateFilter}
                    onChange={(e) => setUseDateFilter(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-[#C10230] focus:ring-[#C10230]"
                  />
                  <Calendar className="h-4 w-4 text-gray-500" />
                  <span className="text-sm font-medium text-gray-700">Filter by date</span>
                </label>

                {/* Date inputs - only enabled when date filter is on */}
                {useDateFilter && (
                  <>
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-gray-500">From</label>
                      <input
                        type="date"
                        value={dateStart}
                        onChange={(e) => setDateStart(e.target.value)}
                        className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#C10230] focus:border-[#C10230] bg-white"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-gray-500">To</label>
                      <input
                        type="date"
                        value={dateEnd}
                        onChange={(e) => setDateEnd(e.target.value)}
                        className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#C10230] focus:border-[#C10230] bg-white"
                      />
                    </div>
                    <button
                      onClick={() => {
                        const d = new Date(expenseDate)
                        const start = new Date(d)
                        start.setDate(start.getDate() - 7)
                        const end = new Date(d)
                        end.setDate(end.getDate() + 7)
                        setDateStart(toDateInputValue(start))
                        setDateEnd(toDateInputValue(end))
                      }}
                      className="text-xs text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      Reset to ±7 days
                    </button>
                  </>
                )}

                {/* Show info when date filter is off */}
                {!useDateFilter && (
                  <span className="text-xs text-amber-600 font-medium">
                    Showing all unmatched transactions (up to 500)
                  </span>
                )}
              </div>

              {/* Amount filter row */}
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={exactAmountOnly}
                    onChange={(e) => setExactAmountOnly(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-[#C10230] focus:ring-[#C10230]"
                  />
                  <span className="text-sm text-gray-700">
                    Exact amount matches only ({formatCurrency(expenseAmount)})
                  </span>
                </label>
              </div>
            </div>
          )}

          {/* Results summary */}
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>
              {filteredTransactions.length} transactions found
              {useDateFilter && dateStart && dateEnd
                ? ` (${formatDate(dateStart)} – ${formatDate(dateEnd)})`
                : ' (all dates)'}
            </span>
            {(exactAmountOnly || searchQuery || !useDateFilter) && (
              <button
                onClick={() => {
                  setSearchQuery('')
                  setExactAmountOnly(false)
                  setUseDateFilter(true)
                  // Reset dates to default ±7 days
                  const d = new Date(expenseDate)
                  const start = new Date(d)
                  start.setDate(start.getDate() - 7)
                  const end = new Date(d)
                  end.setDate(end.getDate() + 7)
                  setDateStart(toDateInputValue(start))
                  setDateEnd(toDateInputValue(end))
                }}
                className="text-blue-600 hover:text-blue-800 hover:underline"
              >
                Reset all filters
              </button>
            )}
          </div>
        </div>

        {/* Transaction List */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
              <span className="ml-3 text-lg text-gray-500">Loading transactions...</span>
            </div>
          ) : fetchError ? (
            <div className="py-16 text-center">
              <X className="h-12 w-12 text-red-300 mx-auto mb-3" />
              <p className="text-lg text-red-600">{fetchError}</p>
              <button
                onClick={fetchTransactions}
                className="mt-4 px-4 py-2 text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline"
              >
                Try again
              </button>
            </div>
          ) : filteredTransactions.length === 0 ? (
            <div className="py-16 text-center">
              <CreditCard className="h-12 w-12 text-gray-300 mx-auto mb-3" />
              <p className="text-lg text-gray-500">No matching transactions found</p>
              <p className="text-sm text-gray-400 mt-1">
                {searchQuery || exactAmountOnly
                  ? 'Try adjusting your search or filters'
                  : useDateFilter
                    ? 'Try disabling the date filter or expanding the date range'
                    : 'No unmatched transactions available'}
              </p>
              {(searchQuery || exactAmountOnly || useDateFilter) && (
                <button
                  onClick={() => {
                    setSearchQuery('')
                    setExactAmountOnly(false)
                    if (useDateFilter) {
                      setUseDateFilter(false)
                    }
                  }}
                  className="mt-4 px-4 py-2 text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline"
                >
                  {useDateFilter ? 'Show all dates' : 'Clear filters'}
                </button>
              )}
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
