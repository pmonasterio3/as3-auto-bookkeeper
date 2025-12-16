import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Check, X } from 'lucide-react'
import type { ReviewItem, CorrectionData } from '../types'
import { CATEGORIES, STATES } from '../constants'

interface CorrectionFormProps {
  item: ReviewItem
  onSubmit: (data: CorrectionData) => void
  onCancel: () => void
  isProcessing?: boolean
}

export function CorrectionForm({ item, onSubmit, onCancel, isProcessing = false }: CorrectionFormProps) {
  const [category, setCategory] = useState(item.predictions?.category || '')
  const [state, setState] = useState(item.predictions?.state || '')
  const [createVendorRule, setCreateVendorRule] = useState(false)

  const handleSubmit = () => {
    onSubmit({
      category,
      state,
      createVendorRule,
    })
  }

  return (
    <div className="border-t border-gray-200 pt-4 mt-4 space-y-4">
      <div className="text-sm font-medium text-gray-700">Correct & Approve</div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Category Dropdown */}
        <div>
          <label className="block text-sm text-gray-600 mb-1">Category</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-[#119DA4] focus:outline-none focus:ring-1 focus:ring-[#119DA4]"
            disabled={isProcessing}
          >
            <option value="">Select category...</option>
            {CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>

        {/* State Dropdown */}
        <div>
          <label className="block text-sm text-gray-600 mb-1">State</label>
          <select
            value={state}
            onChange={(e) => setState(e.target.value)}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-[#119DA4] focus:outline-none focus:ring-1 focus:ring-[#119DA4]"
            disabled={isProcessing}
          >
            <option value="">Select state...</option>
            {STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Create Vendor Rule (for orphans) */}
      {item.itemType === 'orphan' && item.vendor && (
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
          <input
            type="checkbox"
            checked={createVendorRule}
            onChange={(e) => setCreateVendorRule(e.target.checked)}
            className="rounded border-gray-300 text-[#119DA4] focus:ring-[#119DA4]"
            disabled={isProcessing}
          />
          <span>Create vendor rule for "{item.vendor}" (auto-categorize future transactions)</span>
        </label>
      )}

      {/* Info Note */}
      <div className="text-xs text-gray-500 italic">
        This correction will be logged to improve future predictions.
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          onClick={handleSubmit}
          disabled={!category || !state || isProcessing}
        >
          <Check className="h-4 w-4 mr-1" />
          Save & Approve
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={isProcessing}>
          <X className="h-4 w-4 mr-1" />
          Cancel
        </Button>
      </div>
    </div>
  )
}
