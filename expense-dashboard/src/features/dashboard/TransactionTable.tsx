import { useState, useEffect, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency } from '@/lib/utils'
import type { BankTransaction, ZohoExpenseReport } from '@/types/database'
import { Search, ChevronLeft, ChevronRight, Check, AlertCircle, Clock, Filter, X, Copy, Edit2, Save, XCircle, User, FileText, Mail } from 'lucide-react'
import { Button } from '@/components/ui/Button'

type StatusFilter = 'all' | 'unmatched' | 'matched' | 'orphan_processed' | 'pending_review'

interface TransactionTableProps {
  accountFilter: string | null
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bgColor: string }> = {
  unmatched: { label: 'Unmatched', color: 'text-blue-700', bgColor: 'bg-blue-100' },
  matched: { label: 'Matched', color: 'text-green-700', bgColor: 'bg-green-100' },
  orphan_processed: { label: 'Orphan', color: 'text-purple-700', bgColor: 'bg-purple-100' },
  pending_review: { label: 'Review', color: 'text-amber-700', bgColor: 'bg-amber-100' },
}

const PAGE_SIZE = 25

export function TransactionTable({ accountFilter }: TransactionTableProps) {
  const [transactions, setTransactions] = useState<BankTransaction[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [page, setPage] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const [selectedTxn, setSelectedTxn] = useState<BankTransaction | null>(null)
  const [reportDetails, setReportDetails] = useState<ZohoExpenseReport | null>(null)
  const [isLoadingReport, setIsLoadingReport] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editForm, setEditForm] = useState({ extracted_vendor: '', description: '', status: '' })
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    fetchTransactions()
  }, [accountFilter, statusFilter, page])

  // Reset page when filters change
  useEffect(() => {
    setPage(0)
  }, [accountFilter, statusFilter, searchQuery])

  async function fetchTransactions() {
    setIsLoading(true)
    try {
      let query = supabase
        .from('bank_transactions')
        .select('*', { count: 'exact' })
        .order('transaction_date', { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

      if (accountFilter) {
        query = query.eq('source', accountFilter)
      }

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter)
      }

      const { data, error, count } = await query

      if (error) throw error

      setTransactions((data || []) as BankTransaction[])
      setTotalCount(count || 0)
    } catch (err) {
      console.error('Failed to fetch transactions:', err)
    } finally {
      setIsLoading(false)
    }
  }

  // Client-side search filtering
  const filteredTransactions = useMemo(() => {
    if (!searchQuery.trim()) return transactions

    const query = searchQuery.toLowerCase()
    return transactions.filter(txn =>
      txn.description.toLowerCase().includes(query) ||
      txn.extracted_vendor?.toLowerCase().includes(query) ||
      txn.transaction_date.includes(query) ||
      Math.abs(txn.amount).toString().includes(query)
    )
  }, [transactions, searchQuery])

  const totalPages = Math.ceil(totalCount / PAGE_SIZE)

  const handleRowClick = async (txn: BankTransaction) => {
    setSelectedTxn(txn)
    setIsEditing(false)
    setReportDetails(null)

    // Fetch report details for matched transactions
    if (txn.status === 'matched' && txn.matched_expense_id) {
      setIsLoadingReport(true)
      try {
        // Join through zoho_expenses to get report details
        const { data, error } = await supabase
          .from('zoho_expenses')
          .select(`
            zoho_report_id,
            zoho_expense_reports (
              zoho_report_id,
              report_number,
              report_name,
              submitter_name,
              submitter_email,
              submitted_at,
              approver_name,
              approver_email,
              approved_at,
              expense_count,
              total_amount,
              report_status
            )
          `)
          .eq('zoho_expense_id', txn.matched_expense_id)
          .single()

        if (!error && data?.zoho_expense_reports) {
          setReportDetails(data.zoho_expense_reports as ZohoExpenseReport)
        }
      } catch (err) {
        console.error('Failed to fetch report details:', err)
      } finally {
        setIsLoadingReport(false)
      }
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  const startEditing = () => {
    if (selectedTxn) {
      setEditForm({
        extracted_vendor: selectedTxn.extracted_vendor || '',
        description: selectedTxn.description || '',
        status: selectedTxn.status
      })
      setIsEditing(true)
    }
  }

  const cancelEditing = () => {
    setIsEditing(false)
    setEditForm({ extracted_vendor: '', description: '', status: '' })
  }

  const saveEdit = async () => {
    if (!selectedTxn) return

    setIsSaving(true)
    try {
      // Build update object
      const updateData: Record<string, unknown> = {
        extracted_vendor: editForm.extracted_vendor || null,
        description: editForm.description,
        status: editForm.status
      }

      // If changing from matched to unmatched, clear match-related fields
      if (selectedTxn.status === 'matched' && editForm.status === 'unmatched') {
        updateData.matched_expense_id = null
        updateData.matched_at = null
        updateData.matched_by = null
        updateData.match_confidence = null
      }

      const { error } = await supabase
        .from('bank_transactions')
        .update(updateData)
        .eq('id', selectedTxn.id)

      if (error) throw error

      // Update local state
      const updatedTxn = {
        ...selectedTxn,
        extracted_vendor: editForm.extracted_vendor || null,
        description: editForm.description,
        status: editForm.status,
        ...(selectedTxn.status === 'matched' && editForm.status === 'unmatched' ? {
          matched_expense_id: null,
          matched_at: null,
          matched_by: null,
          match_confidence: null
        } : {})
      }
      setSelectedTxn(updatedTxn as typeof selectedTxn)
      setTransactions(txns => txns.map(t => t.id === selectedTxn.id ? updatedTxn as typeof selectedTxn : t))
      setIsEditing(false)
    } catch (err) {
      console.error('Failed to save transaction:', err)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 relative">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4 p-3 border-b border-gray-100 bg-gray-50">
        {/* Search */}
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search transactions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C10230] focus:border-transparent"
          />
        </div>

        {/* Status Filters */}
        <div className="flex items-center gap-1">
          <Filter className="h-4 w-4 text-gray-400 mr-1" />
          {(['all', 'unmatched', 'matched', 'orphan_processed', 'pending_review'] as const).map(status => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`
                px-2.5 py-1 text-xs rounded-full transition-colors
                ${statusFilter === status
                  ? 'bg-gray-900 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }
              `}
            >
              {status === 'all' ? 'All' : STATUS_CONFIG[status]?.label || status}
            </button>
          ))}
        </div>

        {/* Pagination Info */}
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <span>{totalCount.toLocaleString()} total</span>
          {totalPages > 1 && (
            <>
              <span className="text-gray-300">|</span>
              <span>Page {page + 1} of {totalPages}</span>
            </>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-3 py-2 font-medium text-gray-600 w-24">Date</th>
              <th className="text-left px-3 py-2 font-medium text-gray-600">Description</th>
              <th className="text-left px-3 py-2 font-medium text-gray-600 w-28">Vendor</th>
              <th className="text-right px-3 py-2 font-medium text-gray-600 w-24">Expense</th>
              <th className="text-right px-3 py-2 font-medium text-gray-600 w-24">Deposit</th>
              <th className="text-center px-3 py-2 font-medium text-gray-600 w-24">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading ? (
              // Loading skeleton
              [...Array(10)].map((_, i) => (
                <tr key={i} className="animate-pulse">
                  <td className="px-3 py-2"><div className="h-4 w-16 bg-gray-100 rounded" /></td>
                  <td className="px-3 py-2"><div className="h-4 w-48 bg-gray-100 rounded" /></td>
                  <td className="px-3 py-2"><div className="h-4 w-20 bg-gray-100 rounded" /></td>
                  <td className="px-3 py-2"><div className="h-4 w-16 bg-gray-100 rounded ml-auto" /></td>
                  <td className="px-3 py-2"><div className="h-4 w-16 bg-gray-100 rounded ml-auto" /></td>
                  <td className="px-3 py-2"><div className="h-4 w-16 bg-gray-100 rounded mx-auto" /></td>
                </tr>
              ))
            ) : filteredTransactions.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-12 text-center text-gray-500">
                  {searchQuery ? 'No transactions match your search' : 'No transactions found'}
                </td>
              </tr>
            ) : (
              filteredTransactions.map(txn => {
                const statusConfig = STATUS_CONFIG[txn.status] || STATUS_CONFIG.unmatched
                const isCredit = txn.amount < 0
                const isSelected = selectedTxn?.id === txn.id

                return (
                  <tr
                    key={txn.id}
                    onClick={() => handleRowClick(txn)}
                    className={`
                      cursor-pointer transition-colors
                      ${isSelected ? 'bg-red-50 border-l-2 border-l-[#C10230]' : 'hover:bg-gray-50'}
                    `}
                  >
                    <td className="px-3 py-2 text-gray-600 whitespace-nowrap">
                      {txn.transaction_date}
                    </td>
                    <td className="px-3 py-2">
                      <div className="truncate max-w-xs text-gray-900" title={txn.description}>
                        {txn.description}
                      </div>
                      {txn.submitter_name && (
                        <div className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                          <User className="h-3 w-3" />
                          {txn.submitter_name}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className="text-gray-600 truncate block max-w-[100px]" title={txn.extracted_vendor || ''}>
                        {txn.extracted_vendor || '-'}
                      </span>
                    </td>
                    {/* Expense column - show positive amounts */}
                    <td className="px-3 py-2 text-right font-medium whitespace-nowrap text-gray-900">
                      {!isCredit ? formatCurrency(txn.amount) : ''}
                    </td>
                    {/* Deposit column - show negative amounts as positive */}
                    <td className="px-3 py-2 text-right font-medium whitespace-nowrap text-green-600">
                      {isCredit ? formatCurrency(Math.abs(txn.amount)) : ''}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${statusConfig.bgColor} ${statusConfig.color}`}>
                        {txn.status === 'matched' && <Check className="h-3 w-3" />}
                        {txn.status === 'unmatched' && <Clock className="h-3 w-3" />}
                        {txn.status === 'pending_review' && <AlertCircle className="h-3 w-3" />}
                        {statusConfig.label}
                      </span>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-3 py-2 border-t border-gray-100 bg-gray-50">
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            className="flex items-center gap-1 px-2 py-1 text-sm text-gray-600 hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="h-4 w-4" />
            Previous
          </button>

          <div className="flex items-center gap-1">
            {/* Page numbers */}
            {[...Array(Math.min(5, totalPages))].map((_, i) => {
              const pageNum = Math.max(0, Math.min(page - 2, totalPages - 5)) + i
              if (pageNum >= totalPages) return null
              return (
                <button
                  key={pageNum}
                  onClick={() => setPage(pageNum)}
                  className={`w-8 h-8 rounded text-sm ${
                    page === pageNum
                      ? 'bg-[#C10230] text-white'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {pageNum + 1}
                </button>
              )
            })}
          </div>

          <button
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="flex items-center gap-1 px-2 py-1 text-sm text-gray-600 hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Transaction Detail Panel (Slide-out) */}
      {selectedTxn && (
        <div className="fixed top-0 right-0 w-80 h-screen bg-white border-l border-gray-200 shadow-lg overflow-y-auto z-50">
          <div className="sticky top-0 bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between">
            <h3 className="font-medium text-gray-900">Transaction Details</h3>
            <button
              onClick={() => setSelectedTxn(null)}
              className="p-1 text-gray-400 hover:text-gray-600"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="p-4 space-y-4">
            {/* Amount */}
            <div className={`text-center py-4 rounded-lg ${selectedTxn.amount < 0 ? 'bg-green-50' : 'bg-gray-50'}`}>
              <div className={`text-2xl font-bold ${selectedTxn.amount < 0 ? 'text-green-600' : 'text-gray-900'}`}>
                {selectedTxn.amount < 0 ? '+' : ''}{formatCurrency(Math.abs(selectedTxn.amount))}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {selectedTxn.amount < 0 ? 'Credit / Refund' : 'Expense'}
              </div>
            </div>

            {/* Details */}
            <div className="space-y-3">
              <DetailRow label="Date" value={selectedTxn.transaction_date} />
              {isEditing ? (
                <div className="space-y-1">
                  <label className="text-xs text-gray-500">Description</label>
                  <textarea
                    value={editForm.description}
                    onChange={(e) => setEditForm(f => ({ ...f, description: e.target.value }))}
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C10230] focus:border-transparent resize-none"
                    rows={3}
                  />
                </div>
              ) : (
                <DetailRow
                  label="Description"
                  value={selectedTxn.description}
                  onCopy={() => copyToClipboard(selectedTxn.description)}
                />
              )}
              {isEditing ? (
                <div className="space-y-1">
                  <label className="text-xs text-gray-500">Vendor</label>
                  <input
                    type="text"
                    value={editForm.extracted_vendor}
                    onChange={(e) => setEditForm(f => ({ ...f, extracted_vendor: e.target.value }))}
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C10230] focus:border-transparent"
                    placeholder="Vendor name"
                  />
                </div>
              ) : (
                <DetailRow label="Vendor" value={selectedTxn.extracted_vendor || '-'} />
              )}
              <DetailRow label="Source" value={selectedTxn.source} />
              {isEditing ? (
                <div className="space-y-1">
                  <label className="text-xs text-gray-500">Status</label>
                  <select
                    value={editForm.status}
                    onChange={(e) => setEditForm(f => ({ ...f, status: e.target.value }))}
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C10230] focus:border-transparent bg-white"
                  >
                    <option value="unmatched">Unmatched</option>
                    <option value="matched">Matched</option>
                    <option value="orphan_processed">Orphan</option>
                    <option value="pending_review">Pending Review</option>
                  </select>
                  {selectedTxn.status === 'matched' && editForm.status === 'unmatched' && (
                    <p className="text-xs text-amber-600 mt-1">
                      This will clear the matched expense link
                    </p>
                  )}
                </div>
              ) : (
                <DetailRow label="Status" value={
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_CONFIG[selectedTxn.status]?.bgColor || 'bg-gray-100'} ${STATUS_CONFIG[selectedTxn.status]?.color || 'text-gray-600'}`}>
                    {STATUS_CONFIG[selectedTxn.status]?.label || selectedTxn.status}
                  </span>
                } />
              )}
              {selectedTxn.extracted_state && (
                <DetailRow label="State" value={selectedTxn.extracted_state} />
              )}
              {selectedTxn.matched_expense_id && (
                <DetailRow label="Zoho Expense ID" value={selectedTxn.matched_expense_id} />
              )}
              {selectedTxn.match_confidence !== null && selectedTxn.match_confidence !== undefined && (
                <DetailRow label="Confidence" value={`${selectedTxn.match_confidence}%`} />
              )}
              {selectedTxn.matched_by && (
                <DetailRow label="Matched By" value={selectedTxn.matched_by === 'agent' ? 'AI Agent' : 'Human'} />
              )}
              {selectedTxn.matched_at && (
                <DetailRow label="Matched At" value={new Date(selectedTxn.matched_at).toLocaleString()} />
              )}
            </div>

            {/* Expense Report Section */}
            {selectedTxn.status === 'matched' ? (
              <div className="pt-4 border-t border-gray-100">
                <div className="flex items-center gap-2 mb-3">
                  <FileText className="h-4 w-4 text-gray-500" />
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Expense Report</h4>
                </div>
                {isLoadingReport ? (
                  <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-500 text-center">
                    Loading report details...
                  </div>
                ) : reportDetails ? (
                  <div className="bg-gray-50 rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-500">Report #</span>
                      <span className="text-sm font-medium text-gray-900">{reportDetails.report_number}</span>
                    </div>
                    {reportDetails.report_name && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-500">Name</span>
                        <span className="text-sm text-gray-900 text-right max-w-[160px] truncate" title={reportDetails.report_name}>{reportDetails.report_name}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-500">Submitted by</span>
                      <span className="text-sm text-gray-900">{reportDetails.submitter_name}</span>
                    </div>
                    {reportDetails.submitter_email && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-500">Email</span>
                        <a
                          href={`mailto:${reportDetails.submitter_email}`}
                          className="text-sm text-blue-600 hover:underline flex items-center gap-1"
                        >
                          <Mail className="h-3 w-3" />
                          {reportDetails.submitter_email}
                        </a>
                      </div>
                    )}
                    {reportDetails.submitted_at && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-500">Submitted</span>
                        <span className="text-sm text-gray-900">{new Date(reportDetails.submitted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                      </div>
                    )}
                    {reportDetails.approver_name && (
                      <>
                        <div className="border-t border-gray-200 my-2" />
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-gray-500">Approved by</span>
                          <span className="text-sm text-gray-900">{reportDetails.approver_name}</span>
                        </div>
                        {reportDetails.approved_at && (
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-gray-500">Approved</span>
                            <span className="text-sm text-gray-900">{new Date(reportDetails.approved_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ) : (
                  <div className="bg-amber-50 rounded-lg p-3 text-sm text-amber-700">
                    Expense not linked to report yet. Run sync to populate.
                  </div>
                )}
              </div>
            ) : selectedTxn.status === 'orphan_processed' ? (
              <div className="pt-4 border-t border-gray-100">
                <div className="bg-purple-50 rounded-lg p-3 text-sm text-purple-700">
                  Processed as orphan - no Zoho expense report
                </div>
              </div>
            ) : selectedTxn.status === 'unmatched' ? (
              <div className="pt-4 border-t border-gray-100">
                <div className="bg-blue-50 rounded-lg p-3 text-sm text-blue-700">
                  Pending match to Zoho expense
                </div>
              </div>
            ) : null}

            {/* Actions */}
            <div className="pt-4 border-t border-gray-100 space-y-2">
              {isEditing ? (
                <>
                  <Button size="sm" className="w-full justify-center" onClick={saveEdit} disabled={isSaving}>
                    <Save className="h-4 w-4 mr-2" />
                    {isSaving ? 'Saving...' : 'Save Changes'}
                  </Button>
                  <Button variant="outline" size="sm" className="w-full justify-center" onClick={cancelEditing} disabled={isSaving}>
                    <XCircle className="h-4 w-4 mr-2" />
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="outline" size="sm" className="w-full justify-center" onClick={startEditing}>
                    <Edit2 className="h-4 w-4 mr-2" />
                    Edit Transaction
                  </Button>
                  {selectedTxn.status === 'unmatched' && (
                    <Button size="sm" className="w-full justify-center">
                      Match to Expense
                    </Button>
                  )}
                </>
              )}
            </div>

            {/* Metadata */}
            <div className="pt-4 border-t border-gray-100 text-xs text-gray-400">
              <div>ID: {selectedTxn.id}</div>
              <div>Created: {new Date(selectedTxn.created_at || '').toLocaleString()}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function DetailRow({ label, value, onCopy }: { label: string; value: React.ReactNode; onCopy?: () => void }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="text-xs text-gray-500 flex-shrink-0">{label}</span>
      <div className="flex items-center gap-1">
        <span className="text-sm text-gray-900 text-right break-words max-w-[180px]">{value}</span>
        {onCopy && (
          <button onClick={onCopy} className="p-0.5 text-gray-400 hover:text-gray-600">
            <Copy className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  )
}
