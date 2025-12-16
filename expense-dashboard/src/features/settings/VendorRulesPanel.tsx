import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import type { VendorRule } from '@/types/database'
import { Button } from '@/components/ui/Button'
import { Plus, Edit2, Trash2, Search, Save, X } from 'lucide-react'

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

interface EditingRule {
  id?: string
  vendor_pattern: string
  vendor_name_clean: string
  default_category: string
  default_state: string
  is_cogs?: boolean
}

export function VendorRulesPanel() {
  const [rules, setRules] = useState<VendorRule[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [editingRule, setEditingRule] = useState<EditingRule | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    fetchRules()
  }, [])

  async function fetchRules() {
    setIsLoading(true)
    const { data, error } = await supabase.from('vendor_rules').select('*').order('vendor_pattern')
    if (!error && data) setRules(data as VendorRule[])
    setIsLoading(false)
  }

  const filteredRules = rules.filter(rule =>
    rule.vendor_pattern.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (rule.vendor_name_clean || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (rule.default_category || '').toLowerCase().includes(searchTerm.toLowerCase())
  )

  const handleSaveRule = async () => {
    if (!editingRule || !editingRule.vendor_pattern || !editingRule.default_category || !editingRule.default_state) return

    setIsSaving(true)
    try {
      const isCos = editingRule.default_category.endsWith('- COS')
      if (editingRule.id) {
        await supabase.from('vendor_rules').update({
          vendor_pattern: editingRule.vendor_pattern.toLowerCase(),
          vendor_name_clean: editingRule.vendor_name_clean || null,
          default_category: editingRule.default_category,
          default_state: editingRule.default_state,
          is_cogs: isCos,
          updated_at: new Date().toISOString()
        }).eq('id', editingRule.id)
      } else {
        await supabase.from('vendor_rules').insert({
          vendor_pattern: editingRule.vendor_pattern.toLowerCase(),
          vendor_name_clean: editingRule.vendor_name_clean || null,
          default_category: editingRule.default_category,
          default_state: editingRule.default_state,
          is_cogs: isCos
        })
      }
      setEditingRule(null)
      fetchRules()
    } catch (err) {
      console.error(err)
    } finally {
      setIsSaving(false)
    }
  }

  const handleDeleteRule = async (id: string) => {
    if (!confirm('Delete this rule?')) return
    await supabase.from('vendor_rules').delete().eq('id', id)
    fetchRules()
  }

  if (isLoading) {
    return <div className="flex items-center justify-center h-32"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[#119DA4]" /></div>
  }

  return (
    <div className="space-y-4">
      {/* Search + Add */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search patterns..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#119DA4]"
          />
        </div>
        <Button size="sm" onClick={() => setEditingRule({ vendor_pattern: '', vendor_name_clean: '', default_category: '', default_state: '' })}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {/* Edit Form */}
      {editingRule && (
        <div className="border rounded-lg p-3 bg-teal-50/50 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              value={editingRule.vendor_pattern}
              onChange={(e) => setEditingRule({ ...editingRule, vendor_pattern: e.target.value })}
              placeholder="Pattern (e.g., shell, chevron)"
              className="px-2.5 py-1.5 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-[#119DA4]"
            />
            <input
              type="text"
              value={editingRule.vendor_name_clean}
              onChange={(e) => setEditingRule({ ...editingRule, vendor_name_clean: e.target.value })}
              placeholder="Clean name (optional)"
              className="px-2.5 py-1.5 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-[#119DA4]"
            />
            <select
              value={editingRule.default_category}
              onChange={(e) => setEditingRule({ ...editingRule, default_category: e.target.value })}
              className="px-2.5 py-1.5 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-[#119DA4]"
            >
              <option value="">Category...</option>
              {CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
            </select>
            <select
              value={editingRule.default_state}
              onChange={(e) => setEditingRule({ ...editingRule, default_state: e.target.value })}
              className="px-2.5 py-1.5 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-[#119DA4]"
            >
              <option value="">State...</option>
              {STATES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditingRule(null)}>
              <X className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" onClick={handleSaveRule} disabled={isSaving || !editingRule.vendor_pattern || !editingRule.default_category || !editingRule.default_state}>
              <Save className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* Rules List */}
      <div className="border rounded-lg overflow-hidden">
        <div className="max-h-80 overflow-auto">
          {filteredRules.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-500">
              {searchTerm ? 'No matches' : 'No rules yet'}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr className="border-b">
                  <th className="text-left px-3 py-2 font-medium text-gray-600">Pattern</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-600">Category</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-600">State</th>
                  <th className="w-16"></th>
                </tr>
              </thead>
              <tbody>
                {filteredRules.map(rule => (
                  <tr key={rule.id} className="border-b last:border-b-0 hover:bg-gray-50">
                    <td className="px-3 py-2">
                      <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{rule.vendor_pattern}</code>
                    </td>
                    <td className="px-3 py-2 text-gray-600 text-xs">{rule.default_category || '-'}</td>
                    <td className="px-3 py-2">
                      <span className="text-xs px-1.5 py-0.5 bg-teal-100 text-teal-700 rounded">{rule.default_state || '-'}</span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        <button onClick={() => setEditingRule({
                          id: rule.id,
                          vendor_pattern: rule.vendor_pattern,
                          vendor_name_clean: rule.vendor_name_clean || '',
                          default_category: rule.default_category || '',
                          default_state: rule.default_state || '',
                          is_cogs: rule.is_cogs || false
                        })} className="p-1 text-gray-400 hover:text-teal-600">
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => handleDeleteRule(rule.id)} className="p-1 text-gray-400 hover:text-red-600">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <p className="text-xs text-gray-400">
        {rules.length} rule{rules.length !== 1 ? 's' : ''} total
      </p>
    </div>
  )
}
