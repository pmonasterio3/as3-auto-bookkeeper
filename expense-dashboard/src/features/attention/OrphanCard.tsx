import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { OrphanData } from './types'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import {
  Building2,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  MapPin,
  FolderOpen,
  Calendar,
  Bot,
  User,
  Search,
  Sparkles,
  X
} from 'lucide-react'

interface OrphanCardProps {
  data: OrphanData
  onAction: () => void
}

const CATEGORIES = [
  'Fuel - COS',
  'Track Rental - COS',
  'Vehicle (Rent/Wash) - COS',
  'Course Catering/Meals - COS',
  'Travel - Courses COS',
  'Supplies & Materials - COS',
  'Office Supplies & Software',
  'Travel - General Business',
  'Travel - Employee Meals',
]

const STATES = ['CA', 'TX', 'CO', 'WA', 'NJ', 'FL', 'MT', 'Admin']

export function OrphanCard({ data, onAction }: OrphanCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [category, setCategory] = useState(data.suggestedCategory || '')
  const [state, setState] = useState(data.suggestedState || '')
  const [createRule, setCreateRule] = useState(false)

  const { transaction, daysOld, determinationMethod, nearbyCourse } = data

  const methodBadge = {
    vendor_rule: { color: 'bg-green-100 text-green-700', icon: Sparkles, label: 'Vendor Rule' },
    parsed: { color: 'bg-teal-100 text-teal-700', icon: Search, label: 'Parsed from Description' },
    course_nearby: { color: 'bg-teal-100 text-teal-700', icon: Calendar, label: 'Course Nearby' },
    manual: { color: 'bg-amber-100 text-amber-700', icon: User, label: 'Manual Required' },
  }[determinationMethod]

  const handleApprove = async () => {
    if (!category || !state) {
      alert('Please select both category and state')
      return
    }

    setIsProcessing(true)
    try {
      // Update bank transaction
      const { error } = await supabase
        .from('bank_transactions')
        .update({
          status: 'orphan_processed',
          orphan_category: category,
          orphan_state: state,
          orphan_determination_method: determinationMethod,
          orphan_processed_at: new Date().toISOString(),
        })
        .eq('id', transaction.id)

      if (error) throw error

      // Create vendor rule if requested
      if (createRule && transaction.extracted_vendor) {
        await supabase
          .from('vendor_rules')
          .upsert({
            vendor_pattern: transaction.extracted_vendor.toLowerCase(),
            category,
            state_tag: state,
            default_category: category,
            default_state: state,
          }, {
            onConflict: 'vendor_pattern',
          })
      }

      onAction()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to process')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleExclude = async () => {
    if (!confirm('Exclude this transaction? It will not be posted to QBO.')) return

    setIsProcessing(true)
    try {
      const { error } = await supabase
        .from('bank_transactions')
        .update({ status: 'excluded' })
        .eq('id', transaction.id)

      if (error) throw error
      onAction()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to exclude')
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <div className="rounded-lg border-2 border-orange-200 bg-white overflow-hidden">
      {/* Header */}
      <div className="bg-orange-50 px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-orange-600" />
          <span className="font-medium text-orange-700">ORPHAN TRANSACTION</span>
          <Badge variant="default" className="text-xs">
            {transaction.source === 'amex' ? 'AMEX' : 'Wells Fargo'}
          </Badge>
          <span className="text-xs text-gray-500">{daysOld} days old</span>
        </div>
        <span className="text-lg font-bold text-gray-900">
          {formatCurrency(transaction.amount)}
        </span>
      </div>

      {/* Content */}
      <div className="p-4">
        {/* Bank Description - The Source of Truth */}
        <div className="mb-4">
          <div className="text-xs text-gray-500 mb-1">Bank Description</div>
          <div className="font-mono text-sm bg-gray-50 rounded px-3 py-2 border">
            {transaction.description}
          </div>
          <div className="text-xs text-gray-400 mt-1">
            {formatDate(transaction.transaction_date)}
          </div>
        </div>

        {/* AI Analysis */}
        <div className="mb-4 space-y-2">
          <div className="flex items-center gap-2 text-sm">
            <Bot className="h-4 w-4 text-[#119DA4]" />
            <span className="font-medium text-gray-700">AI Analysis</span>
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm">
            {/* State */}
            <div>
              <div className="flex items-center gap-2 text-gray-600">
                <MapPin className="h-4 w-4" />
                <span>State: <strong>{data.suggestedState || '?'}</strong></span>
              </div>
              <div className={`mt-1 inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded ${methodBadge.color}`}>
                <methodBadge.icon className="h-3 w-3" />
                {methodBadge.label}
              </div>
            </div>

            {/* Category */}
            <div>
              <div className="flex items-center gap-2 text-gray-600">
                <FolderOpen className="h-4 w-4" />
                <span>Category: <strong>{data.suggestedCategory || '?'}</strong></span>
              </div>
            </div>
          </div>

          {/* Nearby Course */}
          {nearbyCourse && (
            <div className="text-sm text-teal-600 bg-teal-50 rounded px-2 py-1 flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              <span>
                Nearby course: <strong>{nearbyCourse.name}</strong> ({nearbyCourse.state}) - {nearbyCourse.distance} day{nearbyCourse.distance !== 1 ? 's' : ''} away
              </span>
            </div>
          )}
        </div>

        {/* Quick Actions (collapsed state) */}
        {!isExpanded ? (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="primary"
              onClick={handleApprove}
              disabled={isProcessing || !data.suggestedCategory || !data.suggestedState}
            >
              <CheckCircle className="h-4 w-4 mr-1" />
              Approve & Post
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setIsExpanded(true)}
            >
              Edit
              <ChevronDown className="h-4 w-4 ml-1" />
            </Button>
            <div className="flex-1" />
            <Button
              size="sm"
              variant="ghost"
              onClick={handleExclude}
              disabled={isProcessing}
              className="text-gray-500 hover:text-gray-700"
            >
              <X className="h-4 w-4 mr-1" />
              Exclude
            </Button>
          </div>
        ) : (
          /* Expanded Edit Mode */
          <div className="space-y-4 border-t pt-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Category
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C10230]"
                >
                  <option value="">Select category...</option>
                  {CATEGORIES.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  State
                </label>
                <select
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C10230]"
                >
                  <option value="">Select state...</option>
                  {STATES.map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Create Vendor Rule */}
            {transaction.extracted_vendor && (
              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={createRule}
                  onChange={(e) => setCreateRule(e.target.checked)}
                  className="rounded border-gray-300"
                />
                Create vendor rule for "{transaction.extracted_vendor}"
              </label>
            )}

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="primary"
                onClick={handleApprove}
                disabled={isProcessing || !category || !state}
              >
                <CheckCircle className="h-4 w-4 mr-1" />
                Save & Post
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setIsExpanded(false)}
              >
                <ChevronUp className="h-4 w-4 mr-1" />
                Collapse
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
