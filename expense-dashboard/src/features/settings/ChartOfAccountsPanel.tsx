import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import type { QBOAccount } from '@/types/database'
import { Button } from '@/components/ui/Button'
import { RefreshCw, Edit2, Save, X, Check } from 'lucide-react'

const ZOHO_CATEGORIES = [
  'Fuel', 'Track Rental', 'Vehicle Rental', 'Vehicle Wash', 'Meals - Course',
  'Meals - Travel', 'Travel - Airfare', 'Travel - Lodging', 'Travel - Ground',
  'Supplies', 'Office Supplies', 'Software', 'Other',
]

interface EditingAccount {
  id: string
  zoho_category_match: string
  is_cogs: boolean
  is_payment_account: boolean
}

export function ChartOfAccountsPanel() {
  const [accounts, setAccounts] = useState<QBOAccount[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSyncing, setIsSyncing] = useState(false)
  const [editingAccount, setEditingAccount] = useState<EditingAccount | null>(null)
  const [filter, setFilter] = useState<'all' | 'expense' | 'cogs'>('all')

  useEffect(() => { fetchAccounts() }, [])

  async function fetchAccounts() {
    setIsLoading(true)
    const { data, error } = await supabase.from('qbo_accounts').select('*').order('name')
    if (!error && data) setAccounts(data as QBOAccount[])
    setIsLoading(false)
  }

  const filteredAccounts = accounts.filter(a => {
    if (filter === 'all') return true
    if (filter === 'expense') return a.account_type === 'Expense' && !a.is_cogs
    if (filter === 'cogs') return a.is_cogs
    return true
  })

  const handleSyncFromQBO = async () => {
    setIsSyncing(true)
    // Placeholder - would trigger n8n workflow
    setTimeout(() => {
      alert('QBO sync requires n8n workflow integration')
      setIsSyncing(false)
    }, 500)
  }

  const handleSaveAccount = async () => {
    if (!editingAccount) return
    await supabase.from('qbo_accounts').update({
      zoho_category_match: editingAccount.zoho_category_match || null,
      is_cogs: editingAccount.is_cogs,
      is_payment_account: editingAccount.is_payment_account
    }).eq('id', editingAccount.id)
    setEditingAccount(null)
    fetchAccounts()
  }

  if (isLoading) {
    return <div className="flex items-center justify-center h-32"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[#119DA4]" /></div>
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {(['all', 'expense', 'cogs'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
                filter === f ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {f === 'all' ? 'All' : f === 'expense' ? 'Expense' : 'COGS'}
            </button>
          ))}
        </div>
        <Button size="sm" variant="outline" onClick={handleSyncFromQBO} disabled={isSyncing}>
          <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {/* Edit Form */}
      {editingAccount && (
        <div className="border rounded-lg p-3 bg-teal-50/50 space-y-3">
          <div className="flex items-center gap-3">
            <select
              value={editingAccount.zoho_category_match}
              onChange={(e) => setEditingAccount({ ...editingAccount, zoho_category_match: e.target.value })}
              className="flex-1 px-2.5 py-1.5 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-[#119DA4]"
            >
              <option value="">No Zoho mapping</option>
              {ZOHO_CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
            </select>
            <label className="flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={editingAccount.is_cogs}
                onChange={(e) => setEditingAccount({ ...editingAccount, is_cogs: e.target.checked })}
                className="rounded"
              />
              COGS
            </label>
            <label className="flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={editingAccount.is_payment_account}
                onChange={(e) => setEditingAccount({ ...editingAccount, is_payment_account: e.target.checked })}
                className="rounded"
              />
              Payment
            </label>
            <Button variant="ghost" size="sm" onClick={() => setEditingAccount(null)}>
              <X className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" onClick={handleSaveAccount}>
              <Save className="h-3.5 w-3.5" />
            </Button>
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
                  <th className="text-left px-3 py-2 font-medium text-gray-600">Zoho Map</th>
                  <th className="text-center px-3 py-2 font-medium text-gray-600">Flags</th>
                  <th className="w-12"></th>
                </tr>
              </thead>
              <tbody>
                {filteredAccounts.map(account => (
                  <tr key={account.id} className="border-b last:border-b-0 hover:bg-gray-50">
                    <td className="px-3 py-2">
                      <div className="font-medium text-gray-900 text-xs">{account.name}</div>
                      <div className="text-xs text-gray-400">{account.account_type}</div>
                    </td>
                    <td className="px-3 py-2">
                      {account.zoho_category_match ? (
                        <span className="text-xs text-teal-600 flex items-center gap-1">
                          <Check className="h-3 w-3" />
                          {account.zoho_category_match}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <div className="flex justify-center gap-1">
                        {account.is_cogs && <span className="text-xs px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded">COGS</span>}
                        {account.is_payment_account && <span className="text-xs px-1.5 py-0.5 bg-teal-100 text-teal-700 rounded">Pay</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => setEditingAccount({
                          id: account.id,
                          zoho_category_match: account.zoho_category_match || '',
                          is_cogs: account.is_cogs || false,
                          is_payment_account: account.is_payment_account || false
                        })}
                        className="p-1 text-gray-400 hover:text-teal-600"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <p className="text-xs text-gray-400">{accounts.length} accounts from QBO</p>
    </div>
  )
}
