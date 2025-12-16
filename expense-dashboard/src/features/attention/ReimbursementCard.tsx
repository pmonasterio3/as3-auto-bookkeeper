import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { ReimbursementData } from './types'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import {
  DollarSign,
  CreditCard,
  Smartphone,
  Banknote,
  X,
  ExternalLink,
  MapPin,
  FolderOpen,
  Clock,
  Loader2,
  AlertCircle
} from 'lucide-react'
import { callApprovalWebhook, buildReimbursementPayload } from './approvalWebhook'

interface ReimbursementCardProps {
  data: ReimbursementData
  onAction: () => void
}

export function ReimbursementCard({ data, onAction }: ReimbursementCardProps) {
  const [isProcessing, setIsProcessing] = useState(false)
  const [processingStep, setProcessingStep] = useState<'saving' | 'posting' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { expense, daysWaiting } = data

  const handleReimburse = async (method: 'check' | 'zelle' | 'payroll') => {
    setIsProcessing(true)
    setError(null)
    setProcessingStep('saving')

    try {
      // Step 1: Update expense_queue with approval
      const { error: dbError } = await supabase
        .from('expense_queue')
        .update({
          status: 'approved',
          reimbursement_method: method,
          reimbursed_at: new Date().toISOString(),
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', expense.id)

      if (dbError) throw dbError

      // Step 2: Call n8n webhook to create QBO Bill
      setProcessingStep('posting')
      const payload = buildReimbursementPayload(expense, method)
      const result = await callApprovalWebhook(payload)

      if (!result.success) {
        // QBO posting failed - log error but don't block approval
        console.error('QBO posting failed:', result)
        setError(`Approved, but QBO Bill creation failed: ${result.message}`)

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
            qbo_bill_id: result.qbo_transaction_id,
            qbo_vendor_id: result.qbo_vendor_id,
            processing_result: JSON.parse(JSON.stringify(result)),
          })
          .eq('id', expense.id)
      }

      // Refresh the list after short delay to show success state
      setTimeout(() => onAction(), error ? 2000 : 500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process reimbursement')
    } finally {
      setIsProcessing(false)
      setProcessingStep(null)
    }
  }

  const handleReject = async () => {
    if (!confirm('Reject this reimbursement request? This cannot be undone.')) return

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

  return (
    <div className="rounded-lg border-2 border-red-200 bg-white overflow-hidden">
      {/* Header */}
      <div className="bg-red-50 px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <DollarSign className="h-5 w-5 text-red-600" />
          <span className="font-medium text-red-700">REIMBURSEMENT</span>
          <Badge variant="warning" className="text-xs">
            <Clock className="h-3 w-3 mr-1" />
            {daysWaiting} days waiting
          </Badge>
        </div>
        <span className="text-lg font-bold text-gray-900">
          {formatCurrency(expense.amount)}
        </span>
      </div>

      {/* Content */}
      <div className="p-4">
        <div className="grid grid-cols-3 gap-4">
          {/* Left: Expense Details */}
          <div className="col-span-2 space-y-3">
            <div>
              <div className="text-lg font-medium text-gray-900">{expense.vendor_name}</div>
              <div className="text-sm text-gray-500">
                From report: {expense.zoho_report_name || 'N/A'}
              </div>
            </div>

            <div className="flex items-center gap-6 text-sm">
              <div className="flex items-center gap-1 text-gray-600">
                <FolderOpen className="h-4 w-4" />
                <span>{expense.category_name || expense.category_suggested || 'Uncategorized'}</span>
              </div>
              <div className="flex items-center gap-1 text-gray-600">
                <MapPin className="h-4 w-4" />
                <span>{expense.state_suggested || 'State unknown'}</span>
              </div>
            </div>

            <div className="text-sm text-gray-500">
              Expense Date: {formatDate(expense.expense_date)}
            </div>

            {/* Why it's a reimbursement */}
            <div className="text-sm text-orange-600 bg-orange-50 rounded px-2 py-1 inline-block">
              No matching bank transaction - employee used personal card
            </div>
          </div>

          {/* Right: Receipt */}
          <div className="flex flex-col items-center justify-center">
            {expense.receipt_url ? (
              <a
                href={expense.receipt_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-col items-center gap-1 text-[#119DA4] hover:text-[#0d7a80]"
              >
                <div className="w-20 h-20 bg-gray-100 rounded border flex items-center justify-center">
                  <ExternalLink className="h-6 w-6" />
                </div>
                <span className="text-xs">View Receipt</span>
              </a>
            ) : (
              <div className="w-20 h-20 bg-gray-50 rounded border flex items-center justify-center text-gray-400">
                No receipt
              </div>
            )}
          </div>
        </div>

        {/* Processing Status */}
        {isProcessing && (
          <div className="mt-4 flex items-center gap-2 text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-2">
            <Loader2 className="h-4 w-4 animate-spin text-[#119DA4]" />
            {processingStep === 'saving' && 'Saving approval...'}
            {processingStep === 'posting' && 'Creating QBO Bill...'}
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="mt-4 flex items-start gap-2 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
            <span className="text-red-700">{error}</span>
          </div>
        )}

        {/* Actions */}
        <div className="mt-4 pt-4 border-t flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleReimburse('check')}
            disabled={isProcessing}
          >
            {isProcessing ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <CreditCard className="h-4 w-4 mr-1" />
            )}
            Pay Check
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleReimburse('zelle')}
            disabled={isProcessing}
          >
            {isProcessing ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Smartphone className="h-4 w-4 mr-1" />
            )}
            Pay Zelle
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={() => handleReimburse('payroll')}
            disabled={isProcessing}
          >
            {isProcessing ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Banknote className="h-4 w-4 mr-1" />
            )}
            Add to Payroll
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
      </div>
    </div>
  )
}
