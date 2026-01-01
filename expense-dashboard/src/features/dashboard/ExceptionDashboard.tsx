import { useState } from 'react'
import { useAuth } from '@/features/auth/AuthProvider'
import { BankFeedPanel } from './BankFeedPanel'
import { SystemHealthBar } from './SystemHealthBar'
import { AccountConsole } from './AccountConsole'
import { TransactionTable } from './TransactionTable'
import { ReviewQueue, MatchHistoryPage } from '@/features/review'
import { VendorRulesPanel, ChartOfAccountsPanel, BankAccountsPanel, UserManagementPanel } from '@/features/settings'
import { Button } from '@/components/ui/Button'
import { LogOut, LayoutDashboard, Sparkles, BookOpen, CreditCard, ListTodo, Users, History } from 'lucide-react'
import type { NavItemKey } from '@/types/auth'

type PageType = 'dashboard' | 'review' | 'match_history' | 'vendor_rules' | 'chart_of_accounts' | 'bank_accounts' | 'users'

const NAV_ITEMS: { key: PageType; navKey: NavItemKey; label: string; icon: typeof LayoutDashboard }[] = [
  {
    key: 'dashboard',
    navKey: 'dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
  },
  {
    key: 'review',
    navKey: 'review',
    label: 'Needs Attention',
    icon: ListTodo,
  },
  {
    key: 'match_history',
    navKey: 'match_history',
    label: 'Match History',
    icon: History,
  },
  {
    key: 'vendor_rules',
    navKey: 'vendor_rules',
    label: 'Vendor Rules',
    icon: Sparkles,
  },
  {
    key: 'chart_of_accounts',
    navKey: 'chart_of_accounts',
    label: 'Chart of Accounts',
    icon: BookOpen,
  },
  {
    key: 'bank_accounts',
    navKey: 'bank_accounts',
    label: 'Bank Accounts',
    icon: CreditCard,
  },
  {
    key: 'users',
    navKey: 'users',
    label: 'User Management',
    icon: Users,
  },
]

export function ExceptionDashboard() {
  const { signOut, user, canSeeNav } = useAuth()
  const [activePage, setActivePage] = useState<PageType>('dashboard')
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null)

  // Filter nav items based on user role
  const visibleNavItems = NAV_ITEMS.filter(item => canSeeNav(item.navKey))

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Left Sidebar */}
      <aside className="w-56 bg-white border-r border-gray-200 flex flex-col">
        {/* Logo */}
        <div className="px-4 py-4 border-b border-gray-100">
          <img
            src="https://as3.mx/wp-content/uploads/2025/06/AS3-Driver-Training-Logo-No-Disk.png"
            alt="AS3 Driver Training"
            className="h-8 object-contain"
          />
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3 space-y-1">
          {visibleNavItems.map(item => {
            const isActive = activePage === item.key
            return (
              <button
                key={item.key}
                onClick={() => setActivePage(item.key)}
                className={`
                  w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-all text-sm
                  ${isActive
                    ? 'bg-red-50 text-[#C10230] font-medium'
                    : 'text-gray-600 hover:bg-gray-50'
                  }
                `}
              >
                <item.icon className={`h-4 w-4 ${isActive ? 'text-[#C10230]' : 'text-gray-400'}`} />
                {item.label}
              </button>
            )
          })}
        </nav>

        {/* User Section */}
        <div className="p-3 border-t border-gray-100">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500 truncate max-w-[120px]">{user?.email}</span>
            <Button variant="ghost" size="sm" onClick={signOut}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        {activePage === 'dashboard' && (
          <div className="max-w-7xl mx-auto px-6 py-4 space-y-4">
            {/* Compact Header */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Expense Console</h2>
                <p className="text-sm text-gray-500">Import, track, and manage bank transactions</p>
              </div>
              <SystemHealthBar />
            </div>

            {/* Account Cards (QBO-style) */}
            <AccountConsole
              selectedAccount={selectedAccount}
              onSelectAccount={setSelectedAccount}
            />

            {/* Import Panel */}
            <BankFeedPanel />

            {/* Transaction Table with Search/Filter */}
            <TransactionTable accountFilter={selectedAccount} />
          </div>
        )}

        {activePage === 'review' && (
          <div className="max-w-6xl mx-auto px-6 py-4">
            <ReviewQueue />
          </div>
        )}

        {activePage === 'match_history' && (
          <div className="max-w-6xl mx-auto px-6 py-4">
            <MatchHistoryPage />
          </div>
        )}

        {activePage === 'vendor_rules' && (
          <div className="max-w-4xl mx-auto px-6 py-6">
            <div className="mb-6">
              <h2 className="text-xl font-semibold text-gray-900">Vendor Rules</h2>
              <p className="text-sm text-gray-500">Auto-categorization patterns for expense matching</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <VendorRulesPanel />
            </div>
          </div>
        )}

        {activePage === 'chart_of_accounts' && (
          <div className="max-w-4xl mx-auto px-6 py-6">
            <div className="mb-6">
              <h2 className="text-xl font-semibold text-gray-900">Chart of Accounts</h2>
              <p className="text-sm text-gray-500">QBO account mappings and Zoho category matching</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <ChartOfAccountsPanel />
            </div>
          </div>
        )}

        {activePage === 'bank_accounts' && (
          <div className="max-w-4xl mx-auto px-6 py-6">
            <div className="mb-6">
              <h2 className="text-xl font-semibold text-gray-900">Bank Accounts</h2>
              <p className="text-sm text-gray-500">Configure import sources and CSV formats</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <BankAccountsPanel />
            </div>
          </div>
        )}

        {activePage === 'users' && (
          <div className="max-w-4xl mx-auto px-6 py-6">
            <div className="mb-6">
              <h2 className="text-xl font-semibold text-gray-900">User Management</h2>
              <p className="text-sm text-gray-500">Manage users, roles, and permissions</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <UserManagementPanel />
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
