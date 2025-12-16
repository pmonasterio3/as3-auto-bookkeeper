import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency } from '@/lib/utils'
import { CheckCircle, AlertTriangle, TrendingUp, DollarSign, Edit3 } from 'lucide-react'

interface HealthMetrics {
  autoRate: number
  totalProcessedThisWeek: number
  amountThisWeek: number
  correctionsThisWeek: number
  pendingCount: number
}

export function SystemHealthBar() {
  const [metrics, setMetrics] = useState<HealthMetrics | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    fetchMetrics()
  }, [])

  async function fetchMetrics() {
    try {
      // Get auto rate (matched + orphan_processed vs total recent)
      const { data: recentTxns } = await supabase
        .from('bank_transactions')
        .select('status')
        .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())

      const total = recentTxns?.length || 0
      const autoProcessed = recentTxns?.filter(t =>
        t.status === 'matched' || t.status === 'orphan_processed'
      ).length || 0

      const autoRate = total > 0 ? Math.round((autoProcessed / total) * 100) : 0

      // Get amount processed this week
      const { data: processedTxns } = await supabase
        .from('bank_transactions')
        .select('amount')
        .in('status', ['matched', 'orphan_processed'])
        .gte('updated_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())

      const amountThisWeek = processedTxns?.reduce((sum, t) => sum + (t.amount || 0), 0) || 0

      // Get corrections this week
      const { data: corrections } = await supabase
        .from('categorization_history')
        .select('id')
        .eq('was_corrected', true)
        .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())

      // Get pending count
      const { data: pending } = await supabase
        .from('expense_queue')
        .select('id')
        .eq('status', 'pending')

      const { data: orphans } = await supabase
        .from('bank_transactions')
        .select('id')
        .eq('status', 'unmatched')
        .lt('transaction_date', new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString())

      setMetrics({
        autoRate,
        totalProcessedThisWeek: processedTxns?.length || 0,
        amountThisWeek,
        correctionsThisWeek: corrections?.length || 0,
        pendingCount: (pending?.length || 0) + (orphans?.length || 0),
      })
    } catch (err) {
      console.error('Failed to fetch health metrics:', err)
    } finally {
      setIsLoading(false)
    }
  }

  if (isLoading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-3 animate-pulse">
        <div className="flex gap-6">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-12 w-36 bg-gray-100 rounded" />
          ))}
        </div>
      </div>
    )
  }

  if (!metrics) return null

  const isHealthy = metrics.autoRate >= 80 && metrics.pendingCount < 50
  const autoRateColor = metrics.autoRate >= 80 ? 'text-green-600' : metrics.autoRate >= 60 ? 'text-amber-600' : 'text-red-600'

  return (
    <div className={`flex items-center gap-4 px-3 py-2 rounded-lg text-sm ${isHealthy ? 'bg-green-50' : 'bg-amber-50'}`}>
      {/* Health Status */}
      <div className="flex items-center gap-1.5">
        {isHealthy ? (
          <CheckCircle className="h-4 w-4 text-green-600" />
        ) : (
          <AlertTriangle className="h-4 w-4 text-amber-600" />
        )}
        <span className={`font-medium ${isHealthy ? 'text-green-700' : 'text-amber-700'}`}>
          {metrics.pendingCount} pending
        </span>
      </div>

      <span className="text-gray-300">|</span>

      {/* Auto Rate */}
      <div className="flex items-center gap-1.5">
        <TrendingUp className={`h-4 w-4 ${autoRateColor}`} />
        <span className={`font-medium ${autoRateColor}`}>
          {metrics.autoRate}% auto
        </span>
      </div>

      <span className="text-gray-300">|</span>

      {/* This Week */}
      <div className="flex items-center gap-1.5">
        <DollarSign className="h-4 w-4 text-gray-500" />
        <span className="text-gray-600">
          {formatCurrency(metrics.amountThisWeek)} this week
        </span>
      </div>

      {metrics.correctionsThisWeek > 0 && (
        <>
          <span className="text-gray-300">|</span>
          <div className="flex items-center gap-1.5">
            <Edit3 className="h-4 w-4 text-gray-500" />
            <span className="text-gray-600">
              {metrics.correctionsThisWeek} corrections
            </span>
          </div>
        </>
      )}
    </div>
  )
}
