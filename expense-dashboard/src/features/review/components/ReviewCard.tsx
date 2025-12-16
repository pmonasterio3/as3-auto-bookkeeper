/**
 * ReviewCard - Unified card component for all human review items
 *
 * Displays normalized data from expense_queue, flagged_expenses,
 * processing_errors, or bank_transactions in a consistent format.
 */

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { AlertCircle } from 'lucide-react'
import type { ReviewItem, ReviewAction, CorrectionData } from '../types'
import { ITEM_TYPE_COLORS } from '../constants'
import { ReviewCardHeader } from './ReviewCardHeader'
import { ReviewCardBody } from './ReviewCardBody'
import { ReviewCardActions } from './ReviewCardActions'

interface ReviewCardProps {
  item: ReviewItem
  onAction: (item: ReviewItem, action: ReviewAction, data?: CorrectionData) => Promise<void>
}

export function ReviewCard({ item, onAction }: ReviewCardProps) {
  const [isProcessing, setIsProcessing] = useState(false)
  const [processingStep, setProcessingStep] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const colors = ITEM_TYPE_COLORS[item.itemType] || ITEM_TYPE_COLORS.flagged

  const handleAction = async (action: ReviewAction, data?: CorrectionData) => {
    setError(null)
    setIsProcessing(true)

    // Set processing step message
    const stepMessages: Record<string, string> = {
      approve: 'Approving and posting to QBO...',
      correct_and_approve: 'Saving corrections...',
      reject: 'Rejecting...',
      reimburse_check: 'Creating QBO Bill...',
      reimburse_zelle: 'Creating QBO Bill...',
      reimburse_payroll: 'Creating QBO Bill...',
      exclude: 'Excluding transaction...',
      retry: 'Retrying...',
      investigate: 'Marking for investigation...',
      resolve: 'Marking as resolved...',
      ignore: 'Ignoring...',
      create_vendor_rule: 'Creating vendor rule...',
    }
    setProcessingStep(stepMessages[action] || 'Processing...')

    try {
      await onAction(item, action, data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setIsProcessing(false)
      setProcessingStep(null)
    }
  }

  return (
    <div
      className={cn(
        'rounded-lg border-2 bg-white overflow-hidden transition-shadow hover:shadow-md',
        colors.border
      )}
    >
      <ReviewCardHeader item={item} />

      <div className="p-4">
        <ReviewCardBody item={item} />

        {/* Processing Status */}
        {isProcessing && processingStep && (
          <div className="mt-4 flex items-center gap-2 text-sm text-gray-600">
            <div className="animate-spin h-4 w-4 border-2 border-gray-300 border-t-[#119DA4] rounded-full" />
            <span>{processingStep}</span>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="mt-4 flex items-start gap-2 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
            <span className="text-red-700">{error}</span>
          </div>
        )}

        <ReviewCardActions
          item={item}
          isProcessing={isProcessing}
          onAction={handleAction}
        />
      </div>
    </div>
  )
}
