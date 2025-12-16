import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import type { BankTransaction, ExpenseQueueItem, FlaggedExpense } from '@/types/database'
import type { AttentionItem, ReimbursementData, OrphanData, LowConfidenceData, FlaggedExpenseData } from './types'
import { ReimbursementCard } from './ReimbursementCard'
import { OrphanCard } from './OrphanCard'
import { LowConfidenceCard } from './LowConfidenceCard'
import { FlaggedExpenseCard } from './FlaggedExpenseCard'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import {
  RefreshCw,
  CheckCircle,
  DollarSign,
  Building2,
  AlertTriangle,
  Flag,
} from 'lucide-react'

type FilterType = 'all' | 'reimbursement' | 'orphan' | 'low_confidence' | 'flagged'

export function AttentionQueue() {
  const [items, setItems] = useState<AttentionItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [filter, setFilter] = useState<FilterType>('all')

  const fetchItems = useCallback(async () => {
    setIsLoading(true)
    try {
      // Fetch vendor rules for AI analysis
      const { data: rules } = await supabase
        .from('vendor_rules')
        .select('*')

      const vendorRules = (rules || []) as Array<{ vendor_pattern: string; default_category: string | null; category: string; default_state: string | null; state_tag: string }>

      // Fetch reimbursements (expense with no bank match)
      const { data: reimbursements } = await supabase
        .from('expense_queue')
        .select('*')
        .eq('is_reimbursement', true)
        .eq('status', 'pending')
        .order('created_at', { ascending: true })

      // Fetch orphans (bank transactions >5 days old with no match)
      const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      const { data: orphans } = await supabase
        .from('bank_transactions')
        .select('*')
        .eq('status', 'unmatched')
        .lt('transaction_date', fiveDaysAgo)
        .order('transaction_date', { ascending: true })

      // Fetch low confidence matches from expense_queue
      const { data: lowConfidence } = await supabase
        .from('expense_queue')
        .select('*')
        .eq('is_reimbursement', false)
        .eq('status', 'pending')
        .order('confidence_score', { ascending: true })

      // Fetch flagged expenses from flagged_expenses table
      const { data: flaggedExpenses } = await supabase
        .from('flagged_expenses')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: true })

      // Build attention items with priority
      const attentionItems: AttentionItem[] = []

      // Add reimbursements (priority 1)
      for (const expense of (reimbursements as ExpenseQueueItem[]) || []) {
        const daysWaiting = Math.floor(
          (Date.now() - new Date(expense.created_at || '').getTime()) / (1000 * 60 * 60 * 24)
        )
        attentionItems.push({
          type: 'reimbursement',
          id: expense.id,
          priority: 1,
          data: { expense, daysWaiting } as ReimbursementData,
        })
      }

      // Add orphans (priority 2)
      for (const txn of (orphans as BankTransaction[]) || []) {
        const daysOld = Math.floor(
          (Date.now() - new Date(txn.transaction_date).getTime()) / (1000 * 60 * 60 * 24)
        )

        // Determine category/state using vendor rules
        let suggestedCategory: string | null = null
        let suggestedState: string | null = null
        let determinationMethod: OrphanData['determinationMethod'] = 'manual'

        // Check vendor rules
        const vendorLower = (txn.extracted_vendor || txn.description || '').toLowerCase()
        const matchedRule = vendorRules.find(r =>
          vendorLower.includes(r.vendor_pattern.toLowerCase())
        )

        if (matchedRule) {
          suggestedCategory = matchedRule.default_category || matchedRule.category
          suggestedState = matchedRule.default_state || matchedRule.state_tag
          determinationMethod = 'vendor_rule'
        } else if (txn.extracted_state) {
          suggestedState = txn.extracted_state
          determinationMethod = 'parsed'
        }

        attentionItems.push({
          type: 'orphan',
          id: txn.id,
          priority: 2,
          data: {
            transaction: txn,
            daysOld,
            suggestedCategory,
            suggestedState,
            determinationMethod,
          } as OrphanData,
        })
      }

      // Add low confidence (priority 3)
      for (const expense of (lowConfidence as ExpenseQueueItem[]) || []) {
        // Try to find suggested bank transaction
        let suggestedTransaction: BankTransaction | null = null

        if (expense.suggested_bank_txn_id) {
          const { data: txn } = await supabase
            .from('bank_transactions')
            .select('*')
            .eq('id', expense.suggested_bank_txn_id)
            .single()

          suggestedTransaction = txn as BankTransaction
        }

        // Parse flag reasons
        const flagReasons: string[] = []
        if (expense.flag_reason) {
          flagReasons.push(...expense.flag_reason.split(';').map(r => r.trim()))
        }
        if (!suggestedTransaction) {
          flagReasons.push('No matching bank transaction found')
        }
        if (expense.confidence_score && expense.confidence_score < 80) {
          flagReasons.push(`Confidence score ${expense.confidence_score}% is below threshold`)
        }

        attentionItems.push({
          type: 'low_confidence',
          id: expense.id,
          priority: 3,
          data: {
            expense,
            suggestedTransaction,
            confidence: expense.confidence_score || 0,
            flagReasons,
          } as LowConfidenceData,
        })
      }

      // Add flagged expenses from flagged_expenses table (priority 1.5 - high priority)
      for (const flagged of (flaggedExpenses as FlaggedExpense[]) || []) {
        // Try to find suggested bank transaction if bank_transaction_id exists
        let suggestedTransaction: BankTransaction | null = null

        // The flagged expense stores bank_transaction_id directly (cast to extended type)
        const flaggedWithBankTxn = flagged as FlaggedExpense & { bank_transaction_id?: string }
        const bankTxnId = flaggedWithBankTxn.bank_transaction_id
        if (bankTxnId) {
          const { data: txn } = await supabase
            .from('bank_transactions')
            .select('*')
            .eq('id', bankTxnId)
            .single()

          suggestedTransaction = txn as BankTransaction
        }

        // Parse flag reasons from flag_reason field
        const flagReasons: string[] = []
        if (flagged.flag_reason) {
          // flag_reason contains a detailed message, split by common delimiters
          flagReasons.push(flagged.flag_reason)
        }

        attentionItems.push({
          type: 'flagged',
          id: flagged.id,
          priority: 1.5, // High priority - between reimbursements and orphans
          data: {
            expense: flagged,
            suggestedTransaction,
            confidence: flagged.predicted_confidence || 0,
            flagReasons,
          } as FlaggedExpenseData,
        })
      }

      // Sort by priority
      attentionItems.sort((a, b) => a.priority - b.priority)

      setItems(attentionItems)
    } catch (err) {
      console.error('Failed to fetch attention items:', err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchItems()
  }, [fetchItems])

  const filteredItems = filter === 'all'
    ? items
    : items.filter(item => item.type === filter)

  const counts = {
    reimbursement: items.filter(i => i.type === 'reimbursement').length,
    orphan: items.filter(i => i.type === 'orphan').length,
    low_confidence: items.filter(i => i.type === 'low_confidence').length,
    flagged: items.filter(i => i.type === 'flagged').length,
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#C10230]" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-semibold text-gray-900">Needs Your Attention</h2>
          <div className="flex items-center gap-2">
            <FilterButton
              active={filter === 'all'}
              onClick={() => setFilter('all')}
              count={items.length}
              label="All"
            />
            <FilterButton
              active={filter === 'reimbursement'}
              onClick={() => setFilter('reimbursement')}
              count={counts.reimbursement}
              label="Reimbursements"
              icon={DollarSign}
              color="red"
            />
            <FilterButton
              active={filter === 'orphan'}
              onClick={() => setFilter('orphan')}
              count={counts.orphan}
              label="Orphans"
              icon={Building2}
              color="orange"
            />
            <FilterButton
              active={filter === 'low_confidence'}
              onClick={() => setFilter('low_confidence')}
              count={counts.low_confidence}
              label="Low Confidence"
              icon={AlertTriangle}
              color="yellow"
            />
            <FilterButton
              active={filter === 'flagged'}
              onClick={() => setFilter('flagged')}
              count={counts.flagged}
              label="Flagged"
              icon={Flag}
              color="yellow"
            />
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={fetchItems}>
          <RefreshCw className="h-4 w-4 mr-1" />
          Refresh
        </Button>
      </div>

      {/* Empty State */}
      {filteredItems.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed border-green-200 bg-green-50 p-12 text-center">
          <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-green-800">All Clear!</h3>
          <p className="mt-1 text-green-600">
            {items.length === 0
              ? 'No items need your attention right now.'
              : `No ${filter.replace('_', ' ')} items to review.`}
          </p>
        </div>
      ) : (
        /* Items */
        <div className="space-y-4">
          {/* Section: Reimbursements */}
          {filter === 'all' && counts.reimbursement > 0 && (
            <SectionHeader
              icon={DollarSign}
              color="red"
              label="REIMBURSEMENTS"
              count={counts.reimbursement}
              subtitle="Employee waiting - process first"
            />
          )}
          {filteredItems
            .filter(item => filter === 'all' ? item.type === 'reimbursement' : true)
            .filter(item => item.type === 'reimbursement')
            .map(item => (
              <ReimbursementCard
                key={item.id}
                data={item.data as ReimbursementData}
                onAction={fetchItems}
              />
            ))}

          {/* Section: Orphans */}
          {filter === 'all' && counts.orphan > 0 && (
            <SectionHeader
              icon={Building2}
              color="orange"
              label="ORPHAN TRANSACTIONS"
              count={counts.orphan}
              subtitle="Bank transactions with no expense report"
            />
          )}
          {filteredItems
            .filter(item => filter === 'all' ? item.type === 'orphan' : true)
            .filter(item => item.type === 'orphan')
            .map(item => (
              <OrphanCard
                key={item.id}
                data={item.data as OrphanData}
                onAction={fetchItems}
              />
            ))}

          {/* Section: Flagged Expenses */}
          {filter === 'all' && counts.flagged > 0 && (
            <SectionHeader
              icon={Flag}
              color="yellow"
              label="FLAGGED FOR REVIEW"
              count={counts.flagged}
              subtitle="Requires human verification"
            />
          )}
          {filteredItems
            .filter(item => filter === 'all' ? item.type === 'flagged' : true)
            .filter(item => item.type === 'flagged')
            .map(item => (
              <FlaggedExpenseCard
                key={item.id}
                data={item.data as FlaggedExpenseData}
                onAction={fetchItems}
              />
            ))}

          {/* Section: Low Confidence */}
          {filter === 'all' && counts.low_confidence > 0 && (
            <SectionHeader
              icon={AlertTriangle}
              color="yellow"
              label="LOW CONFIDENCE MATCHES"
              count={counts.low_confidence}
              subtitle="Matched but needs validation"
            />
          )}
          {filteredItems
            .filter(item => filter === 'all' ? item.type === 'low_confidence' : true)
            .filter(item => item.type === 'low_confidence')
            .map(item => (
              <LowConfidenceCard
                key={item.id}
                data={item.data as LowConfidenceData}
                onAction={fetchItems}
              />
            ))}
        </div>
      )}
    </div>
  )
}

interface FilterButtonProps {
  active: boolean
  onClick: () => void
  count: number
  label: string
  icon?: React.ElementType
  color?: 'red' | 'orange' | 'yellow'
}

function FilterButton({ active, onClick, count, label, icon: Icon, color }: FilterButtonProps) {
  const colorClasses = {
    red: 'text-red-600',
    orange: 'text-amber-600',
    yellow: 'text-amber-600',
  }

  return (
    <button
      onClick={onClick}
      className={`
        flex items-center gap-1 px-3 py-1 rounded-full text-sm transition-colors
        ${active
          ? 'bg-gray-900 text-white'
          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
        }
      `}
    >
      {Icon && <Icon className={`h-3 w-3 ${active ? '' : color ? colorClasses[color] : ''}`} />}
      <span>{label}</span>
      <span className={`ml-1 ${active ? 'text-gray-300' : 'text-gray-400'}`}>
        {count}
      </span>
    </button>
  )
}

interface SectionHeaderProps {
  icon: React.ElementType
  color: 'red' | 'orange' | 'yellow'
  label: string
  count: number
  subtitle: string
}

function SectionHeader({ icon: Icon, color, label, count, subtitle }: SectionHeaderProps) {
  const colorClasses = {
    red: 'text-red-600 bg-red-50 border-red-200',
    orange: 'text-amber-600 bg-amber-50 border-amber-200',
    yellow: 'text-amber-600 bg-amber-50 border-amber-200',
  }

  return (
    <div className={`flex items-center gap-3 px-3 py-2 rounded-lg border ${colorClasses[color]} mt-6 first:mt-0`}>
      <Icon className="h-5 w-5" />
      <span className="font-semibold">{label}</span>
      <Badge variant="default" className="text-xs">{count}</Badge>
      <span className="text-sm opacity-75">{subtitle}</span>
    </div>
  )
}
