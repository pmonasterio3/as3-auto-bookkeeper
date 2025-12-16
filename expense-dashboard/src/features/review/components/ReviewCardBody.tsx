import { formatDate } from '@/lib/utils'
import {
  User,
  Store,
  AlertTriangle,
  MapPin,
  FolderOpen,
  ExternalLink,
  CreditCard,
} from 'lucide-react'
import type { ReviewItem } from '../types'

interface ReviewCardBodyProps {
  item: ReviewItem
}

export function ReviewCardBody({ item }: ReviewCardBodyProps) {
  return (
    <div className="space-y-3">
      {/* Submitter Row - Most Important */}
      {item.submitter && (
        <div className="flex items-center gap-2 text-sm">
          <User className="h-4 w-4 text-gray-400" />
          <span className="font-medium text-gray-900">{item.submitter.name}</span>
          {item.submitter.email && (
            <span className="text-gray-500">({item.submitter.email})</span>
          )}
        </div>
      )}

      {/* Vendor Row */}
      <div className="flex items-start gap-2 text-sm">
        <Store className="h-4 w-4 text-gray-400 mt-0.5" />
        <div className="flex-1">
          <span className="font-medium text-gray-900">{item.vendor}</span>
          {item.bankTransaction && (
            <div className="font-mono text-xs text-gray-500 mt-0.5 truncate">
              {item.bankTransaction.description}
            </div>
          )}
        </div>
      </div>

      {/* Reason Row - Prominently Styled */}
      <div className="flex items-start gap-2 text-sm bg-amber-50 rounded-lg px-3 py-2 border border-amber-100">
        <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
        <span className="text-amber-800">{item.reason}</span>
      </div>

      {/* Context Grid */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-gray-600">
        {/* Date */}
        {item.date && (
          <div className="flex items-center gap-1">
            <span className="text-gray-400">Date:</span>
            <span>{formatDate(item.date)}</span>
          </div>
        )}

        {/* Category */}
        {item.predictions?.category && (
          <div className="flex items-center gap-1">
            <FolderOpen className="h-4 w-4 text-gray-400" />
            <span>{item.predictions.category}</span>
          </div>
        )}

        {/* State */}
        {item.predictions?.state && (
          <div className="flex items-center gap-1">
            <MapPin className="h-4 w-4 text-gray-400" />
            <span>{item.predictions.state}</span>
          </div>
        )}

        {/* Bank Source */}
        {item.bankTransaction && (
          <div className="flex items-center gap-1">
            <CreditCard className="h-4 w-4 text-gray-400" />
            <span>{item.bankTransaction.source === 'amex' ? 'AMEX' : 'Wells Fargo'}</span>
          </div>
        )}
      </div>

      {/* Receipt Link */}
      {item.receipt?.url && (
        <a
          href={item.receipt.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm text-[#119DA4] hover:text-[#0d7a80]"
        >
          <ExternalLink className="h-4 w-4" />
          View Receipt
        </a>
      )}

      {/* Zoho Context */}
      {item.zoho?.reportName && (
        <div className="text-xs text-gray-500">
          Report: {item.zoho.reportName}
        </div>
      )}

      {/* Error Details (for processing errors) */}
      {item.errorDetails && (
        <div className="rounded-lg border border-purple-200 bg-purple-50 p-3 text-sm">
          <div className="font-medium text-purple-800 mb-1">
            Error in: {item.errorDetails.node}
          </div>
          {item.errorDetails.qboErrorCode && (
            <div className="text-purple-700">
              QBO Error: {item.errorDetails.qboErrorCode}
              {item.errorDetails.qboErrorElement && ` (${item.errorDetails.qboErrorElement})`}
            </div>
          )}
          {item.errorDetails.retryCount > 0 && (
            <div className="text-purple-600 mt-1">
              Retry attempts: {item.errorDetails.retryCount}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
