/**
 * MatchHistoryPage - View and edit recently posted matches
 *
 * Displays all recently posted expenses with their bank transaction matches.
 * Users can review and edit matches if corrections are needed, which will
 * trigger reprocessing through the Human Approved Processor workflow.
 */

import { useState, useMemo } from 'react'
import {
  RefreshCw,
  Loader2,
  AlertTriangle,
  Search,
  CheckCircle2,
  Calendar,
  ChevronDown,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { ReviewDetailPanel } from './components/ReviewDetailPanel'
import { useMatchHistory } from './hooks/useMatchHistory'
import { executeReviewAction } from './services'
import type { ReviewItem, ReviewAction, CorrectionData } from './types'
import { formatCurrency, formatDate, cn } from '@/lib/utils'

interface DateRangeOption {
  label: string
  days: number
}

const DATE_RANGE_OPTIONS: DateRangeOption[] = [
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 14 days', days: 14 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 60 days', days: 60 },
  { label: 'Last 90 days', days: 90 },
]

interface MatchRowProps {
  item: ReviewItem
  onClick: () => void
  isSelected: boolean
}

function MatchRow({ item, onClick, isSelected }: MatchRowProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors border-b border-gray-100',
        'focus:outline-none focus:bg-gray-50',
        isSelected && 'bg-green-50 hover:bg-green-50'
      )}
    >
      <div className="flex items-center gap-4">
        {/* Status Icon */}
        <div className="flex-shrink-0">
          <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          </div>
        </div>

        {/* Main Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-900 truncate">{item.vendor}</span>
            {item.predictions?.state && (
              <span className="px-1.5 py-0.5 text-xs font-medium bg-gray-100 text-gray-600 rounded">
                {item.predictions.state}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5 text-sm text-gray-500">
            <span>{formatDate(item.date)}</span>
            <span className="text-gray-300">|</span>
            <span className="truncate">{item.predictions?.category || 'Uncategorized'}</span>
            {item.submitter?.name && (
              <>
                <span className="text-gray-300">|</span>
                <span className="truncate text-gray-600">{item.submitter.name}</span>
              </>
            )}
          </div>
        </div>

        {/* Amount */}
        <div className="flex-shrink-0 text-right">
          <div className="font-semibold text-gray-900 tabular-nums">
            {formatCurrency(item.amount)}
          </div>
          {item.bankTransaction && (
            <div className="text-xs text-gray-500 uppercase">
              {item.bankTransaction.source === 'amex' ? 'AMEX' : 'Wells Fargo'}
            </div>
          )}
        </div>

        {/* Posted Info */}
        <div className="flex-shrink-0 w-32 text-right">
          <div className="text-sm text-gray-600">{item.reason.split(' | ')[0]}</div>
          {item.reason.includes('QBO #') && (
            <div className="text-xs text-gray-400 font-mono">
              {item.reason.split(' | ').find(s => s.includes('QBO'))?.replace('QBO ', '')}
            </div>
          )}
        </div>
      </div>
    </button>
  )
}

export function MatchHistoryPage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [daysBack, setDaysBack] = useState(30)
  const [showDateDropdown, setShowDateDropdown] = useState(false)
  const [selectedItem, setSelectedItem] = useState<ReviewItem | null>(null)

  const { items, totalCount, isLoading, error, refetch } = useMatchHistory({
    daysBack,
    limit: 200,
    searchTerm: searchQuery.length >= 2 ? searchQuery : '',
  })

  // Local filtering for immediate feedback while typing
  const filteredItems = useMemo(() => {
    if (!searchQuery.trim() || searchQuery.length < 2) return items

    const query = searchQuery.toLowerCase()
    return items.filter(
      (item) =>
        item.vendor.toLowerCase().includes(query) ||
        item.predictions?.category?.toLowerCase().includes(query) ||
        item.predictions?.state?.toLowerCase().includes(query) ||
        item.submitter?.name?.toLowerCase().includes(query)
    )
  }, [items, searchQuery])

  const handleAction = async (
    item: ReviewItem,
    action: ReviewAction,
    data?: CorrectionData
  ): Promise<void> => {
    const result = await executeReviewAction(item, action, data)

    if (!result.success) {
      throw new Error(result.message)
    }

    // Refetch items after successful action
    await refetch()
  }

  const handleRowClick = (item: ReviewItem) => {
    setSelectedItem(item)
  }

  const handleClosePanel = () => {
    setSelectedItem(null)
  }

  const selectedDateRange = DATE_RANGE_OPTIONS.find((opt) => opt.days === daysBack)

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between py-3 px-1 border-b border-gray-200 bg-white">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-gray-900">Match History</h1>
          <span className="text-sm text-gray-500">
            {totalCount} posted {totalCount === 1 ? 'match' : 'matches'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Date Range Selector */}
          <div className="relative">
            <button
              onClick={() => setShowDateDropdown(!showDateDropdown)}
              className="flex items-center gap-2 px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              <Calendar className="h-4 w-4 text-gray-400" />
              {selectedDateRange?.label || 'Select range'}
              <ChevronDown className="h-3 w-3 text-gray-400" />
            </button>

            {showDateDropdown && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setShowDateDropdown(false)}
                />
                <div className="absolute right-0 mt-1 w-40 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-20">
                  {DATE_RANGE_OPTIONS.map((option) => (
                    <button
                      key={option.days}
                      onClick={() => {
                        setDaysBack(option.days)
                        setShowDateDropdown(false)
                      }}
                      className={cn(
                        'w-full px-3 py-2 text-left text-sm hover:bg-gray-50',
                        option.days === daysBack && 'bg-green-50 text-green-700'
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search vendor..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-3 py-1.5 w-48 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#C10230] focus:border-transparent"
            />
          </div>

          {/* Refresh */}
          <Button variant="ghost" size="sm" onClick={refetch} disabled={isLoading}>
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      {/* Info Banner */}
      <div className="px-4 py-2 bg-green-50 border-b border-green-100 text-sm text-green-700">
        <span className="font-medium">Review posted matches.</span> Click any row to view details
        or make corrections. Edits will be reprocessed through QBO.
      </div>

      {/* Error State */}
      {error && (
        <div className="mx-4 mt-4 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Loading State */}
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            <span className="ml-2 text-sm text-gray-500">Loading match history...</span>
          </div>
        )}

        {/* Empty State */}
        {!isLoading && filteredItems.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mb-4">
              <CheckCircle2 className="h-6 w-6 text-gray-400" />
            </div>
            <h3 className="text-base font-medium text-gray-900 mb-1">No matches found</h3>
            <p className="text-sm text-gray-500">
              {searchQuery
                ? 'No posted matches match your search.'
                : `No expenses have been posted in the last ${daysBack} days.`}
            </p>
          </div>
        )}

        {/* Table Header */}
        {!isLoading && filteredItems.length > 0 && (
          <div className="sticky top-0 bg-gray-50 border-b border-gray-200 px-4 py-2">
            <div className="flex items-center gap-4 text-xs font-medium text-gray-500 uppercase tracking-wide">
              <div className="w-8" /> {/* Icon spacer */}
              <div className="flex-1">Vendor / Category / Submitter</div>
              <div className="w-24 text-right">Amount</div>
              <div className="w-32 text-right">Posted</div>
            </div>
          </div>
        )}

        {/* Items List */}
        {!isLoading && filteredItems.length > 0 && (
          <div>
            {filteredItems.map((item) => (
              <MatchRow
                key={item.id}
                item={item}
                onClick={() => handleRowClick(item)}
                isSelected={selectedItem?.id === item.id}
              />
            ))}
          </div>
        )}
      </div>

      {/* Detail Panel (Slide-out) */}
      <ReviewDetailPanel
        item={selectedItem}
        open={!!selectedItem}
        onClose={handleClosePanel}
        onAction={handleAction}
      />
    </div>
  )
}
