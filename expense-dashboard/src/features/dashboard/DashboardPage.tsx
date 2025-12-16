import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ClipboardList,
  Receipt,
  DollarSign,
  AlertTriangle,
  CheckCircle,
  TrendingUp,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatCurrency } from '@/lib/utils'
import type { DashboardStats } from '@/types/database'
import { StatCard } from './StatCard'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'

export function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchStats() {
      try {
        const { data, error } = await supabase
          .from('dashboard_stats')
          .select('*')
          .single()

        if (error) throw error
        setStats(data as DashboardStats)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load stats')
      } finally {
        setIsLoading(false)
      }
    }

    fetchStats()
  }, [])

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
    <div className="space-y-8">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="mt-1 text-gray-500">Overview of expense processing status</p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          title="Pending Reviews"
          value={stats?.pending_reviews ?? 0}
          icon={<ClipboardList className="h-6 w-6" />}
          variant={stats?.pending_reviews && stats.pending_reviews > 0 ? 'warning' : 'default'}
        />
        <StatCard
          title="Pending Reimbursements"
          value={stats?.pending_reimbursements ?? 0}
          icon={<DollarSign className="h-6 w-6" />}
          variant={stats?.pending_reimbursements && stats.pending_reimbursements > 0 ? 'warning' : 'default'}
        />
        <StatCard
          title="Unmatched Bank Txns"
          value={stats?.unmatched_bank_txns ?? 0}
          icon={<Receipt className="h-6 w-6" />}
          variant={stats?.unmatched_bank_txns && stats.unmatched_bank_txns > 0 ? 'warning' : 'default'}
        />
        <StatCard
          title="Orphan Transactions"
          value={stats?.orphan_bank_txns ?? 0}
          icon={<AlertTriangle className="h-6 w-6" />}
          variant={stats?.orphan_bank_txns && stats.orphan_bank_txns > 5 ? 'error' : 'default'}
        />
      </div>

      {/* Second row - Processing stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          title="Processed Today"
          value={stats?.processed_today ?? 0}
          icon={<CheckCircle className="h-6 w-6" />}
          variant="success"
        />
        <StatCard
          title="Amount Today"
          value={formatCurrency(stats?.amount_today ?? 0)}
          icon={<DollarSign className="h-6 w-6" />}
          variant="success"
        />
        <StatCard
          title="Corrections This Week"
          value={stats?.corrections_this_week ?? 0}
          icon={<TrendingUp className="h-6 w-6" />}
        />
        <StatCard
          title="Amount This Week"
          value={formatCurrency(stats?.amount_this_week ?? 0)}
          icon={<TrendingUp className="h-6 w-6" />}
        />
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Link to="/review">
              <Button variant="outline" className="w-full justify-start">
                <ClipboardList className="h-4 w-4 mr-2" />
                Review Pending Expenses
                {stats?.pending_reviews ? (
                  <span className="ml-auto bg-yellow-100 text-yellow-800 text-xs font-medium px-2 py-0.5 rounded-full">
                    {stats.pending_reviews}
                  </span>
                ) : null}
              </Button>
            </Link>
            <Link to="/orphans">
              <Button variant="outline" className="w-full justify-start">
                <Receipt className="h-4 w-4 mr-2" />
                Process Orphan Transactions
                {stats?.orphan_bank_txns ? (
                  <span className="ml-auto bg-orange-100 text-orange-800 text-xs font-medium px-2 py-0.5 rounded-full">
                    {stats.orphan_bank_txns}
                  </span>
                ) : null}
              </Button>
            </Link>
            <Link to="/reimbursements">
              <Button variant="outline" className="w-full justify-start">
                <DollarSign className="h-4 w-4 mr-2" />
                Process Reimbursements
                {stats?.pending_reimbursements ? (
                  <span className="ml-auto bg-teal-100 text-teal-800 text-xs font-medium px-2 py-0.5 rounded-full">
                    {stats.pending_reimbursements}
                  </span>
                ) : null}
              </Button>
            </Link>
            <Link to="/import">
              <Button variant="outline" className="w-full justify-start">
                <Receipt className="h-4 w-4 mr-2" />
                Import Bank Transactions
              </Button>
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>System Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Bank Sync Status</span>
                <span className="flex items-center text-sm font-medium text-green-600">
                  <span className="h-2 w-2 bg-green-500 rounded-full mr-2" />
                  Connected
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">QuickBooks Sync</span>
                <span className="flex items-center text-sm font-medium text-green-600">
                  <span className="h-2 w-2 bg-green-500 rounded-full mr-2" />
                  Connected
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Monday.com Sync</span>
                <span className="flex items-center text-sm font-medium text-green-600">
                  <span className="h-2 w-2 bg-green-500 rounded-full mr-2" />
                  Connected
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Auto-Match Rate</span>
                <span className="text-sm font-medium text-gray-900">85%</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
