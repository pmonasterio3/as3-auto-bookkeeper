import { type ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface StatCardProps {
  title: string
  value: string | number
  icon: ReactNode
  trend?: {
    value: number
    isPositive: boolean
  }
  variant?: 'default' | 'warning' | 'success' | 'error'
}

export function StatCard({ title, value, icon, trend, variant = 'default' }: StatCardProps) {
  const variants = {
    default: 'bg-white',
    warning: 'bg-amber-50 border-amber-200',
    success: 'bg-green-50 border-green-200',
    error: 'bg-red-50 border-red-200',
  }

  const iconVariants = {
    default: 'bg-red-100 text-[#C10230]',
    warning: 'bg-amber-100 text-amber-600',
    success: 'bg-green-100 text-green-600',
    error: 'bg-red-100 text-red-600',
  }

  return (
    <div className={cn('rounded-lg border p-6 shadow-sm', variants[variant])}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-500">{title}</p>
          <p className="mt-2 text-3xl font-semibold text-gray-900">{value}</p>
          {trend && (
            <p className={cn(
              'mt-2 text-sm font-medium',
              trend.isPositive ? 'text-green-600' : 'text-red-600'
            )}>
              {trend.isPositive ? '+' : ''}{trend.value}% from last week
            </p>
          )}
        </div>
        <div className={cn('p-3 rounded-lg', iconVariants[variant])}>
          {icon}
        </div>
      </div>
    </div>
  )
}
