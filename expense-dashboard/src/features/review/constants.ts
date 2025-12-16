/**
 * Constants for the Review System
 */

/**
 * Expense categories available for selection
 * Matches QBO account mappings in qbo_accounts table
 */
export const CATEGORIES = [
  'Fuel - COS',
  'Track Rental - COS',
  'Vehicle (Rent/Wash) - COS',
  'Course Catering/Meals - COS',
  'Travel - Courses COS',
  'Supplies & Materials - COS',
  'Office Supplies & Software',
  'Travel - General Business',
  'Travel - Employee Meals',
] as const

export type Category = (typeof CATEGORIES)[number]

/**
 * State codes for expense allocation
 * Matches QBO classes in qbo_classes table
 */
export const STATES = [
  'CA',  // California
  'TX',  // Texas
  'CO',  // Colorado
  'WA',  // Washington
  'NJ',  // New Jersey
  'FL',  // Florida
  'MT',  // Montana
  'Admin', // NC - Admin/home office
] as const

export type StateCode = (typeof STATES)[number]

/**
 * Priority levels for different item types
 * Lower number = higher priority (process first)
 */
export const ITEM_TYPE_PRIORITIES: Record<string, number> = {
  processing_error: 0.5,  // System failures - fix ASAP
  reimbursement: 1,       // Employee waiting for money
  flagged: 1.5,           // Flagged by AI
  orphan: 2,              // Bank transaction needs categorization
  low_confidence: 3,      // Matched but uncertain
}

/**
 * Color schemes for item types (Tailwind classes)
 */
export const ITEM_TYPE_COLORS: Record<string, {
  border: string
  header: string
  badge: string
  text: string
}> = {
  reimbursement: {
    border: 'border-red-200',
    header: 'bg-red-50',
    badge: 'bg-red-100 text-red-700',
    text: 'text-red-700',
  },
  orphan: {
    border: 'border-orange-200',
    header: 'bg-orange-50',
    badge: 'bg-orange-100 text-orange-700',
    text: 'text-orange-700',
  },
  flagged: {
    border: 'border-amber-200',
    header: 'bg-amber-50',
    badge: 'bg-amber-100 text-amber-700',
    text: 'text-amber-700',
  },
  low_confidence: {
    border: 'border-amber-200',
    header: 'bg-amber-50',
    badge: 'bg-amber-100 text-amber-700',
    text: 'text-amber-700',
  },
  processing_error: {
    border: 'border-purple-200',
    header: 'bg-purple-50',
    badge: 'bg-purple-100 text-purple-700',
    text: 'text-purple-700',
  },
}

/**
 * Human-readable labels for item types
 */
export const ITEM_TYPE_LABELS: Record<string, string> = {
  reimbursement: 'REIMBURSEMENT',
  orphan: 'ORPHAN TRANSACTION',
  flagged: 'FLAGGED FOR REVIEW',
  low_confidence: 'LOW CONFIDENCE',
  processing_error: 'PROCESSING ERROR',
}

/**
 * Icons to use for each item type (lucide-react icon names)
 */
export const ITEM_TYPE_ICONS: Record<string, string> = {
  reimbursement: 'DollarSign',
  orphan: 'Building2',
  flagged: 'Flag',
  low_confidence: 'AlertTriangle',
  processing_error: 'AlertCircle',
}

/**
 * Default actions available for each item type
 */
export const DEFAULT_ACTIONS: Record<string, string[]> = {
  reimbursement: ['reimburse_check', 'reimburse_zelle', 'reimburse_payroll', 'reject'],
  orphan: ['approve', 'correct_and_approve', 'exclude', 'create_vendor_rule'],
  flagged: ['approve', 'correct_and_approve', 'reject'],
  low_confidence: ['approve', 'correct_and_approve', 'reject'],
  processing_error: ['retry', 'investigate', 'resolve', 'ignore'],
}

/**
 * Grace period in days before a bank transaction becomes an "orphan"
 */
export const ORPHAN_GRACE_DAYS = 5
