import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthProvider'
import type { UserProfile, UserInvitation, UserRole } from '@/types/database'
import { ROLE_INFO } from '@/types/auth'
import { Button } from '@/components/ui/Button'
import {
  Plus, Edit2, Search, Save, X, Mail,
  UserCheck, UserX, Clock, AlertCircle
} from 'lucide-react'
import { formatRelativeTime } from '@/lib/utils'

const ROLES: { value: UserRole; label: string; description: string }[] = [
  { value: 'admin', label: 'Admin', description: 'Full access, can manage users' },
  { value: 'bookkeeper', label: 'Bookkeeper', description: 'Full access except user management' },
  { value: 'submitter', label: 'Submitter', description: 'View/fix only their expenses' },
]

interface EditingUser {
  id: string
  email: string
  full_name: string
  role: UserRole
  linked_zoho_emails: string[]
  is_active: boolean
}

interface InviteForm {
  email: string
  full_name: string
  role: UserRole
}

export function UserManagementPanel() {
  const { profile: currentUser, user } = useAuth()
  const [users, setUsers] = useState<UserProfile[]>([])
  const [invitations, setInvitations] = useState<UserInvitation[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [editingUser, setEditingUser] = useState<EditingUser | null>(null)
  const [inviteForm, setInviteForm] = useState<InviteForm | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [newZohoEmail, setNewZohoEmail] = useState('')

  useEffect(() => {
    fetchData()
  }, [])

  // Clear messages after 5 seconds
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(null), 5000)
      return () => clearTimeout(timer)
    }
  }, [successMessage])

  async function fetchData() {
    setIsLoading(true)
    setError(null)

    const [usersRes, invitesRes] = await Promise.all([
      supabase
        .from('user_profiles')
        .select('*')
        .order('created_at', { ascending: false }),
      supabase
        .from('user_invitations')
        .select('*')
        .eq('status', 'pending')
        .order('invited_at', { ascending: false }),
    ])

    if (usersRes.error) {
      setError(usersRes.error.message)
    } else {
      setUsers(usersRes.data as UserProfile[])
    }

    if (!invitesRes.error) {
      setInvitations(invitesRes.data as UserInvitation[])
    }

    setIsLoading(false)
  }

  const filteredUsers = users.filter(u =>
    u.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.full_name.toLowerCase().includes(searchTerm.toLowerCase())
  )

  // Handle user invite via Edge Function
  const handleInvite = async () => {
    if (!inviteForm || !inviteForm.email || !inviteForm.full_name) return
    if (!user?.id) return

    setIsSaving(true)
    setError(null)

    try {
      const session = await supabase.auth.getSession()
      const accessToken = session.data.session?.access_token

      if (!accessToken) {
        throw new Error('No access token available')
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite-user`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            email: inviteForm.email,
            full_name: inviteForm.full_name,
            role: inviteForm.role,
            invited_by: user.id,
          }),
        }
      )

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Failed to send invitation')
      }

      setSuccessMessage(`Invitation sent to ${inviteForm.email}`)
      setInviteForm(null)
      fetchData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invitation failed')
    } finally {
      setIsSaving(false)
    }
  }

  // Handle user update
  const handleSaveUser = async () => {
    if (!editingUser?.id) return

    setIsSaving(true)
    setError(null)

    try {
      const { error: updateError } = await supabase
        .from('user_profiles')
        .update({
          full_name: editingUser.full_name,
          role: editingUser.role,
          linked_zoho_emails: editingUser.linked_zoho_emails,
          is_active: editingUser.is_active,
          updated_at: new Date().toISOString(),
        })
        .eq('id', editingUser.id)

      if (updateError) throw updateError

      setSuccessMessage('User updated successfully')
      setEditingUser(null)
      fetchData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setIsSaving(false)
    }
  }

  // Add Zoho email to linked list
  const handleAddZohoEmail = () => {
    if (!newZohoEmail || !editingUser) return
    if (editingUser.linked_zoho_emails.includes(newZohoEmail)) {
      setError('Email already linked')
      return
    }

    setEditingUser({
      ...editingUser,
      linked_zoho_emails: [...editingUser.linked_zoho_emails, newZohoEmail],
    })
    setNewZohoEmail('')
  }

  // Remove Zoho email from linked list
  const handleRemoveZohoEmail = (email: string) => {
    if (!editingUser) return
    setEditingUser({
      ...editingUser,
      linked_zoho_emails: editingUser.linked_zoho_emails.filter(e => e !== email),
    })
  }

  // Revoke pending invitation
  const handleRevokeInvitation = async (inviteId: string) => {
    if (!confirm('Revoke this invitation?')) return

    const { error: revokeError } = await supabase
      .from('user_invitations')
      .update({ status: 'revoked' })
      .eq('id', inviteId)

    if (revokeError) {
      setError(revokeError.message)
    } else {
      setSuccessMessage('Invitation revoked')
      fetchData()
    }
  }

  // Role badge styling
  const getRoleBadge = (role: UserRole) => {
    const info = ROLE_INFO[role]
    const colorClasses = {
      purple: 'bg-purple-100 text-purple-700',
      blue: 'bg-blue-100 text-blue-700',
      gray: 'bg-gray-100 text-gray-700',
    }
    return (
      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colorClasses[info.color as keyof typeof colorClasses]}`}>
        {info.label}
      </span>
    )
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[#119DA4]" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Error Display */}
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Success Message */}
      {successMessage && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700 flex items-center gap-2">
          <UserCheck className="h-4 w-4 flex-shrink-0" />
          {successMessage}
        </div>
      )}

      {/* Search + Invite Button */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search users..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 border rounded-md text-sm
                       focus:outline-none focus:ring-2 focus:ring-[#119DA4]"
          />
        </div>
        <Button
          size="sm"
          onClick={() => setInviteForm({ email: '', full_name: '', role: 'submitter' })}
          disabled={!!inviteForm || !!editingUser}
        >
          <Plus className="h-4 w-4 mr-1" /> Invite User
        </Button>
      </div>

      {/* Invite Form */}
      {inviteForm && (
        <div className="border rounded-lg p-4 bg-teal-50/50 space-y-3">
          <div className="text-sm font-medium text-gray-900">Invite New User</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input
              type="email"
              value={inviteForm.email}
              onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
              placeholder="Email address"
              className="px-3 py-2 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-[#119DA4]"
            />
            <input
              type="text"
              value={inviteForm.full_name}
              onChange={(e) => setInviteForm({ ...inviteForm, full_name: e.target.value })}
              placeholder="Full name"
              className="px-3 py-2 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-[#119DA4]"
            />
            <select
              value={inviteForm.role}
              onChange={(e) => setInviteForm({
                ...inviteForm,
                role: e.target.value as UserRole
              })}
              className="px-3 py-2 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-[#119DA4]"
            >
              {ROLES.map(r => (
                <option key={r.value} value={r.value}>{r.label} - {r.description}</option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setInviteForm(null)}>
              <X className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              onClick={handleInvite}
              disabled={isSaving || !inviteForm.email || !inviteForm.full_name}
            >
              {isSaving ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
              ) : (
                <Mail className="h-4 w-4 mr-1" />
              )}
              Send Invitation
            </Button>
          </div>
        </div>
      )}

      {/* Pending Invitations */}
      {invitations.length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <div className="bg-amber-50 px-4 py-2 border-b border-amber-200">
            <div className="flex items-center gap-2 text-sm font-medium text-amber-800">
              <Clock className="h-4 w-4" />
              Pending Invitations ({invitations.length})
            </div>
          </div>
          <div className="divide-y">
            {invitations.map(invite => (
              <div key={invite.id} className="px-4 py-2 flex items-center justify-between bg-white">
                <div>
                  <div className="text-sm font-medium text-gray-900">{invite.full_name}</div>
                  <div className="text-xs text-gray-500">{invite.email}</div>
                </div>
                <div className="flex items-center gap-3">
                  {getRoleBadge(invite.role)}
                  <span className="text-xs text-gray-400">
                    {formatRelativeTime(invite.invited_at)}
                  </span>
                  <button
                    onClick={() => handleRevokeInvitation(invite.id)}
                    className="p-1 text-gray-400 hover:text-red-600"
                    title="Revoke invitation"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Edit User Form */}
      {editingUser && (
        <div className="border rounded-lg p-4 bg-teal-50/50 space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium text-gray-900">Edit User</div>
            <span className="text-xs text-gray-500">{editingUser.email}</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">
                Full Name
              </label>
              <input
                type="text"
                value={editingUser.full_name}
                onChange={(e) => setEditingUser({
                  ...editingUser,
                  full_name: e.target.value
                })}
                className="w-full px-3 py-2 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-[#119DA4]"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">
                Role
              </label>
              <select
                value={editingUser.role}
                onChange={(e) => setEditingUser({
                  ...editingUser,
                  role: e.target.value as UserRole
                })}
                className="w-full px-3 py-2 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-[#119DA4]"
                disabled={editingUser.id === currentUser?.id}
              >
                {ROLES.map(r => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
              {editingUser.id === currentUser?.id && (
                <p className="text-xs text-gray-400 mt-1">Cannot change your own role</p>
              )}
            </div>
          </div>

          {/* Linked Zoho Emails */}
          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1">
              Linked Zoho Emails
            </label>
            <p className="text-xs text-gray-400 mb-2">
              Expenses submitted from these emails will appear in this user's review queue
            </p>
            <div className="space-y-2">
              {editingUser.linked_zoho_emails.map((email, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="flex-1 px-3 py-1.5 bg-white border rounded text-sm">
                    {email}
                  </span>
                  <button
                    onClick={() => handleRemoveZohoEmail(email)}
                    className="p-1 text-gray-400 hover:text-red-600"
                    title="Remove email"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <div className="flex gap-2">
                <input
                  type="email"
                  value={newZohoEmail}
                  onChange={(e) => setNewZohoEmail(e.target.value)}
                  placeholder="Add Zoho email..."
                  className="flex-1 px-3 py-1.5 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-[#119DA4]"
                  onKeyDown={(e) => e.key === 'Enter' && handleAddZohoEmail()}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleAddZohoEmail}
                  disabled={!newZohoEmail}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          {/* Active Toggle */}
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={editingUser.is_active}
              onChange={(e) => setEditingUser({
                ...editingUser,
                is_active: e.target.checked
              })}
              className="h-4 w-4 rounded border-gray-300 text-[#C10230] focus:ring-[#C10230]"
              disabled={editingUser.id === currentUser?.id}
            />
            <span className="text-sm text-gray-700">Account is active</span>
            {editingUser.id === currentUser?.id && (
              <span className="text-xs text-gray-400">(Cannot deactivate yourself)</span>
            )}
          </label>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditingUser(null)}>
              <X className="h-4 w-4 mr-1" /> Cancel
            </Button>
            <Button size="sm" onClick={handleSaveUser} disabled={isSaving}>
              {isSaving ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
              ) : (
                <Save className="h-4 w-4 mr-1" />
              )}
              Save Changes
            </Button>
          </div>
        </div>
      )}

      {/* Users List */}
      <div className="border rounded-lg overflow-hidden">
        <div className="max-h-96 overflow-auto">
          {filteredUsers.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-500">
              {searchTerm ? 'No users match your search' : 'No users found'}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr className="border-b">
                  <th className="text-left px-4 py-2 font-medium text-gray-600">User</th>
                  <th className="text-left px-4 py-2 font-medium text-gray-600">Role</th>
                  <th className="text-left px-4 py-2 font-medium text-gray-600 hidden md:table-cell">
                    Zoho Emails
                  </th>
                  <th className="text-left px-4 py-2 font-medium text-gray-600">Status</th>
                  <th className="w-16"></th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map(u => (
                  <tr
                    key={u.id}
                    className="border-b last:border-b-0 hover:bg-gray-50"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{u.full_name}</div>
                      <div className="text-xs text-gray-500">{u.email}</div>
                    </td>
                    <td className="px-4 py-3">{getRoleBadge(u.role)}</td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <div className="flex flex-wrap gap-1">
                        {u.linked_zoho_emails.slice(0, 2).map((email, idx) => (
                          <span
                            key={idx}
                            className="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded text-xs"
                          >
                            {email}
                          </span>
                        ))}
                        {u.linked_zoho_emails.length > 2 && (
                          <span className="text-xs text-gray-400">
                            +{u.linked_zoho_emails.length - 2} more
                          </span>
                        )}
                        {u.linked_zoho_emails.length === 0 && (
                          <span className="text-xs text-gray-400 italic">None linked</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {u.is_active ? (
                        <span className="inline-flex items-center gap-1 text-green-600 text-xs">
                          <UserCheck className="h-3.5 w-3.5" /> Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-gray-400 text-xs">
                          <UserX className="h-3.5 w-3.5" /> Inactive
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setEditingUser({
                          id: u.id,
                          email: u.email,
                          full_name: u.full_name,
                          role: u.role,
                          linked_zoho_emails: u.linked_zoho_emails,
                          is_active: u.is_active,
                        })}
                        className="p-1 text-gray-400 hover:text-teal-600"
                        disabled={!!inviteForm || !!editingUser}
                        title="Edit user"
                      >
                        <Edit2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <p className="text-xs text-gray-400">
        {users.length} user{users.length !== 1 ? 's' : ''} total
        {invitations.length > 0 && ` | ${invitations.length} pending invitation${invitations.length !== 1 ? 's' : ''}`}
      </p>
    </div>
  )
}
