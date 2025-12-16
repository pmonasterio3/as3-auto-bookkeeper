import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import {
  Check,
  X,
  Edit3,
  Loader2,
  DollarSign,
  CreditCard,
  Wallet,
  Ban,
  RefreshCw,
  Search,
  CheckCircle,
  ChevronDown,
} from 'lucide-react'
import type { ReviewItem, ReviewAction, CorrectionData } from '../types'
import { CorrectionForm } from './CorrectionForm'

interface ReviewCardActionsProps {
  item: ReviewItem
  isProcessing: boolean
  onAction: (action: ReviewAction, data?: CorrectionData) => void
}

export function ReviewCardActions({ item, isProcessing, onAction }: ReviewCardActionsProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [showReimburseOptions, setShowReimburseOptions] = useState(false)

  // Reimbursement buttons
  if (item.itemType === 'reimbursement') {
    return (
      <div className="flex flex-wrap items-center gap-2 pt-4 border-t border-gray-100 mt-4">
        <div className="relative">
          <Button
            variant="primary"
            onClick={() => setShowReimburseOptions(!showReimburseOptions)}
            disabled={isProcessing}
          >
            {isProcessing ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <DollarSign className="h-4 w-4 mr-1" />
            )}
            Reimburse
            <ChevronDown className="h-4 w-4 ml-1" />
          </Button>
          {showReimburseOptions && (
            <div className="absolute left-0 mt-1 w-48 bg-white rounded-lg shadow-lg border border-gray-200 z-10">
              <button
                onClick={() => {
                  setShowReimburseOptions(false)
                  onAction('reimburse_check')
                }}
                className="flex items-center gap-2 w-full px-4 py-2 text-sm text-left hover:bg-gray-50"
                disabled={isProcessing}
              >
                <CreditCard className="h-4 w-4 text-gray-500" />
                Pay by Check
              </button>
              <button
                onClick={() => {
                  setShowReimburseOptions(false)
                  onAction('reimburse_zelle')
                }}
                className="flex items-center gap-2 w-full px-4 py-2 text-sm text-left hover:bg-gray-50"
                disabled={isProcessing}
              >
                <Wallet className="h-4 w-4 text-gray-500" />
                Pay via Zelle
              </button>
              <button
                onClick={() => {
                  setShowReimburseOptions(false)
                  onAction('reimburse_payroll')
                }}
                className="flex items-center gap-2 w-full px-4 py-2 text-sm text-left hover:bg-gray-50"
                disabled={isProcessing}
              >
                <DollarSign className="h-4 w-4 text-gray-500" />
                Add to Payroll
              </button>
            </div>
          )}
        </div>
        <Button
          variant="ghost"
          onClick={() => onAction('reject')}
          disabled={isProcessing}
          className="text-red-600 hover:text-red-700 hover:bg-red-50"
        >
          <X className="h-4 w-4 mr-1" />
          Reject
        </Button>
      </div>
    )
  }

  // Processing error buttons
  if (item.itemType === 'processing_error') {
    return (
      <div className="flex flex-wrap items-center gap-2 pt-4 border-t border-gray-100 mt-4">
        <Button
          variant="primary"
          onClick={() => onAction('retry')}
          disabled={isProcessing}
        >
          {isProcessing ? (
            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-1" />
          )}
          Retry
        </Button>
        <Button
          variant="outline"
          onClick={() => onAction('investigate')}
          disabled={isProcessing}
        >
          <Search className="h-4 w-4 mr-1" />
          Investigate
        </Button>
        <Button
          variant="outline"
          onClick={() => onAction('resolve')}
          disabled={isProcessing}
        >
          <CheckCircle className="h-4 w-4 mr-1" />
          Mark Resolved
        </Button>
        <Button
          variant="ghost"
          onClick={() => onAction('ignore')}
          disabled={isProcessing}
          className="text-gray-500"
        >
          <Ban className="h-4 w-4 mr-1" />
          Ignore
        </Button>
      </div>
    )
  }

  // Default: Approve/Correct/Reject for flagged, low_confidence, orphan
  if (isExpanded) {
    return (
      <CorrectionForm
        item={item}
        onSubmit={(data) => onAction('correct_and_approve', data)}
        onCancel={() => setIsExpanded(false)}
        isProcessing={isProcessing}
      />
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2 pt-4 border-t border-gray-100 mt-4">
      <Button
        variant="primary"
        onClick={() => onAction('approve')}
        disabled={isProcessing}
      >
        {isProcessing ? (
          <Loader2 className="h-4 w-4 mr-1 animate-spin" />
        ) : (
          <Check className="h-4 w-4 mr-1" />
        )}
        Approve
      </Button>
      <Button
        variant="outline"
        onClick={() => setIsExpanded(true)}
        disabled={isProcessing}
      >
        <Edit3 className="h-4 w-4 mr-1" />
        Correct & Approve
      </Button>
      {item.itemType === 'orphan' && (
        <Button
          variant="ghost"
          onClick={() => onAction('exclude')}
          disabled={isProcessing}
          className="text-gray-500"
        >
          <Ban className="h-4 w-4 mr-1" />
          Exclude
        </Button>
      )}
      {(item.itemType === 'flagged' || item.itemType === 'low_confidence') && (
        <Button
          variant="ghost"
          onClick={() => onAction('reject')}
          disabled={isProcessing}
          className="text-red-600 hover:text-red-700 hover:bg-red-50"
        >
          <X className="h-4 w-4 mr-1" />
          Reject
        </Button>
      )}
    </div>
  )
}
