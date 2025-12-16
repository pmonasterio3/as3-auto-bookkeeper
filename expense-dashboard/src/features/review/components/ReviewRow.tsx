/**
 * ReviewRow - Compact table-like row for review items
 *
 * Displays: Status | Vendor | Amount | Error Code
 * With reason, time, and quick actions on one compact row
 */

import { AlertTriangle, Clock, RotateCcw, Receipt, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatCurrency, formatRelativeTime } from '@/lib/utils'
import type { ReviewItem } from '../types'

interface ReviewRowProps {
  item: ReviewItem
  onClick: () => void
  isSelected?: boolean
}

// Status indicator colors
const STATUS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  reimbursement: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-l-red-500' },
  low_confidence: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-l-amber-500' },
  flagged: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-l-orange-500' },
  orphan: { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-l-purple-500' },
  processing_error: { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-l-rose-500' },
}

// Short labels for item types
const TYPE_LABELS: Record<string, string> = {
  reimbursement: 'REIMB',
  low_confidence: 'LOW',
  flagged: 'FLAG',
  orphan: 'ORPH',
  processing_error: 'ERR',
}

export function ReviewRow({ item, onClick, isSelected }: ReviewRowProps) {
  const colors = STATUS_COLORS[item.itemType] || STATUS_COLORS.processing_error
  const typeLabel = TYPE_LABELS[item.itemType] || 'NEW'

  // Get error code if present (for processing errors)
  const errorCode = item.errorDetails?.qboErrorCode || item.errorDetails?.node || null

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left border-l-4 transition-all",
        colors.border,
        isSelected
          ? "bg-gray-100 ring-2 ring-[#C10230] ring-inset"
          : "bg-white hover:bg-gray-50",
        "border-b border-gray-100"
      )}
    >
      <div className="px-4 py-3">
        {/* Row 1: Type Badge | Vendor | Amount | Error Code */}
        <div className="flex items-center gap-3">
          {/* Type Badge */}
          <span className={cn(
            "inline-flex items-center px-2 py-0.5 rounded text-xs font-bold tracking-wide",
            colors.bg, colors.text
          )}>
            {item.itemType === 'processing_error' && <AlertTriangle className="h-3 w-3 mr-1" />}
            {item.itemType === 'reimbursement' && <RotateCcw className="h-3 w-3 mr-1" />}
            {typeLabel}
          </span>

          {/* Vendor - Primary info */}
          <span className="flex-1 font-medium text-gray-900 truncate">
            {item.vendor || 'Unknown Vendor'}
          </span>

          {/* Amount */}
          <span className="font-semibold text-gray-900 tabular-nums">
            {formatCurrency(item.amount)}
          </span>

          {/* Error Code Badge (if present) */}
          {errorCode && (
            <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-600 text-xs font-mono">
              {errorCode}
            </span>
          )}

          {/* Arrow indicator */}
          <ChevronRight className="h-4 w-4 text-gray-400 flex-shrink-0" />
        </div>

        {/* Row 2: Reason */}
        <div className="mt-1.5 text-sm text-gray-600 truncate">
          {item.reason}
        </div>

        {/* Row 3: Meta info */}
        <div className="mt-1 flex items-center gap-4 text-xs text-gray-500">
          {/* Time waiting */}
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatRelativeTime(item.createdAt)}
          </span>

          {/* Submitter if present */}
          {item.submitter?.name && (
            <span className="truncate max-w-[150px]">
              {item.submitter.name}
            </span>
          )}

          {/* Report/Event context */}
          {item.zoho?.reportName && (
            <span className="truncate max-w-[200px] text-gray-400">
              {item.zoho.reportName}
            </span>
          )}

          {/* Has receipt indicator */}
          {item.receipt?.url && (
            <span className="flex items-center gap-1 text-green-600">
              <Receipt className="h-3 w-3" />
              Receipt
            </span>
          )}
        </div>
      </div>
    </button>
  )
}
