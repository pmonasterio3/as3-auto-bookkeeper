import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { LowConfidenceData } from './types'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import {
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  MapPin,
  FolderOpen,
  ExternalLink,
  X,
  HelpCircle,
  Loader2,
  AlertCircle
} from 'lucide-react'
import { callApprovalWebhook, buildLowConfidencePayload } from './approvalWebhook'

interface LowConfidenceCardProps {
  data: LowConfidenceData
  onAction: () => void
}

const CATEGORIES = [
  'Fuel - COS',
  'Track Rental - COS',
  'Vehicle (Rent/Wash) - COS',
  'Course Catering/Meals - COS',
  'Travel - Courses COS',
  'Supplies & Materials - COS',
  'Office Supplies & Software',
  'Travel - General Business',
  'Travel - Employee Meals',
]

const STATES = ['CA', 'TX', 'CO', 'WA', 'NJ', 'FL', 'MT', 'Admin']

export function LowConfidenceCard({ data, onAction }: LowConfidenceCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [processingStep, setProcessingStep] = useState<'saving' | 'posting' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [category, setCategory] = useState(data.expense.category_suggested || data.expense.category_name || '')
  const [state, setState] = useState(data.expense.state_suggested || '')

  const { expense, suggestedTransaction, confidence, flagReasons } = data

  // Shared function to call webhook and update QBO
  const postToQBO = async (finalCategory: string, finalState: string, wasCorrect: boolean) => {
    setProcessingStep('posting')
    const payload = buildLowConfidencePayload(
      expense,
      suggestedTransaction?.id,
      finalCategory,
      finalState,
      wasCorrect
    )
    const result = await callApprovalWebhook(payload)

    if (!result.success) {
      console.error('QBO posting failed:', result)
      setError(`Approved, but QBO Purchase creation failed: ${result.message}`)

      // Update expense_queue with error result
      await supabase
        .from('expense_queue')
        .update({
          processing_result: JSON.parse(JSON.stringify(result)),
        })
        .eq('id', expense.id)
    } else {
      // Success - update expense_queue with QBO IDs
      await supabase
        .from('expense_queue')
        .update({
          qbo_purchase_id: result.qbo_transaction_id,
          qbo_vendor_id: result.qbo_vendor_id,
          processing_result: JSON.parse(JSON.stringify(result)),
        })
        .eq('id', expense.id)

      // Also update bank_transactions with QBO ID if matched
      if (suggestedTransaction && result.qbo_transaction_id) {
        await supabase
          .from('bank_transactions')
          .update({
            qbo_purchase_id: result.qbo_transaction_id,
          })
          .eq('id', suggestedTransaction.id)
      }
    }

    return result.success
  }

  const handleApprove = async () => {
    setIsProcessing(true)
    setError(null)
    setProcessingStep('saving')

    try {
      // Update expense queue
      const { error: expenseError } = await supabase
        .from('expense_queue')
        .update({
          status: 'approved',
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', expense.id)

      if (expenseError) throw expenseError

      // If there's a bank transaction match, update it too
      if (suggestedTransaction) {
        await supabase
          .from('bank_transactions')
          .update({
            status: 'matched',
            matched_expense_id: expense.zoho_expense_id,
            matched_at: new Date().toISOString(),
            matched_by: 'human',
            match_confidence: confidence,
          })
          .eq('id', suggestedTransaction.id)
      }

      // Call webhook to create QBO Purchase
      const finalCategory = expense.category_suggested || expense.category_name || 'Office Supplies & Software'
      const finalState = expense.state_suggested || 'Admin'
      await postToQBO(finalCategory, finalState, false)

      // Refresh the list
      setTimeout(() => onAction(), error ? 2000 : 500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve')
    } finally {
      setIsProcessing(false)
      setProcessingStep(null)
    }
  }

  const handleCorrectAndApprove = async () => {
    if (!category || !state) {
      alert('Please select both category and state')
      return
    }

    setIsProcessing(true)
    setError(null)
    setProcessingStep('saving')

    try {
      // Update expense queue with corrections
      const corrections = {
        category: category !== expense.category_suggested ? category : undefined,
        state: state !== expense.state_suggested ? state : undefined,
      }

      const { error: expenseError } = await supabase
        .from('expense_queue')
        .update({
          status: 'corrected',
          corrections,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', expense.id)

      if (expenseError) throw expenseError

      // Log the correction for learning
      await supabase
        .from('categorization_history')
        .insert({
          source: 'zoho',
          transaction_date: expense.expense_date,
          vendor_raw: expense.vendor_name,
          amount: expense.amount,
          predicted_category: expense.category_suggested,
          predicted_state: expense.state_suggested,
          predicted_confidence: confidence,
          final_category: category,
          final_state: state,
          was_corrected: true,
          zoho_expense_id: expense.zoho_expense_id,
          bank_transaction_id: suggestedTransaction?.id,
        })

      // Update bank transaction if matched
      if (suggestedTransaction) {
        await supabase
          .from('bank_transactions')
          .update({
            status: 'matched',
            matched_expense_id: expense.zoho_expense_id,
            matched_at: new Date().toISOString(),
            matched_by: 'human',
          })
          .eq('id', suggestedTransaction.id)
      }

      // Call webhook to create QBO Purchase with corrected values
      await postToQBO(category, state, true)

      // Refresh the list
      setTimeout(() => onAction(), error ? 2000 : 500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save correction')
    } finally {
      setIsProcessing(false)
      setProcessingStep(null)
    }
  }

  const handleReject = async () => {
    if (!confirm('Reject this expense? It will not be posted to QBO.')) return

    setIsProcessing(true)
    try {
      const { error } = await supabase
        .from('expense_queue')
        .update({
          status: 'rejected',
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', expense.id)

      if (error) throw error
      onAction()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to reject')
    } finally {
      setIsProcessing(false)
    }
  }

  const confidenceColor = confidence >= 80 ? 'text-amber-600' : confidence >= 60 ? 'text-amber-600' : 'text-red-600'

  return (
    <div className="rounded-lg border-2 border-amber-200 bg-white overflow-hidden">
      {/* Header */}
      <div className="bg-amber-50 px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-600" />
          <span className="font-medium text-amber-700">LOW CONFIDENCE</span>
          <Badge variant="warning" className={`text-xs ${confidenceColor}`}>
            {confidence}%
          </Badge>
        </div>
        <span className="text-lg font-bold text-gray-900">
          {formatCurrency(expense.amount)}
        </span>
      </div>

      {/* Content */}
      <div className="p-4">
        {/* Side by side: Zoho vs Bank */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          {/* Zoho Expense */}
          <div className="rounded-lg border bg-gray-50 p-3">
            <div className="text-xs text-gray-500 mb-2 font-medium">ZOHO EXPENSE</div>
            <div className="space-y-1 text-sm">
              <div className="font-medium text-gray-900">{expense.vendor_name}</div>
              <div className="text-gray-600">
                Report: {expense.zoho_report_name || 'N/A'}
              </div>
              <div className="text-gray-600">
                Amount: {formatCurrency(expense.amount)}
              </div>
              <div className="text-gray-600">
                Date: {formatDate(expense.expense_date)}
              </div>
              {expense.receipt_url && (
                <a
                  href={expense.receipt_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[#119DA4] hover:text-[#0d7a80]"
                >
                  <ExternalLink className="h-3 w-3" />
                  View Receipt
                </a>
              )}
            </div>
          </div>

          {/* Bank Transaction */}
          <div className="rounded-lg border bg-gray-50 p-3">
            <div className="text-xs text-gray-500 mb-2 font-medium flex items-center justify-between">
              BANK TRANSACTION
              {suggestedTransaction && (
                <Badge variant="success" className="text-xs">
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Suggested Match
                </Badge>
              )}
            </div>
            {suggestedTransaction ? (
              <div className="space-y-1 text-sm">
                <div className="font-mono text-xs bg-white rounded px-2 py-1 border">
                  {suggestedTransaction.description}
                </div>
                <div className="text-gray-600">
                  {suggestedTransaction.source === 'amex' ? 'AMEX' : 'Wells Fargo'}
                </div>
                <div className="text-gray-600">
                  Amount: {formatCurrency(suggestedTransaction.amount)}
                </div>
                <div className="text-gray-600">
                  Date: {formatDate(suggestedTransaction.transaction_date)}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-orange-600">
                <HelpCircle className="h-4 w-4" />
                <span className="text-sm">No matching transaction found</span>
              </div>
            )}
          </div>
        </div>

        {/* Flag Reasons */}
        <div className="mb-4">
          <div className="text-xs text-gray-500 mb-1 font-medium">WHY FLAGGED</div>
          <div className="space-y-1">
            {flagReasons.map((reason, i) => (
              <div key={i} className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 rounded px-2 py-1">
                <AlertTriangle className="h-3 w-3" />
                {reason}
              </div>
            ))}
          </div>
        </div>

        {/* AI Suggestions */}
        <div className="flex items-center gap-4 text-sm mb-4">
          <div className="flex items-center gap-1 text-gray-600">
            <MapPin className="h-4 w-4" />
            <span>State: <strong>{expense.state_suggested || '?'}</strong></span>
          </div>
          <div className="flex items-center gap-1 text-gray-600">
            <FolderOpen className="h-4 w-4" />
            <span>Category: <strong>{expense.category_suggested || expense.category_name || '?'}</strong></span>
          </div>
        </div>

        {/* Processing Status */}
        {isProcessing && (
          <div className="mb-4 flex items-center gap-2 text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-2">
            <Loader2 className="h-4 w-4 animate-spin text-[#119DA4]" />
            {processingStep === 'saving' && 'Saving approval...'}
            {processingStep === 'posting' && 'Creating QBO Purchase...'}
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="mb-4 flex items-start gap-2 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
            <span className="text-red-700">{error}</span>
          </div>
        )}

        {/* Actions */}
        {!isExpanded ? (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="primary"
              onClick={handleApprove}
              disabled={isProcessing}
            >
              {isProcessing ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <CheckCircle className="h-4 w-4 mr-1" />
              )}
              Approve Match
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setIsExpanded(true)}
              disabled={isProcessing}
            >
              Correct & Approve
              <ChevronDown className="h-4 w-4 ml-1" />
            </Button>
            <div className="flex-1" />
            <Button
              size="sm"
              variant="ghost"
              onClick={handleReject}
              disabled={isProcessing}
              className="text-red-600 hover:text-red-700 hover:bg-red-50"
            >
              <X className="h-4 w-4 mr-1" />
              Reject
            </Button>
          </div>
        ) : (
          /* Expanded Correction Mode */
          <div className="space-y-4 border-t pt-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Category
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C10230]"
                >
                  <option value="">Select category...</option>
                  {CATEGORIES.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  State
                </label>
                <select
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C10230]"
                >
                  <option value="">Select state...</option>
                  {STATES.map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="text-xs text-teal-600 bg-teal-50 rounded px-2 py-1">
              This correction will be logged to improve future predictions
            </div>

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="primary"
                onClick={handleCorrectAndApprove}
                disabled={isProcessing || !category || !state}
              >
                {isProcessing ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <CheckCircle className="h-4 w-4 mr-1" />
                )}
                Save Correction & Approve
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setIsExpanded(false)}
                disabled={isProcessing}
              >
                <ChevronUp className="h-4 w-4 mr-1" />
                Collapse
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
