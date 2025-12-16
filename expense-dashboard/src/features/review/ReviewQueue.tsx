/**
 * ReviewQueue - Unified human review queue (Compact Row Format)
 *
 * Displays all items requiring human review as compact, clickable rows.
 * Clicking a row opens a slide-out panel with full details and actions.
 *
 * Design: Workflow-oriented, dense information, < 5 clicks to fix any error
 */

import { useState, useMemo } from 'react'
import { RefreshCw, Loader2, AlertTriangle, Search } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { ReviewRow } from './components/ReviewRow'
import { ReviewDetailPanel } from './components/ReviewDetailPanel'
import { useReviewItems } from './hooks'
import { executeReviewAction } from './services'
import type { ReviewItem, ReviewFilter, ReviewAction, CorrectionData } from './types'
import { ITEM_TYPE_LABELS, ITEM_TYPE_COLORS } from './constants'

interface FilterTabProps {
  filter: ReviewFilter
  label: string
  count: number
  isActive: boolean
  onClick: () => void
}

function FilterTab({ filter, label, count, isActive, onClick }: FilterTabProps) {
  const colors = filter === 'all' ? null : ITEM_TYPE_COLORS[filter]

  return (
    <button
      onClick={onClick}
      className={`
        px-3 py-1.5 rounded-md text-sm font-medium transition-all
        ${isActive
          ? colors
            ? `${colors.badge}`
            : 'bg-gray-900 text-white'
          : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
        }
      `}
    >
      {label}
      {count > 0 && (
        <span className={`
          ml-1.5 px-1.5 py-0.5 rounded text-xs tabular-nums
          ${isActive ? 'bg-white/20' : 'bg-gray-200 text-gray-600'}
        `}>
          {count}
        </span>
      )}
    </button>
  )
}

export function ReviewQueue() {
  const [filter, setFilter] = useState<ReviewFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedItem, setSelectedItem] = useState<ReviewItem | null>(null)
  const { items, counts, isLoading, error, refetch } = useReviewItems(filter)

  // Filter items by search query
  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return items

    const query = searchQuery.toLowerCase()
    return items.filter(item =>
      item.vendor.toLowerCase().includes(query) ||
      item.reason.toLowerCase().includes(query) ||
      item.submitter?.name?.toLowerCase().includes(query) ||
      item.zoho?.reportName?.toLowerCase().includes(query)
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

  // Group items by type when showing "all"
  const groupedItems = useMemo(() => {
    if (filter !== 'all') return { [filter]: filteredItems }

    return filteredItems.reduce((acc, item) => {
      if (!acc[item.itemType]) {
        acc[item.itemType] = []
      }
      acc[item.itemType].push(item)
      return acc
    }, {} as Record<string, ReviewItem[]>)
  }, [filteredItems, filter])

  // Priority order for groups
  const groupOrder = ['processing_error', 'reimbursement', 'flagged', 'orphan', 'low_confidence']

  return (
    <div className="h-full flex flex-col">
      {/* Compact Header */}
      <div className="flex items-center justify-between py-3 px-1 border-b border-gray-200 bg-white">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-gray-900">Review Queue</h1>
          {counts.all > 0 && (
            <span className="text-sm text-gray-500">
              {filteredItems.length} {filteredItems.length === 1 ? 'item' : 'items'}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search..."
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

      {/* Filter Tabs */}
      <div className="flex items-center gap-1 py-2 px-1 bg-gray-50 border-b border-gray-200">
        <FilterTab
          filter="all"
          label="All"
          count={counts.all}
          isActive={filter === 'all'}
          onClick={() => setFilter('all')}
        />
        <FilterTab
          filter="processing_error"
          label="Errors"
          count={counts.processing_error}
          isActive={filter === 'processing_error'}
          onClick={() => setFilter('processing_error')}
        />
        <FilterTab
          filter="reimbursement"
          label="Reimb"
          count={counts.reimbursement}
          isActive={filter === 'reimbursement'}
          onClick={() => setFilter('reimbursement')}
        />
        <FilterTab
          filter="flagged"
          label="Flagged"
          count={counts.flagged}
          isActive={filter === 'flagged'}
          onClick={() => setFilter('flagged')}
        />
        <FilterTab
          filter="orphan"
          label="Orphans"
          count={counts.orphan}
          isActive={filter === 'orphan'}
          onClick={() => setFilter('orphan')}
        />
        <FilterTab
          filter="low_confidence"
          label="Low Conf"
          count={counts.low_confidence}
          isActive={filter === 'low_confidence'}
          onClick={() => setFilter('low_confidence')}
        />
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
            <span className="ml-2 text-sm text-gray-500">Loading...</span>
          </div>
        )}

        {/* Empty State */}
        {!isLoading && filteredItems.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mb-4">
              <span className="text-xl">✓</span>
            </div>
            <h3 className="text-base font-medium text-gray-900 mb-1">All caught up!</h3>
            <p className="text-sm text-gray-500">
              {searchQuery ? 'No items match your search.' : 'No items need attention right now.'}
            </p>
          </div>
        )}

        {/* Items List - Grouped when showing all, flat when filtered */}
        {!isLoading && filteredItems.length > 0 && (
          <div className="divide-y divide-gray-100">
            {groupOrder.map(groupKey => {
              const groupItems = groupedItems[groupKey]
              if (!groupItems || groupItems.length === 0) return null

              return (
                <div key={groupKey}>
                  {/* Group Header (only show when filter is 'all') */}
                  {filter === 'all' && (
                    <div className="px-4 py-2 bg-gray-50 border-b border-gray-100">
                      <span className={`text-xs font-semibold uppercase tracking-wide ${ITEM_TYPE_COLORS[groupKey]?.text || 'text-gray-500'}`}>
                        {ITEM_TYPE_LABELS[groupKey]} ({groupItems.length})
                      </span>
                    </div>
                  )}

                  {/* Items */}
                  {groupItems.map(item => (
                    <ReviewRow
                      key={item.id}
                      item={item}
                      onClick={() => handleRowClick(item)}
                      isSelected={selectedItem?.id === item.id}
                    />
                  ))}
                </div>
              )
            })}
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
