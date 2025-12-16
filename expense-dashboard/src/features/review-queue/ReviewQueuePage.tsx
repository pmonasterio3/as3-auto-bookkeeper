import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate, formatRelativeTime } from '@/lib/utils'
import type { ExpenseQueueItem } from '@/types/database'
import { Card, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { CheckCircle, XCircle, Eye, RefreshCw } from 'lucide-react'

export function ReviewQueuePage() {
  const [expenses, setExpenses] = useState<ExpenseQueueItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchExpenses = async () => {
    setIsLoading(true)
    try {
      const { data, error } = await supabase
        .from('expense_queue')
        .select('*')
        .eq('status', 'pending')
        .eq('is_reimbursement', false)
        .order('created_at', { ascending: false })

      if (error) throw error
      setExpenses((data as ExpenseQueueItem[]) || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load expenses')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchExpenses()
  }, [])

  const handleApprove = async (id: string) => {
    try {
      const { error } = await supabase
        .from('expense_queue')
        .update({ status: 'approved', reviewed_at: new Date().toISOString() })
        .eq('id', id)

      if (error) throw error
      fetchExpenses()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to approve')
    }
  }

  const handleReject = async (id: string) => {
    try {
      const { error } = await supabase
        .from('expense_queue')
        .update({ status: 'rejected', reviewed_at: new Date().toISOString() })
        .eq('id', id)

      if (error) throw error
      fetchExpenses()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to reject')
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#C10230]" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4 rounded-lg bg-red-50 border border-red-200">
        <p className="text-red-600">Error: {error}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Review Queue</h1>
          <p className="mt-1 text-gray-500">
            {expenses.length} expense{expenses.length !== 1 ? 's' : ''} pending review
          </p>
        </div>
        <Button variant="outline" onClick={fetchExpenses}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Empty state */}
      {expenses.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900">All caught up!</h3>
            <p className="mt-1 text-gray-500">No expenses pending review</p>
          </CardContent>
        </Card>
      ) : (
        /* Expense list */
        <div className="space-y-4">
          {expenses.map((expense) => (
            <Card key={expense.id}>
              <CardContent className="py-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <h3 className="text-lg font-medium text-gray-900">
                        {expense.vendor_name}
                      </h3>
                      <Badge variant="status" status={expense.status}>
                        {expense.status}
                      </Badge>
                      {expense.confidence_score && (
                        <Badge variant={expense.confidence_score >= 95 ? 'success' : 'warning'}>
                          {expense.confidence_score}% confidence
                        </Badge>
                      )}
                    </div>
                    <div className="mt-2 flex items-center gap-6 text-sm text-gray-500">
                      <span>{formatCurrency(expense.amount)}</span>
                      <span>{formatDate(expense.expense_date)}</span>
                      <span>{expense.category_name || 'Uncategorized'}</span>
                      {expense.paid_through && (
                        <span className="text-gray-400">{expense.paid_through}</span>
                      )}
                    </div>
                    {expense.flag_reason && (
                      <p className="mt-2 text-sm text-orange-600">
                        Flag reason: {expense.flag_reason}
                      </p>
                    )}
                    <div className="mt-2 flex items-center gap-4 text-xs text-gray-400">
                      <span>Report: {expense.zoho_report_name || 'N/A'}</span>
                      <span>Added: {formatRelativeTime(expense.created_at)}</span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 ml-4">
                    {expense.receipt_url && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => window.open(expense.receipt_url!, '_blank')}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleApprove(expense.id)}
                      className="text-green-600 hover:text-green-700 hover:bg-green-50"
                    >
                      <CheckCircle className="h-4 w-4 mr-1" />
                      Approve
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleReject(expense.id)}
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                    >
                      <XCircle className="h-4 w-4 mr-1" />
                      Reject
                    </Button>
                  </div>
                </div>

                {/* AI Suggestions */}
                {(expense.category_suggested || expense.state_suggested) && (
                  <div className="mt-4 pt-4 border-t border-gray-100">
                    <p className="text-xs font-medium text-gray-500 mb-2">AI Suggestions</p>
                    <div className="flex gap-4 text-sm">
                      {expense.category_suggested && (
                        <span>
                          Category: <strong>{expense.category_suggested}</strong>
                        </span>
                      )}
                      {expense.state_suggested && (
                        <span>
                          State: <strong>{expense.state_suggested}</strong>
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
