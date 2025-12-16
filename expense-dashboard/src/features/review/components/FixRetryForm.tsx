/**
 * FixRetryForm - Form for correcting and retrying failed/flagged items
 *
 * Features:
 * - Pre-filled dropdowns for QBO accounts (fetched from database)
 * - State selection with QBO class mapping
 * - Vendor name correction
 * - Notes field
 * - Option to create vendor rule
 */

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/Button'
import { supabase } from '@/lib/supabase'
import { Loader2, Save } from 'lucide-react'
import type { ReviewItem, CorrectionData } from '../types'
import type { QboAccount, QboClass } from '@/types/database'

interface FixRetryFormProps {
  item: ReviewItem
  onSubmit: (data: CorrectionData) => Promise<void>
  onCancel: () => void
  isLoading?: boolean
}

export function FixRetryForm({ item, onSubmit, onCancel, isLoading }: FixRetryFormProps) {
  const [qboAccounts, setQboAccounts] = useState<QboAccount[]>([])
  const [qboClasses, setQboClasses] = useState<QboClass[]>([])
  const [loadingData, setLoadingData] = useState(true)

  // Form state - pre-filled from item data
  const [category, setCategory] = useState(item.predictions?.category || item.zoho?.categoryName || '')
  const [state, setState] = useState(item.predictions?.state || '')
  const [vendorName, setVendorName] = useState(item.vendor || '')
  const [notes, setNotes] = useState('')
  const [createVendorRule, setCreateVendorRule] = useState(false)

  // Fetch QBO accounts and classes on mount
  useEffect(() => {
    async function fetchReferenceData() {
      setLoadingData(true)
      try {
        const [accountsRes, classesRes] = await Promise.all([
          supabase
            .from('qbo_accounts')
            .select('*')
            .order('name'),
          supabase
            .from('qbo_classes')
            .select('*')
            .order('state_code')
        ])

        if (accountsRes.data) setQboAccounts(accountsRes.data as QboAccount[])
        if (classesRes.data) setQboClasses(classesRes.data as QboClass[])
      } catch (err) {
        console.error('Failed to fetch reference data:', err)
      } finally {
        setLoadingData(false)
      }
    }
    fetchReferenceData()
  }, [])

  // Group accounts by type for better UX
  const expenseAccounts = qboAccounts.filter(a => a.account_type === 'Expenses' || a.account_type === 'Cost of Goods Sold')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await onSubmit({
      category,
      state,
      notes,
      createVendorRule,
    })
  }

  if (loadingData) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
        <span className="ml-2 text-sm text-gray-500">Loading form data...</span>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Vendor Name */}
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">
          Vendor Name
        </label>
        <input
          type="text"
          value={vendorName}
          onChange={(e) => setVendorName(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#C10230] focus:border-transparent"
          placeholder="Vendor name..."
        />
      </div>

      {/* QBO Expense Account */}
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">
          QBO Expense Account
        </label>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#C10230] focus:border-transparent bg-white"
        >
          <option value="">Select account...</option>
          <optgroup label="Cost of Sales (COS)">
            {expenseAccounts.filter(a => a.is_cogs).map(account => (
              <option key={account.id} value={account.name}>
                {account.name}
              </option>
            ))}
          </optgroup>
          <optgroup label="Operating Expenses">
            {expenseAccounts.filter(a => !a.is_cogs).map(account => (
              <option key={account.id} value={account.name}>
                {account.name}
              </option>
            ))}
          </optgroup>
        </select>
        {item.zoho?.categoryName && item.zoho.categoryName !== category && (
          <p className="mt-1 text-xs text-amber-600">
            Original Zoho category: {item.zoho.categoryName}
          </p>
        )}
      </div>

      {/* State (QBO Class) */}
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">
          State (QBO Class)
        </label>
        <select
          value={state}
          onChange={(e) => setState(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#C10230] focus:border-transparent bg-white"
        >
          <option value="">Select state...</option>
          {qboClasses.map(cls => (
            <option key={cls.id} value={cls.state_code}>
              {cls.state_code} - {cls.class_name}
            </option>
          ))}
        </select>
        {item.predictions?.state && item.predictions.state !== state && (
          <p className="mt-1 text-xs text-amber-600">
            AI predicted: {item.predictions.state}
          </p>
        )}
      </div>

      {/* Notes */}
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">
          Notes (optional)
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#C10230] focus:border-transparent resize-none"
          placeholder="Add any notes..."
        />
      </div>

      {/* Create Vendor Rule checkbox */}
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          id="createVendorRule"
          checked={createVendorRule}
          onChange={(e) => setCreateVendorRule(e.target.checked)}
          className="mt-1 h-4 w-4 rounded border-gray-300 text-[#C10230] focus:ring-[#C10230]"
        />
        <label htmlFor="createVendorRule" className="text-sm text-gray-700">
          <span className="font-medium">Create vendor rule</span>
          <span className="block text-xs text-gray-500">
            Automatically apply this category and state to future "{vendorName}" transactions
          </span>
        </label>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-2 pt-2">
        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={isLoading || !category}
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin mr-1" />
          ) : (
            <Save className="h-4 w-4 mr-1" />
          )}
          Save & Retry
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCancel}
          disabled={isLoading}
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}
