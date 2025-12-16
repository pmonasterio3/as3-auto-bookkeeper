import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate, formatRelativeTime } from '@/lib/utils'
import type { BankTransaction } from '@/types/database'
import { Card, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Receipt, CheckCircle, RefreshCw, X } from 'lucide-react'

export function OrphanQueuePage() {
  const [transactions, setTransactions] = useState<BankTransaction[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchTransactions = async () => {
    setIsLoading(true)
    try {
      const { data, error } = await supabase
        .from('bank_transactions')
        .select('*')
        .eq('status', 'unmatched')
        .order('transaction_date', { ascending: false })

      if (error) throw error
      setTransactions((data as BankTransaction[]) || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load transactions')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchTransactions()
  }, [])

  const handleExclude = async (id: string) => {
    try {
      const { error } = await supabase
        .from('bank_transactions')
        .update({ status: 'excluded' })
        .eq('id', id)

      if (error) throw error
      fetchTransactions()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to exclude transaction')
    }
  }

  const handleProcessOrphan = async (id: string, category: string, state: string) => {
    try {
      const { error } = await supabase
        .from('bank_transactions')
        .update({
          status: 'orphan_processed',
          orphan_category: category,
          orphan_state: state,
          orphan_determination_method: 'human',
          orphan_processed_at: new Date().toISOString(),
        })
        .eq('id', id)

      if (error) throw error
      fetchTransactions()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to process transaction')
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

  // Separate into orphans (>5 days old) and recent unmatched
  const now = new Date()
  const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000)
  const orphans = transactions.filter(t => new Date(t.transaction_date) < fiveDaysAgo)
  const recent = transactions.filter(t => new Date(t.transaction_date) >= fiveDaysAgo)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Orphan Transactions</h1>
          <p className="mt-1 text-gray-500">
            Bank transactions with no matching Zoho expense
          </p>
        </div>
        <Button variant="outline" onClick={fetchTransactions}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4">
        <div className="p-4 rounded-lg bg-orange-50 border border-orange-200">
          <p className="text-sm text-orange-600">Orphans (5+ days old)</p>
          <p className="text-2xl font-bold text-orange-700">{orphans.length}</p>
        </div>
        <div className="p-4 rounded-lg bg-teal-50 border border-teal-200">
          <p className="text-sm text-teal-600">Recent Unmatched</p>
          <p className="text-2xl font-bold text-teal-700">{recent.length}</p>
        </div>
      </div>

      {/* Empty state */}
      {transactions.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Receipt className="h-12 w-12 text-green-500 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900">All transactions matched!</h3>
            <p className="mt-1 text-gray-500">No orphan transactions to process</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Orphans section */}
          {orphans.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-orange-700">
                Orphan Transactions (5+ days)
              </h2>
              {orphans.map((txn) => (
                <TransactionCard
                  key={txn.id}
                  transaction={txn}
                  onExclude={handleExclude}
                  onProcess={handleProcessOrphan}
                  isOrphan
                />
              ))}
            </div>
          )}

          {/* Recent unmatched section */}
          {recent.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-gray-700">
                Recent Unmatched (waiting for Zoho expense)
              </h2>
              {recent.map((txn) => (
                <TransactionCard
                  key={txn.id}
                  transaction={txn}
                  onExclude={handleExclude}
                  onProcess={handleProcessOrphan}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

interface TransactionCardProps {
  transaction: BankTransaction
  onExclude: (id: string) => void
  onProcess: (id: string, category: string, state: string) => void
  isOrphan?: boolean
}

function TransactionCard({ transaction, onExclude, onProcess, isOrphan }: TransactionCardProps) {
  return (
    <Card className={isOrphan ? 'border-orange-200' : ''}>
      <CardContent className="py-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h3 className="text-lg font-medium text-gray-900">
                {transaction.extracted_vendor || transaction.description.slice(0, 40)}
              </h3>
              <Badge variant={transaction.source === 'amex' ? 'info' : 'default'}>
                {transaction.source === 'amex' ? 'AMEX' : 'Wells Fargo'}
              </Badge>
              {transaction.extracted_state && (
                <Badge variant="default">{transaction.extracted_state}</Badge>
              )}
            </div>
            <div className="mt-2 flex items-center gap-6 text-sm text-gray-500">
              <span className="text-lg font-semibold text-gray-900">
                {formatCurrency(transaction.amount)}
              </span>
              <span>{formatDate(transaction.transaction_date)}</span>
            </div>
            <p className="mt-2 text-xs text-gray-400 font-mono">
              {transaction.description}
            </p>
            <div className="mt-2 text-xs text-gray-400">
              Imported: {formatRelativeTime(transaction.created_at)}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 ml-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onExclude(transaction.id)}
              className="text-gray-400 hover:text-gray-600"
            >
              <X className="h-4 w-4 mr-1" />
              Exclude
            </Button>
            {isOrphan && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => onProcess(transaction.id, 'Travel - Courses COS', 'CA')}
              >
                <CheckCircle className="h-4 w-4 mr-1" />
                Process
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
