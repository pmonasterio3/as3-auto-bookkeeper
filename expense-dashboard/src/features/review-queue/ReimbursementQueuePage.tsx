import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate, formatRelativeTime } from '@/lib/utils'
import type { ExpenseQueueItem } from '@/types/database'
import { Card, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { DollarSign, CheckCircle, RefreshCw, Eye } from 'lucide-react'

export function ReimbursementQueuePage() {
  const [expenses, setExpenses] = useState<ExpenseQueueItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchExpenses = async () => {
    setIsLoading(true)
    try {
      const { data, error } = await supabase
        .from('expense_queue')
        .select('*')
        .eq('is_reimbursement', true)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })

      if (error) throw error
      setExpenses((data as ExpenseQueueItem[]) || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load reimbursements')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchExpenses()
  }, [])

  const handleMarkReimbursed = async (id: string, method: string) => {
    try {
      const { error } = await supabase
        .from('expense_queue')
        .update({
          status: 'approved',
          reimbursement_method: method,
          reimbursed_at: new Date().toISOString(),
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', id)

      if (error) throw error
      fetchExpenses()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to mark as reimbursed')
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
          <h1 className="text-2xl font-bold text-gray-900">Reimbursement Queue</h1>
          <p className="mt-1 text-gray-500">
            {expenses.length} expense{expenses.length !== 1 ? 's' : ''} awaiting reimbursement
          </p>
        </div>
        <Button variant="outline" onClick={fetchExpenses}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Info banner */}
      <div className="p-4 rounded-lg bg-teal-50 border border-teal-200">
        <p className="text-sm text-teal-700">
          These expenses were submitted via Zoho but have no matching bank transaction.
          They were paid with a personal card and require reimbursement.
        </p>
      </div>

      {/* Empty state */}
      {expenses.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <DollarSign className="h-12 w-12 text-green-500 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900">No pending reimbursements</h3>
            <p className="mt-1 text-gray-500">All reimbursements have been processed</p>
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
                      <Badge variant="info">Reimbursement</Badge>
                    </div>
                    <div className="mt-2 flex items-center gap-6 text-sm text-gray-500">
                      <span className="text-lg font-semibold text-gray-900">
                        {formatCurrency(expense.amount)}
                      </span>
                      <span>{formatDate(expense.expense_date)}</span>
                      <span>{expense.category_name || 'Uncategorized'}</span>
                    </div>
                    <div className="mt-2 flex items-center gap-4 text-xs text-gray-400">
                      <span>Report: {expense.zoho_report_name || 'N/A'}</span>
                      <span>Submitted: {formatRelativeTime(expense.created_at)}</span>
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
                      onClick={() => handleMarkReimbursed(expense.id, 'check')}
                    >
                      Check
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleMarkReimbursed(expense.id, 'zelle')}
                    >
                      Zelle
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => handleMarkReimbursed(expense.id, 'payroll')}
                    >
                      <CheckCircle className="h-4 w-4 mr-1" />
                      Payroll
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
