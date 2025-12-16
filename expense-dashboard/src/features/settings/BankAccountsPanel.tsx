import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import type { BankAccount } from '@/types/database'
import { Button } from '@/components/ui/Button'
import { Plus, Edit2, Trash2, Save, X, Check } from 'lucide-react'

const ACCOUNT_TYPES = ['credit_card', 'checking', 'savings']

interface EditingAccount {
  id?: string
  account_key: string
  display_name: string
  bank_name: string
  account_type: string
  last_four: string
  is_active: boolean
}

export function BankAccountsPanel() {
  const [accounts, setAccounts] = useState<BankAccount[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [editingAccount, setEditingAccount] = useState<EditingAccount | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [filter, setFilter] = useState<'all' | 'active' | 'inactive'>('all')

  useEffect(() => { fetchAccounts() }, [])

  async function fetchAccounts() {
    setIsLoading(true)
    const { data, error } = await supabase.from('bank_accounts').select('*').order('display_name')
    if (!error && data) setAccounts(data as BankAccount[])
    setIsLoading(false)
  }

  const filteredAccounts = accounts.filter(a => {
    if (filter === 'all') return true
    if (filter === 'active') return a.is_active
    if (filter === 'inactive') return !a.is_active
    return true
  })

  const handleSaveAccount = async () => {
    if (!editingAccount || !editingAccount.account_key || !editingAccount.display_name) return

    const cleanKey = editingAccount.account_key.toLowerCase().replace(/\s+/g, '_')
    setIsSaving(true)
    try {
      if (editingAccount.id) {
        await supabase.from('bank_accounts').update({
          account_key: cleanKey,
          display_name: editingAccount.display_name,
          bank_name: editingAccount.bank_name || '',
          account_type: editingAccount.account_type,
          last_four: editingAccount.last_four || null,
          is_active: editingAccount.is_active,
          updated_at: new Date().toISOString()
        }).eq('id', editingAccount.id)
      } else {
        await supabase.from('bank_accounts').insert({
          account_key: cleanKey,
          display_name: editingAccount.display_name,
          bank_name: editingAccount.bank_name || '',
          account_type: editingAccount.account_type,
          last_four: editingAccount.last_four || null,
          csv_format: 'auto', // Parser auto-detects format from CSV headers
          is_active: editingAccount.is_active
        })
      }
      setEditingAccount(null)
      fetchAccounts()
    } catch (err) {
      console.error(err)
    } finally {
      setIsSaving(false)
    }
  }

  const handleDeleteAccount = async (id: string) => {
    if (!confirm('Delete this account?')) return
    await supabase.from('bank_accounts').delete().eq('id', id)
    fetchAccounts()
  }

  if (isLoading) {
    return <div className="flex items-center justify-center h-32"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[#C10230]" /></div>
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {(['all', 'active', 'inactive'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
                filter === f ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {f === 'all' ? 'All' : f === 'active' ? 'Active' : 'Inactive'}
            </button>
          ))}
        </div>
        <Button size="sm" onClick={() => setEditingAccount({
          account_key: '', display_name: '', bank_name: '', account_type: 'credit_card',
          last_four: '', is_active: true
        })}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {/* Edit Form */}
      {editingAccount && (
        <div className="border rounded-lg p-3 bg-red-50/50 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              value={editingAccount.account_key}
              onChange={(e) => setEditingAccount({ ...editingAccount, account_key: e.target.value })}
              placeholder="Account key (e.g., amex_biz)"
              className="px-2.5 py-1.5 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-[#C10230]"
            />
            <input
              type="text"
              value={editingAccount.display_name}
              onChange={(e) => setEditingAccount({ ...editingAccount, display_name: e.target.value })}
              placeholder="Display name"
              className="px-2.5 py-1.5 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-[#C10230]"
            />
            <input
              type="text"
              value={editingAccount.bank_name}
              onChange={(e) => setEditingAccount({ ...editingAccount, bank_name: e.target.value })}
              placeholder="Bank name (optional)"
              className="px-2.5 py-1.5 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-[#C10230]"
            />
            <input
              type="text"
              value={editingAccount.last_four}
              onChange={(e) => setEditingAccount({ ...editingAccount, last_four: e.target.value.slice(0, 4) })}
              placeholder="Last 4 digits"
              maxLength={4}
              className="px-2.5 py-1.5 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-[#C10230]"
            />
            <select
              value={editingAccount.account_type}
              onChange={(e) => setEditingAccount({ ...editingAccount, account_type: e.target.value })}
              className="px-2.5 py-1.5 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-[#C10230]"
            >
              {ACCOUNT_TYPES.map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
            </select>
          </div>
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={editingAccount.is_active}
                onChange={(e) => setEditingAccount({ ...editingAccount, is_active: e.target.checked })}
                className="rounded"
              />
              Active
            </label>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEditingAccount(null)}>
                <X className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" onClick={handleSaveAccount} disabled={isSaving || !editingAccount.account_key || !editingAccount.display_name}>
                <Save className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Accounts List */}
      <div className="border rounded-lg overflow-hidden">
        <div className="max-h-80 overflow-auto">
          {filteredAccounts.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-500">No accounts</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr className="border-b">
                  <th className="text-left px-3 py-2 font-medium text-gray-600">Account</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-600">Key</th>
                  <th className="text-center px-3 py-2 font-medium text-gray-600">Status</th>
                  <th className="w-16"></th>
                </tr>
              </thead>
              <tbody>
                {filteredAccounts.map(account => (
                  <tr key={account.id} className={`border-b last:border-b-0 hover:bg-gray-50 ${!account.is_active ? 'opacity-50' : ''}`}>
                    <td className="px-3 py-2">
                      <div className="font-medium text-gray-900 text-xs">{account.display_name}</div>
                      <div className="text-xs text-gray-400">
                        {account.bank_name}{account.last_four && ` ****${account.last_four}`}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{account.account_key}</code>
                    </td>
                    <td className="px-3 py-2 text-center">
                      {account.is_active ? (
                        <span className="text-xs px-1.5 py-0.5 bg-green-100 text-green-700 rounded flex items-center gap-1 justify-center">
                          <Check className="h-3 w-3" /> Active
                        </span>
                      ) : (
                        <span className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded">Inactive</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        <button
                          onClick={() => setEditingAccount({
                            id: account.id,
                            account_key: account.account_key,
                            display_name: account.display_name,
                            bank_name: account.bank_name || '',
                            account_type: account.account_type,
                            last_four: account.last_four || '',
                            is_active: account.is_active ?? true
                          })}
                          className="p-1 text-gray-400 hover:text-[#C10230]"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => handleDeleteAccount(account.id)} className="p-1 text-gray-400 hover:text-red-600">
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

      <p className="text-xs text-gray-400">{accounts.length} account{accounts.length !== 1 ? 's' : ''} configured</p>
    </div>
  )
}
