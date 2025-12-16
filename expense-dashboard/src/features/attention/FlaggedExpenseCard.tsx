import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { FlaggedExpenseData } from './types'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import {
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  MapPin,
  FolderOpen,
  HelpCircle,
  Loader2,
  AlertCircle
} from 'lucide-react'

interface FlaggedExpenseCardProps {
  data: FlaggedExpenseData
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

export function FlaggedExpenseCard({ data, onAction }: FlaggedExpenseCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [category, setCategory] = useState(data.expense.predicted_category || '')
  const [state, setState] = useState(data.expense.predicted_state || '')

  const { expense, suggestedTransaction, confidence, flagReasons } = data

  const handleApprove = async () => {
    setIsProcessing(true)
    setError(null)

    try {
      // Update flagged_expenses status to resolved
      const { error: updateError } = await supabase
        .from('flagged_expenses')
        .update({
          status: 'resolved',
          resolved_at: new Date().toISOString(),
          resolved_category: expense.predicted_category,
          resolved_state: expense.predicted_state,
          resolution_notes: 'Approved as-is'
        })
        .eq('id', expense.id)

      if (updateError) throw updateError

      // Log to categorization_history for learning
      await supabase
        .from('categorization_history')
        .insert({
          source: expense.source,
          transaction_date: expense.transaction_date,
          vendor_raw: expense.vendor_raw,
          amount: expense.amount,
          predicted_category: expense.predicted_category,
          predicted_state: expense.predicted_state,
          predicted_confidence: confidence,
          final_category: expense.predicted_category,
          final_state: expense.predicted_state,
          was_corrected: false,
          zoho_expense_id: expense.zoho_expense_id,
          bank_transaction_id: suggestedTransaction?.id,
        })

      // Refresh the list
      setTimeout(() => onAction(), 500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleCorrectAndApprove = async () => {
    if (!category || !state) {
      alert('Please select both category and state')
      return
    }

    setIsProcessing(true)
    setError(null)

    try {
      // Update flagged_expenses with corrections
      const { error: updateError } = await supabase
        .from('flagged_expenses')
        .update({
          status: 'resolved',
          resolved_at: new Date().toISOString(),
          resolved_category: category,
          resolved_state: state,
          resolution_notes: `Corrected from ${expense.predicted_category}/${expense.predicted_state} to ${category}/${state}`
        })
        .eq('id', expense.id)

      if (updateError) throw updateError

      // Log the correction for learning
      await supabase
        .from('categorization_history')
        .insert({
          source: expense.source,
          transaction_date: expense.transaction_date,
          vendor_raw: expense.vendor_raw,
          amount: expense.amount,
          predicted_category: expense.predicted_category,
          predicted_state: expense.predicted_state,
          predicted_confidence: confidence,
          final_category: category,
          final_state: state,
          was_corrected: true,
          zoho_expense_id: expense.zoho_expense_id,
          bank_transaction_id: suggestedTransaction?.id,
        })

      // Refresh the list
      setTimeout(() => onAction(), 500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save correction')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleReject = async () => {
    if (!confirm('Reject this flagged expense? It will be marked as rejected.')) return

    setIsProcessing(true)
    try {
      const { error } = await supabase
        .from('flagged_expenses')
        .update({
          status: 'rejected',
          resolved_at: new Date().toISOString(),
          resolution_notes: 'Rejected by user'
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
          <span className="font-medium text-amber-700">FLAGGED FOR REVIEW</span>
          <Badge variant="warning" className={`text-xs ${confidenceColor}`}>
            {confidence}%
          </Badge>
        </div>
        <span className="text-lg font-bold text-gray-900">
          {formatCurrency(Number(expense.amount))}
        </span>
      </div>

      {/* Content */}
      <div className="p-4">
        {/* Side by side: Expense vs Bank */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          {/* Expense Details */}
          <div className="rounded-lg border bg-gray-50 p-3">
            <div className="text-xs text-gray-500 mb-2 font-medium">EXPENSE DETAILS</div>
            <div className="space-y-1 text-sm">
              <div className="font-medium text-gray-900">{expense.vendor_raw || 'Unknown Vendor'}</div>
              <div className="text-gray-600">
                Category: {expense.description || expense.predicted_category || 'N/A'}
              </div>
              <div className="text-gray-600">
                Amount: {formatCurrency(Number(expense.amount))}
              </div>
              <div className="text-gray-600">
                Date: {formatDate(expense.transaction_date)}
              </div>
              {expense.zoho_expense_id && (
                <div className="text-gray-500 text-xs">
                  Zoho ID: {expense.zoho_expense_id}
                </div>
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
              <div key={i} className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 rounded px-2 py-1">
                <AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0" />
                <span>{reason}</span>
              </div>
            ))}
          </div>
        </div>

        {/* AI Suggestions */}
        <div className="flex items-center gap-4 text-sm mb-4">
          <div className="flex items-center gap-1 text-gray-600">
            <MapPin className="h-4 w-4" />
            <span>State: <strong>{expense.predicted_state || '?'}</strong></span>
          </div>
          <div className="flex items-center gap-1 text-gray-600">
            <FolderOpen className="h-4 w-4" />
            <span>Category: <strong>{expense.predicted_category || '?'}</strong></span>
          </div>
        </div>

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
              Approve
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
