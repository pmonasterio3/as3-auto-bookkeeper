import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { formatRelativeTime, formatCurrency } from '@/lib/utils'
import type { BankAccount } from '@/types/database'
import { CreditCard, Building, RefreshCw, Clock, AlertTriangle } from 'lucide-react'

export interface AccountStats {
  account_key: string
  display_name: string
  bank_name: string
  account_type: string
  unmatched: number
  matched: number
  orphan: number
  total: number
  totalAmount: number
  lastImport: string | null
  isStale: boolean
}

interface AccountConsoleProps {
  selectedAccount: string | null
  onSelectAccount: (accountKey: string | null) => void
  onStatsUpdate?: (stats: AccountStats[]) => void
}

export function AccountConsole({ selectedAccount, onSelectAccount, onStatsUpdate }: AccountConsoleProps) {
  const [accounts, setAccounts] = useState<AccountStats[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)

  const fetchStats = useCallback(async () => {
    try {
      // Fetch bank accounts
      const { data: bankAccounts } = await supabase
        .from('bank_accounts')
        .select('*')
        .eq('is_active', true)
        .order('display_name')

      if (!bankAccounts) return

      // Fetch all transactions grouped by source and status
      const { data: transactions } = await supabase
        .from('bank_transactions')
        .select('source, status, amount, created_at')

      const txnList = (transactions || []) as Array<{
        source: string
        status: string
        amount: number
        created_at: string
      }>

      // Build stats for each account
      const stats: AccountStats[] = (bankAccounts as BankAccount[]).map(account => {
        const accountTxns = txnList.filter(t => t.source === account.account_key)
        const lastTxn = accountTxns.sort((a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )[0]

        const lastImport = lastTxn?.created_at || account.last_import_at || null
        const daysSinceImport = lastImport
          ? Math.floor((Date.now() - new Date(lastImport).getTime()) / (1000 * 60 * 60 * 24))
          : Infinity

        // Only count expenses (positive amounts) - negative amounts are income/deposits
        const expenseTxns = accountTxns.filter(t => (t.amount || 0) > 0)

        return {
          account_key: account.account_key,
          display_name: account.display_name,
          bank_name: account.bank_name,
          account_type: account.account_type,
          unmatched: expenseTxns.filter(t => t.status === 'unmatched').length,
          matched: expenseTxns.filter(t => t.status === 'matched').length,
          orphan: expenseTxns.filter(t => t.status === 'orphan_processed').length,
          total: expenseTxns.length,
          totalAmount: expenseTxns.reduce((sum, t) => sum + (t.amount || 0), 0),
          lastImport,
          isStale: daysSinceImport > 5,
        }
      })

      setAccounts(stats)
      onStatsUpdate?.(stats)
    } catch (err) {
      console.error('Failed to fetch account stats:', err)
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [onStatsUpdate])

  useEffect(() => {
    fetchStats()
  }, [fetchStats])

  const handleRefresh = () => {
    setIsRefreshing(true)
    fetchStats()
  }

  const totalUnmatched = accounts.reduce((sum, a) => sum + a.unmatched, 0)

  if (isLoading) {
    return (
      <div className="flex gap-3 overflow-x-auto pb-2">
        {[1, 2, 3].map(i => (
          <div key={i} className="flex-shrink-0 w-48 h-20 bg-gray-100 rounded-lg animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Account Cards Row */}
      <div className="flex gap-3 overflow-x-auto pb-1">
        {/* "All Accounts" card */}
        <button
          onClick={() => onSelectAccount(null)}
          className={`
            flex-shrink-0 rounded-lg border-2 p-3 text-left transition-all min-w-[180px]
            ${selectedAccount === null
              ? 'border-[#C10230] bg-red-50 shadow-sm'
              : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm'
            }
          `}
        >
          <div className="flex items-center justify-between mb-1">
            <span className={`text-sm font-medium ${selectedAccount === null ? 'text-[#C10230]' : 'text-gray-700'}`}>
              All Accounts
            </span>
            {totalUnmatched > 0 && (
              <span className={`
                text-xs font-bold px-1.5 py-0.5 rounded
                ${totalUnmatched > 50 ? 'bg-red-500 text-white' : 'bg-amber-100 text-amber-700'}
              `}>
                {totalUnmatched > 99 ? '99+' : totalUnmatched}
              </span>
            )}
          </div>
          <div className="text-lg font-semibold text-gray-900">
            {formatCurrency(accounts.reduce((sum, a) => sum + a.totalAmount, 0))}
          </div>
          <div className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
            {accounts.reduce((sum, a) => sum + a.total, 0)} transactions
          </div>
        </button>

        {/* Individual Account Cards */}
        {accounts.map(account => (
          <button
            key={account.account_key}
            onClick={() => onSelectAccount(account.account_key)}
            className={`
              flex-shrink-0 rounded-lg border-2 p-3 text-left transition-all min-w-[180px]
              ${selectedAccount === account.account_key
                ? 'border-[#C10230] bg-red-50 shadow-sm'
                : account.isStale
                  ? 'border-amber-300 bg-amber-50 hover:border-amber-400'
                  : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm'
              }
            `}
          >
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1.5">
                {account.account_type === 'credit_card' ? (
                  <CreditCard className="h-3.5 w-3.5 text-purple-500" />
                ) : (
                  <Building className="h-3.5 w-3.5 text-green-600" />
                )}
                <span className={`text-sm font-medium truncate max-w-[100px] ${
                  selectedAccount === account.account_key ? 'text-[#C10230]' : 'text-gray-700'
                }`}>
                  {account.display_name}
                </span>
              </div>
              {account.unmatched > 0 && (
                <span className={`
                  text-xs font-bold px-1.5 py-0.5 rounded
                  ${account.unmatched > 50 ? 'bg-red-500 text-white' : 'bg-blue-100 text-blue-700'}
                `}>
                  {account.unmatched > 99 ? '99+' : account.unmatched}
                </span>
              )}
            </div>
            <div className="text-lg font-semibold text-gray-900">
              {formatCurrency(account.totalAmount)}
            </div>
            <div className="flex items-center gap-1 mt-0.5">
              {account.isStale ? (
                <>
                  <AlertTriangle className="h-3 w-3 text-amber-500" />
                  <span className="text-xs text-amber-600">
                    {account.lastImport ? formatRelativeTime(account.lastImport) : 'Never imported'}
                  </span>
                </>
              ) : (
                <>
                  <Clock className="h-3 w-3 text-gray-400" />
                  <span className="text-xs text-gray-500">
                    {account.lastImport ? formatRelativeTime(account.lastImport) : 'Never imported'}
                  </span>
                </>
              )}
            </div>
          </button>
        ))}

        {/* Refresh button */}
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="flex-shrink-0 flex items-center justify-center w-10 h-20 rounded-lg border border-dashed border-gray-300 text-gray-400 hover:border-gray-400 hover:text-gray-500 transition-colors"
        >
          <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>
    </div>
  )
}
