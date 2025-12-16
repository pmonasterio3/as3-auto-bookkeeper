import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatRelativeTime } from '@/lib/utils'
import type { VendorRule } from '@/types/database'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { Plus, Edit2, Trash2, RefreshCw, Save, X } from 'lucide-react'

export function VendorRulesPage() {
  const [rules, setRules] = useState<VendorRule[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)

  // Form state
  const [formData, setFormData] = useState({
    vendor_pattern: '',
    default_category: '',
    default_state: '',
    notes: '',
  })

  const fetchRules = async () => {
    setIsLoading(true)
    try {
      const { data, error } = await supabase
        .from('vendor_rules')
        .select('*')
        .order('times_used', { ascending: false, nullsFirst: false })

      if (error) throw error
      setRules((data as VendorRule[]) || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load rules')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchRules()
  }, [])

  const handleAdd = async () => {
    try {
      const isCos = formData.default_category.endsWith('- COS')
      const { error } = await supabase
        .from('vendor_rules')
        .insert({
          vendor_pattern: formData.vendor_pattern.toLowerCase(),
          default_category: formData.default_category,
          default_state: formData.default_state || null,
          is_cogs: isCos,
          notes: formData.notes || null,
        })

      if (error) throw error
      setShowAddForm(false)
      setFormData({ vendor_pattern: '', default_category: '', default_state: '', notes: '' })
      fetchRules()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to add rule')
    }
  }

  const handleUpdate = async (id: string) => {
    try {
      const isCos = formData.default_category.endsWith('- COS')
      const { error } = await supabase
        .from('vendor_rules')
        .update({
          vendor_pattern: formData.vendor_pattern.toLowerCase(),
          default_category: formData.default_category,
          default_state: formData.default_state || null,
          is_cogs: isCos,
          notes: formData.notes || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)

      if (error) throw error
      setEditingId(null)
      fetchRules()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update rule')
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this rule?')) return

    try {
      const { error } = await supabase
        .from('vendor_rules')
        .delete()
        .eq('id', id)

      if (error) throw error
      fetchRules()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete rule')
    }
  }

  const startEdit = (rule: VendorRule) => {
    setEditingId(rule.id)
    setFormData({
      vendor_pattern: rule.vendor_pattern,
      default_category: rule.default_category || '',
      default_state: rule.default_state || '',
      notes: rule.notes || '',
    })
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
          <h1 className="text-2xl font-bold text-gray-900">Vendor Rules</h1>
          <p className="mt-1 text-gray-500">
            {rules.length} rule{rules.length !== 1 ? 's' : ''} configured
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchRules}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button onClick={() => setShowAddForm(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Rule
          </Button>
        </div>
      </div>

      {/* Add form */}
      {showAddForm && (
        <Card className="border-teal-200 bg-teal-50">
          <CardHeader>
            <CardTitle>Add New Rule</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Vendor Pattern"
                value={formData.vendor_pattern}
                onChange={(e) => setFormData({ ...formData, vendor_pattern: e.target.value })}
                placeholder="e.g., CHEVRON, SHELL, WALMART"
              />
              <Input
                label="Category"
                value={formData.default_category}
                onChange={(e) => setFormData({ ...formData, default_category: e.target.value })}
                placeholder="e.g., Fuel - COS"
              />
              <Input
                label="State"
                value={formData.default_state}
                onChange={(e) => setFormData({ ...formData, default_state: e.target.value })}
                placeholder="e.g., CA, TX, or leave empty"
              />
              <Input
                label="Notes"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Optional notes"
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleAdd}>
                <Save className="h-4 w-4 mr-2" />
                Save Rule
              </Button>
              <Button variant="ghost" onClick={() => setShowAddForm(false)}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Rules list */}
      <Card>
        <CardContent className="p-0">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Pattern
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Category
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  State
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Usage
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Last Used
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {rules.map((rule) => (
                <tr key={rule.id}>
                  {editingId === rule.id ? (
                    <>
                      <td className="px-6 py-4">
                        <Input
                          value={formData.vendor_pattern}
                          onChange={(e) => setFormData({ ...formData, vendor_pattern: e.target.value })}
                          className="py-1"
                        />
                      </td>
                      <td className="px-6 py-4">
                        <Input
                          value={formData.default_category}
                          onChange={(e) => setFormData({ ...formData, default_category: e.target.value })}
                          className="py-1"
                        />
                      </td>
                      <td className="px-6 py-4">
                        <Input
                          value={formData.default_state}
                          onChange={(e) => setFormData({ ...formData, default_state: e.target.value })}
                          className="py-1"
                        />
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {rule.times_used || 0}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {rule.last_matched_at ? formatRelativeTime(rule.last_matched_at) : 'Never'}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-2">
                          <Button size="sm" onClick={() => handleUpdate(rule.id)}>
                            <Save className="h-4 w-4" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-6 py-4">
                        <code className="text-sm bg-gray-100 px-2 py-1 rounded">
                          {rule.vendor_pattern}
                        </code>
                      </td>
                      <td className="px-6 py-4 text-sm">
                        {rule.default_category || '-'}
                        {rule.is_cogs && (
                          <Badge variant="info" className="ml-2">COS</Badge>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {rule.default_state ? (
                          <Badge variant="default">{rule.default_state}</Badge>
                        ) : (
                          <span className="text-gray-400">Any</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {rule.times_used || 0} times
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {rule.last_matched_at ? formatRelativeTime(rule.last_matched_at) : 'Never'}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => startEdit(rule)}
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            onClick={() => handleDelete(rule.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
              {rules.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                    No vendor rules configured yet. Add your first rule above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}
