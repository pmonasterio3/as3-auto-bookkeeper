/**
 * Authentication and Permission types for the AS3 Auto Bookkeeper
 * Defines roles, permissions, and role-permission mappings
 */

import type { UserProfile, UserRole } from './database'

/**
 * Permission types that can be checked throughout the application
 */
export type Permission =
  | 'manage_users'       // Create, edit, deactivate users
  | 'invite_users'       // Send invitations
  | 'resubmit_expenses'  // Resubmit flagged expenses for processing
  | 'delete_expenses'    // Delete expenses from queue
  | 'view_all_expenses'  // View all expenses regardless of owner
  | 'manage_settings'    // Modify vendor rules, chart of accounts, bank accounts
  | 'import_transactions'// Import bank transactions via CSV
  | 'view_own_expenses'  // View only expenses linked to own Zoho emails
  | 'make_corrections'   // Edit state, category, vendor on flagged expenses
  | 'add_notes'          // Add notes/comments to expenses
  | 'upload_receipts'    // Upload replacement receipts
  | 'view_dashboard'     // View dashboard statistics

/**
 * Role-based permission mapping
 * Defines what each role can do in the system
 */
export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  admin: [
    'manage_users',
    'invite_users',
    'resubmit_expenses',
    'delete_expenses',
    'view_all_expenses',
    'manage_settings',
    'import_transactions',
    'view_own_expenses',
    'make_corrections',
    'add_notes',
    'upload_receipts',
    'view_dashboard',
  ],
  bookkeeper: [
    'resubmit_expenses',
    'delete_expenses',
    'view_all_expenses',
    'manage_settings',
    'import_transactions',
    'view_own_expenses',
    'make_corrections',
    'add_notes',
    'upload_receipts',
    'view_dashboard',
  ],
  submitter: [
    'view_own_expenses',
    'make_corrections',
    'add_notes',
    'upload_receipts',
    'view_dashboard',
  ],
}

/**
 * Role display information
 */
export const ROLE_INFO: Record<UserRole, { label: string; description: string; color: string }> = {
  admin: {
    label: 'Admin',
    description: 'Full access including user management',
    color: 'purple',
  },
  bookkeeper: {
    label: 'Bookkeeper',
    description: 'Full access to expenses and settings',
    color: 'blue',
  },
  submitter: {
    label: 'Submitter',
    description: 'View and correct own flagged expenses',
    color: 'gray',
  },
}

/**
 * Extended user profile with computed permissions
 */
export interface UserProfileWithPermissions extends UserProfile {
  permissions: Permission[]
}

/**
 * Helper function to get permissions for a role
 */
export function getPermissionsForRole(role: UserRole): Permission[] {
  return ROLE_PERMISSIONS[role] || []
}

/**
 * Helper function to check if a role has a permission
 */
export function roleHasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false
}

/**
 * Navigation items that can be filtered by role
 */
export type NavItemKey =
  | 'dashboard'
  | 'review'
  | 'match_history'  // View and edit recently posted matches
  | 'vendor_rules'
  | 'chart_of_accounts'
  | 'bank_accounts'
  | 'users'

/**
 * Navigation visibility by role
 */
export const NAV_VISIBILITY: Record<NavItemKey, UserRole[]> = {
  dashboard: ['admin', 'bookkeeper', 'submitter'],
  review: ['admin', 'bookkeeper', 'submitter'],
  match_history: ['admin', 'bookkeeper'],  // Only admin/bookkeeper can review posted matches
  vendor_rules: ['admin', 'bookkeeper'],
  chart_of_accounts: ['admin', 'bookkeeper'],
  bank_accounts: ['admin', 'bookkeeper'],
  users: ['admin'],
}

/**
 * Check if a role can see a navigation item
 */
export function canSeeNavItem(role: UserRole, navItem: NavItemKey): boolean {
  return NAV_VISIBILITY[navItem]?.includes(role) ?? false
}
