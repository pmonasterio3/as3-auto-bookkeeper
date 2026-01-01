import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Combines class names with Tailwind merge support
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Format currency for display
 */
export function formatCurrency(amount: number | string | null): string {
  if (amount === null) return '$0.00'
  const num = typeof amount === 'string' ? parseFloat(amount) : amount
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(num)
}

/**
 * Format date for display
 *
 * Note: YYYY-MM-DD strings are parsed as local time (not UTC) to avoid
 * timezone issues where dates appear as the previous day in US timezones.
 */
export function formatDate(date: string | Date | null): string {
  if (!date) return '-'

  let d: Date
  if (typeof date === 'string') {
    // Check if it's a YYYY-MM-DD format (from date inputs)
    // Append T00:00:00 to parse as local time instead of UTC
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      d = new Date(date + 'T00:00:00')
    } else {
      d = new Date(date)
    }
  } else {
    d = date
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(d)
}

/**
 * Format relative time (e.g., "2 hours ago")
 */
export function formatRelativeTime(date: string | Date | null): string {
  if (!date) return '-'
  const d = typeof date === 'string' ? new Date(date) : date
  const now = new Date()
  const diff = now.getTime() - d.getTime()

  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  return formatDate(d)
}

/**
 * Get status badge color classes - AS3 branded
 */
export function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-800',
    approved: 'bg-green-100 text-green-800',
    corrected: 'bg-teal-100 text-teal-800',
    rejected: 'bg-red-100 text-red-800',
    auto_processed: 'bg-teal-100 text-teal-800',
    unmatched: 'bg-gray-100 text-gray-800',
    matched: 'bg-green-100 text-green-800',
    excluded: 'bg-slate-100 text-slate-800',
    orphan_processed: 'bg-amber-100 text-amber-800',
  }
  return colors[status] || 'bg-gray-100 text-gray-800'
}

/**
 * Truncate text with ellipsis
 */
export function truncate(text: string, length: number): string {
  if (text.length <= length) return text
  return text.slice(0, length) + '...'
}
