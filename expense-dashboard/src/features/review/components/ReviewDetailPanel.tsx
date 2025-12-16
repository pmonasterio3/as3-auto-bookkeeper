/**
 * ReviewDetailPanel - Slide-out panel with full Zoho report context
 *
 * Shows:
 * - Report name, number
 * - Submitter name/email
 * - Approver name/email + approval date
 * - Bank transaction comparison
 * - Receipt preview
 * - Inline editing for category/state/vendor
 */

import { useState, useEffect } from 'react'
import {
  Sheet,
  SheetHeader,
  SheetContent,
  SheetFooter
} from '@/components/ui/Sheet'
import { Button } from '@/components/ui/Button'
import { supabase } from '@/lib/supabase'
import {
  ExternalLink,
  CreditCard,
  Check,
  X,
  Loader2,
  Pencil,
  Image as ImageIcon,
  FileText,
  User,
  UserCheck,
  Calendar,
  Clock,
  Search,
  Link
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatCurrency, formatDate, formatRelativeTime } from '@/lib/utils'
import type { ReviewItem, ReviewAction, CorrectionData } from '../types'
import type { QboAccount, QboClass, BankTransaction } from '@/types/database'
import { BankTransactionPicker } from './BankTransactionPicker'

interface ReviewDetailPanelProps {
  item: ReviewItem | null
  open: boolean
  onClose: () => void
  onAction: (item: ReviewItem, action: ReviewAction, data?: CorrectionData) => Promise<void>
}

const TYPE_CONFIG: Record<string, { label: string; bg: string; text: string; border: string }> = {
  reimbursement: { label: 'Reimb', bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200' },
  low_confidence: { label: 'Low Conf', bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
  flagged: { label: 'Flagged', bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200' },
  orphan: { label: 'Orphan', bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
  processing_error: { label: 'Error', bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200' },
}

export function ReviewDetailPanel({ item, open, onClose, onAction }: ReviewDetailPanelProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  // Editable fields
  const [category, setCategory] = useState('')
  const [state, setState] = useState('')
  const [vendor, setVendor] = useState('')
  const [notes, setNotes] = useState('')
  const [createRule, setCreateRule] = useState(false)

  // Reference data
  const [qboAccounts, setQboAccounts] = useState<QboAccount[]>([])
  const [qboClasses, setQboClasses] = useState<QboClass[]>([])

  // Which field is being edited
  const [editingField, setEditingField] = useState<string | null>(null)

  // Bank transaction picker state (for manual matching)
  const [showBankPicker, setShowBankPicker] = useState(false)
  const [selectedBankTxn, setSelectedBankTxn] = useState<BankTransaction | null>(null)

  useEffect(() => {
    if (!item) return

    setCategory(item.predictions?.category || item.zoho?.categoryName || '')
    setState(item.predictions?.state || '')
    setVendor(item.vendor || '')
    setNotes('')
    setCreateRule(false)
    setEditingField(null)
    setActionError(null)
    setShowBankPicker(false)
    setSelectedBankTxn(null)

    async function fetchData() {
      const [accountsRes, classesRes] = await Promise.all([
        supabase.from('qbo_accounts').select('*').order('name'),
        supabase.from('qbo_classes').select('*').order('state_code')
      ])
      if (accountsRes.data) setQboAccounts(accountsRes.data as QboAccount[])
      if (classesRes.data) setQboClasses(classesRes.data as QboClass[])
    }
    fetchData()
  }, [item])

  if (!item) return null

  const typeConfig = TYPE_CONFIG[item.itemType] || TYPE_CONFIG.processing_error

  const handleAction = async (action: ReviewAction) => {
    setIsLoading(true)
    setActionError(null)
    try {
      await onAction(item, action, {
        category: category || undefined,
        state: state || undefined,
        notes: notes || undefined,
        createVendorRule: createRule,
        bankTransactionId: selectedBankTxn?.id || undefined,
      })
      onClose()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setIsLoading(false)
    }
  }

  const hasChanges = category !== (item.predictions?.category || item.zoho?.categoryName || '') ||
    state !== (item.predictions?.state || '') ||
    vendor !== (item.vendor || '') ||
    selectedBankTxn !== null

  const cosAccounts = qboAccounts.filter(a => a.is_cogs)
  const expenseAccounts = qboAccounts.filter(a => a.account_type === 'Expenses' && !a.is_cogs)

  return (
    <Sheet open={open} onClose={onClose}>
      {/* Header */}
      <SheetHeader onClose={onClose} className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span className={cn(
            "px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide",
            typeConfig.bg, typeConfig.text
          )}>
            {typeConfig.label}
          </span>
          <span className="text-lg font-semibold text-gray-900 tabular-nums">
            {formatCurrency(item.amount)}
          </span>
          <span className="text-xs text-gray-500">
            {formatRelativeTime(item.createdAt)}
          </span>
        </div>
      </SheetHeader>

      <SheetContent className="p-0 overflow-hidden">
        <div className="flex h-full">
          {/* Left Column - Details */}
          <div className="flex-1 overflow-y-auto">
            <div className="p-4 space-y-3">

              {/* Report Context Box */}
              {item.zoho && (
                <div className={cn("p-3 rounded-lg border", typeConfig.bg, typeConfig.border)}>
                  <div className="flex items-start gap-2">
                    <FileText className={cn("h-4 w-4 mt-0.5 flex-shrink-0", typeConfig.text)} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] font-medium uppercase tracking-wide text-gray-500 mb-1">
                        Expense Report
                      </div>
                      <div className="text-sm font-semibold text-gray-900 truncate">
                        {item.zoho.reportName || 'Unnamed Report'}
                      </div>
                      {item.zoho.reportNumber && (
                        <div className="text-xs text-gray-500">#{item.zoho.reportNumber}</div>
                      )}
                      {item.zoho.paidThrough && (
                        <div className="text-xs text-gray-600 mt-1">
                          Paid via: {item.zoho.paidThrough}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Event Context */}
              {item.event && (
                <div className="p-3 rounded-lg border border-indigo-200 bg-indigo-50">
                  <div className="flex items-start gap-2">
                    <Calendar className="h-4 w-4 text-indigo-500 mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] font-medium uppercase tracking-wide text-gray-500 mb-1">
                        Course Event
                      </div>
                      <div className="text-sm font-semibold text-gray-900">{item.event.name}</div>
                      <div className="text-xs text-gray-600">
                        {item.event.venue} · {item.event.state} · {item.event.dateRange}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Submitter & Approver Section */}
              <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
                {item.submitter?.name && (
                  <div className="flex items-center gap-3 px-3 py-2">
                    <User className="h-4 w-4 text-gray-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">Submitted by</div>
                      <div className="text-sm font-medium text-gray-900">{item.submitter.name}</div>
                      <div className="text-xs text-gray-500 truncate">{item.submitter.email}</div>
                    </div>
                  </div>
                )}

                {item.approver?.name && (
                  <div className="flex items-center gap-3 px-3 py-2">
                    <UserCheck className="h-4 w-4 text-green-500 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">Approved by</div>
                      <div className="text-sm font-medium text-gray-900">{item.approver.name}</div>
                      <div className="text-xs text-gray-500 truncate">{item.approver.email}</div>
                      {item.approver.approvedAt && (
                        <div className="flex items-center gap-1 text-[10px] text-gray-400 mt-0.5">
                          <Clock className="h-3 w-3" />
                          {formatDate(item.approver.approvedAt)}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* If no submitter/approver, show placeholder */}
                {!item.submitter?.name && !item.approver?.name && (
                  <div className="px-3 py-2 text-xs text-gray-400 italic">
                    No submitter/approver information available
                  </div>
                )}
              </div>

              {/* Editable Fields */}
              <div className="border border-gray-200 rounded-lg">
                <FieldRow
                  label="Vendor"
                  value={vendor}
                  isEditing={editingField === 'vendor'}
                  onEdit={() => setEditingField('vendor')}
                  onSave={() => setEditingField(null)}
                  onChange={setVendor}
                  modified={vendor !== item.vendor}
                />

                <FieldRow
                  label="Date"
                  value={formatDate(item.date)}
                  readOnly
                />

                <FieldRow
                  label="Category"
                  value={category}
                  isEditing={editingField === 'category'}
                  onEdit={() => setEditingField('category')}
                  onSave={() => setEditingField(null)}
                  onChange={setCategory}
                  modified={category !== (item.zoho?.categoryName || '')}
                  confidence={item.predictions?.confidence}
                  type="select"
                  options={[
                    { group: 'Cost of Sales', items: cosAccounts.map(a => a.name) },
                    { group: 'Operating Expenses', items: expenseAccounts.map(a => a.name) },
                  ]}
                />

                <FieldRow
                  label="State"
                  value={state}
                  isEditing={editingField === 'state'}
                  onEdit={() => setEditingField('state')}
                  onSave={() => setEditingField(null)}
                  onChange={setState}
                  modified={state !== (item.predictions?.state || '')}
                  confidence={item.predictions?.confidence}
                  type="select"
                  options={[{ group: 'States', items: qboClasses.map(c => c.state_code) }]}
                  isLast
                />
              </div>

              {/* Bank Transaction */}
              {item.bankTransaction && (
                <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                  <div className="flex items-center gap-2 mb-2">
                    <CreditCard className="h-4 w-4 text-gray-500" />
                    <span className="text-[10px] font-semibold text-gray-600 uppercase tracking-wide">
                      {item.bankTransaction.source === 'amex' ? 'AMEX Card' : 'Wells Fargo'}
                    </span>
                    <span className={cn(
                      "ml-auto text-xs font-medium",
                      item.amount === item.bankTransaction.amount ? 'text-green-600' : 'text-amber-600'
                    )}>
                      {formatCurrency(item.bankTransaction.amount)}
                      {item.amount !== item.bankTransaction.amount && ' ⚠'}
                    </span>
                  </div>
                  <div className="text-xs font-mono text-gray-700 leading-relaxed bg-white px-2 py-1.5 rounded border border-gray-100">
                    {item.bankTransaction.description}
                  </div>
                  <div className="text-[10px] text-gray-500 mt-1.5">
                    Transaction date: {formatDate(item.bankTransaction.date)}
                  </div>
                </div>
              )}

              {/* Manual Bank Transaction Matching (for zoho_expenses without match) */}
              {item.sourceTable === 'zoho_expenses' && !item.bankTransaction && (
                <div className="space-y-2">
                  {/* Show selected bank transaction if user picked one */}
                  {selectedBankTxn && !showBankPicker && (
                    <div className="p-3 bg-green-50 rounded-lg border border-green-200">
                      <div className="flex items-center gap-2 mb-2">
                        <Link className="h-4 w-4 text-green-600" />
                        <span className="text-[10px] font-semibold text-green-700 uppercase tracking-wide">
                          Manual Match Selected
                        </span>
                        <button
                          onClick={() => setShowBankPicker(true)}
                          className="ml-auto text-[10px] text-green-600 hover:text-green-800 underline"
                        >
                          Change
                        </button>
                      </div>
                      <div className="flex items-center gap-2">
                        <CreditCard className="h-3.5 w-3.5 text-gray-400" />
                        <span className="text-[10px] text-gray-500 uppercase">
                          {selectedBankTxn.source === 'amex' ? 'AMEX' : 'WF'}
                        </span>
                        <span className="text-xs text-gray-500">{formatDate(selectedBankTxn.transaction_date)}</span>
                        <span className="ml-auto text-sm font-semibold text-green-700 tabular-nums">
                          {formatCurrency(selectedBankTxn.amount)}
                        </span>
                      </div>
                      <div className="text-xs font-mono text-gray-700 leading-relaxed bg-white px-2 py-1.5 rounded border border-green-100 mt-1.5">
                        {selectedBankTxn.extracted_vendor || selectedBankTxn.description.substring(0, 50)}
                      </div>
                    </div>
                  )}

                  {/* Show "Find Bank Match" button when no match and picker not open */}
                  {!selectedBankTxn && !showBankPicker && (
                    <button
                      onClick={() => setShowBankPicker(true)}
                      className="w-full p-3 bg-amber-50 rounded-lg border border-amber-200 hover:bg-amber-100 transition-colors group"
                    >
                      <div className="flex items-center gap-2">
                        <Search className="h-4 w-4 text-amber-600" />
                        <span className="text-sm font-medium text-amber-800">Find Bank Transaction Match</span>
                        <span className="ml-auto text-[10px] text-amber-600 group-hover:underline">
                          Search →
                        </span>
                      </div>
                      <div className="text-[10px] text-amber-700 mt-1 text-left">
                        No automatic match found. Click to manually search and link a bank transaction.
                      </div>
                    </button>
                  )}

                  {/* Bank Transaction Picker */}
                  {showBankPicker && (
                    <BankTransactionPicker
                      expenseAmount={item.amount}
                      expenseDate={item.date}
                      expenseVendor={item.vendor}
                      currentBankTxnId={selectedBankTxn?.id}
                      onSelect={(txn) => {
                        setSelectedBankTxn(txn)
                        setShowBankPicker(false)
                      }}
                      onCancel={() => setShowBankPicker(false)}
                    />
                  )}
                </div>
              )}

              {/* Error Details */}
              {item.errorDetails && (
                <div className="p-3 bg-rose-50 rounded-lg border border-rose-200">
                  <div className="text-[10px] font-semibold text-rose-600 uppercase tracking-wide mb-1">
                    Processing Error
                  </div>
                  <div className="text-sm text-rose-800 font-medium leading-relaxed">
                    {item.errorDetails.message}
                  </div>
                  <div className="text-[10px] text-rose-600 mt-1.5">
                    Node: {item.errorDetails.node}
                    {item.errorDetails.qboErrorCode && ` · QBO: ${item.errorDetails.qboErrorCode}`}
                    {item.errorDetails.retryCount > 0 && ` · Retries: ${item.errorDetails.retryCount}`}
                  </div>
                </div>
              )}

              {/* Reason */}
              <div className={cn("p-3 rounded-lg border", typeConfig.bg, typeConfig.border)}>
                <div className={cn("text-[10px] font-semibold uppercase tracking-wide mb-1", typeConfig.text)}>
                  Why This Needs Attention
                </div>
                <div className="text-xs text-gray-800 leading-relaxed">
                  {item.reason}
                </div>
              </div>

              {/* Match Confidence (for zoho_expenses and other items with predictions) */}
              {item.predictions?.confidence !== undefined && item.predictions.confidence > 0 && (
                <div className="p-3 rounded-lg border border-gray-200 bg-gray-50">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold text-gray-600 uppercase tracking-wide">
                      Match Confidence
                    </span>
                    <span className={cn(
                      "text-lg font-bold tabular-nums",
                      item.predictions.confidence >= 95 ? "text-green-600" :
                      item.predictions.confidence >= 70 ? "text-amber-600" : "text-red-600"
                    )}>
                      {item.predictions.confidence}%
                    </span>
                  </div>
                  <div className="mt-2 h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all",
                        item.predictions.confidence >= 95 ? "bg-green-500" :
                        item.predictions.confidence >= 70 ? "bg-amber-500" : "bg-red-500"
                      )}
                      style={{ width: `${item.predictions.confidence}%` }}
                    />
                  </div>
                  <div className="text-[10px] text-gray-500 mt-1">
                    Threshold: 95% for auto-approval
                  </div>
                </div>
              )}

              {/* Processing Attempts (for zoho_expenses items that have been retried) */}
              {item.sourceTable === 'zoho_expenses' && item.processingAttempts !== undefined && item.processingAttempts > 1 && (
                <div className="px-3 py-2 bg-amber-50 rounded-lg border border-amber-200 text-xs text-amber-700">
                  <span className="font-semibold">Processing attempts:</span> {item.processingAttempts}
                </div>
              )}

              {/* Create Rule Option */}
              {hasChanges && (
                <label className="flex items-start gap-2.5 p-2.5 bg-amber-50 rounded-lg cursor-pointer border border-amber-200">
                  <input
                    type="checkbox"
                    checked={createRule}
                    onChange={(e) => setCreateRule(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#C10230] focus:ring-[#C10230]"
                  />
                  <div>
                    <div className="text-sm font-medium text-gray-900">Create vendor rule</div>
                    <div className="text-xs text-gray-500">
                      Auto-apply category & state to future "{vendor}" transactions
                    </div>
                  </div>
                </label>
              )}

              {/* Notes */}
              <div>
                <label className="text-[10px] font-medium text-gray-500 uppercase tracking-wide block mb-1">
                  Notes
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder="Optional notes..."
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#C10230] focus:border-[#C10230] resize-none"
                />
              </div>
            </div>
          </div>

          {/* Right Column - Receipt */}
          <div className="w-56 bg-gray-50 border-l border-gray-200 p-3 flex flex-col">
            <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Receipt
            </div>
            {item.receipt?.url ? (
              <div className="flex-1 flex flex-col min-h-0">
                <div className="flex-1 bg-white rounded-lg border border-gray-200 overflow-hidden relative min-h-[240px]">
                  <img
                    src={item.receipt.url}
                    alt="Receipt"
                    className="absolute inset-0 w-full h-full object-contain"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none'
                      const sibling = e.currentTarget.nextElementSibling as HTMLElement
                      if (sibling) sibling.style.display = 'flex'
                    }}
                  />
                  <div className="absolute inset-0 hidden items-center justify-center bg-gray-50">
                    <div className="text-center text-gray-400">
                      <ImageIcon className="h-8 w-8 mx-auto mb-1" />
                      <div className="text-xs">Preview unavailable</div>
                    </div>
                  </div>
                </div>
                <a
                  href={item.receipt.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 flex items-center justify-center gap-1.5 text-xs font-medium text-[#C10230] hover:underline"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open full size
                </a>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center bg-gray-100 rounded-lg border border-gray-200 min-h-[240px]">
                <div className="text-center text-gray-400">
                  <ImageIcon className="h-8 w-8 mx-auto mb-1" />
                  <div className="text-xs">No receipt attached</div>
                </div>
              </div>
            )}
          </div>
        </div>

        {actionError && (
          <div className="mx-4 mb-2 p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
            {actionError}
          </div>
        )}
      </SheetContent>

      <SheetFooter className="gap-2">
        {item.itemType === 'processing_error' && (
          <>
            <Button variant="primary" size="sm" onClick={() => handleAction('retry')} disabled={isLoading}>
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              <span className="ml-1.5">{hasChanges ? 'Save & Retry' : 'Retry'}</span>
            </Button>
            <Button variant="outline" size="sm" onClick={() => handleAction('resolve')} disabled={isLoading}>
              Mark Resolved
            </Button>
          </>
        )}

        {(item.itemType === 'low_confidence' || item.itemType === 'flagged') && item.sourceTable !== 'zoho_expenses' && (
          <>
            <Button variant="primary" size="sm" onClick={() => handleAction(hasChanges ? 'correct_and_approve' : 'approve')} disabled={isLoading}>
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              <span className="ml-1.5">{hasChanges ? 'Save & Approve' : 'Approve'}</span>
            </Button>
            <Button variant="ghost" size="sm" onClick={() => handleAction('reject')} disabled={isLoading}>
              <X className="h-4 w-4" />
              <span className="ml-1">Reject</span>
            </Button>
          </>
        )}

        {item.itemType === 'reimbursement' && (
          <>
            <Button variant="primary" size="sm" onClick={() => handleAction('reimburse_check')} disabled={isLoading}>
              Reimburse (Check)
            </Button>
            <Button variant="outline" size="sm" onClick={() => handleAction('reimburse_zelle')} disabled={isLoading}>
              Reimburse (Zelle)
            </Button>
          </>
        )}

        {item.itemType === 'orphan' && (
          <>
            <Button variant="primary" size="sm" onClick={() => handleAction('correct_and_approve')} disabled={isLoading || !category}>
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              <span className="ml-1.5">Categorize & Post</span>
            </Button>
            <Button variant="ghost" size="sm" onClick={() => handleAction('exclude')} disabled={isLoading}>
              Exclude
            </Button>
          </>
        )}

        {/* Zoho Expenses Flagged Items (queue-based architecture v3.0) */}
        {item.sourceTable === 'zoho_expenses' && (
          <>
            <Button
              variant="primary"
              size="sm"
              onClick={() => handleAction(hasChanges ? 'resubmit' : 'approve')}
              disabled={isLoading}
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              <span className="ml-1.5">{hasChanges ? 'Save & Resubmit' : 'Approve'}</span>
            </Button>
            <Button variant="outline" size="sm" onClick={() => handleAction('resubmit')} disabled={isLoading}>
              Resubmit
            </Button>
            <Button variant="ghost" size="sm" onClick={() => handleAction('reject')} disabled={isLoading}>
              <X className="h-4 w-4" />
              <span className="ml-1">Reject</span>
            </Button>
          </>
        )}
      </SheetFooter>
    </Sheet>
  )
}

// Compact field row component
interface FieldRowProps {
  label: string
  value: string
  readOnly?: boolean
  isEditing?: boolean
  onEdit?: () => void
  onSave?: () => void
  onChange?: (value: string) => void
  modified?: boolean
  confidence?: number
  type?: 'text' | 'select'
  options?: { group: string; items: string[] }[]
  isLast?: boolean
}

function FieldRow({
  label,
  value,
  readOnly,
  isEditing,
  onEdit,
  onSave,
  onChange,
  modified,
  confidence,
  type = 'text',
  options,
  isLast
}: FieldRowProps) {
  return (
    <div className={cn(
      "flex items-center px-3 py-2 group",
      !isLast && "border-b border-gray-100"
    )}>
      <div className="flex items-center gap-2 w-24">
        <span className="text-xs font-medium text-gray-500">{label}</span>
        {confidence !== undefined && confidence < 90 && (
          <span className="px-1.5 py-0.5 rounded-full text-[9px] bg-amber-100 text-amber-700 font-semibold">
            {confidence}%
          </span>
        )}
      </div>

      <div className="flex-1 text-right">
        {readOnly ? (
          <span className="text-sm text-gray-900">{value}</span>
        ) : isEditing ? (
          type === 'select' ? (
            <select
              value={value}
              onChange={(e) => { onChange?.(e.target.value); onSave?.() }}
              onBlur={onSave}
              autoFocus
              className="w-full text-right text-sm px-2 py-1 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#C10230] bg-white"
            >
              <option value="">Select...</option>
              {options?.map(group => (
                <optgroup key={group.group} label={group.group}>
                  {group.items.map(item => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={value}
              onChange={(e) => onChange?.(e.target.value)}
              onBlur={onSave}
              onKeyDown={(e) => e.key === 'Enter' && onSave?.()}
              autoFocus
              className="w-full text-right text-sm px-2 py-1 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#C10230]"
            />
          )
        ) : (
          <button
            onClick={onEdit}
            className="inline-flex items-center gap-1.5 text-right hover:bg-gray-50 px-2 py-0.5 rounded -mr-2 transition-colors"
          >
            <span className={cn(
              "text-sm",
              modified ? "text-amber-600 font-semibold" : "text-gray-900"
            )}>
              {value || <span className="text-gray-400 italic">Not set</span>}
            </span>
            <Pencil className="h-3.5 w-3.5 text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
        )}
      </div>
    </div>
  )
}
