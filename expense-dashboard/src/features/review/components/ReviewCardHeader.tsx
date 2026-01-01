import { formatCurrency } from '@/lib/utils'
import { Badge } from '@/components/ui/Badge'
import {
  DollarSign,
  Building2,
  Flag,
  AlertTriangle,
  AlertCircle,
  Clock,
  CheckCircle2,
} from 'lucide-react'
import type { ReviewItem, ItemType } from '../types'
import { ITEM_TYPE_LABELS, ITEM_TYPE_COLORS } from '../constants'

interface ReviewCardHeaderProps {
  item: ReviewItem
}

const TYPE_ICONS: Record<ItemType, typeof DollarSign> = {
  reimbursement: DollarSign,
  orphan: Building2,
  flagged: Flag,
  low_confidence: AlertTriangle,
  processing_error: AlertCircle,
  stuck: Clock,
  posted: CheckCircle2,
}

export function ReviewCardHeader({ item }: ReviewCardHeaderProps) {
  const colors = ITEM_TYPE_COLORS[item.itemType] || ITEM_TYPE_COLORS.flagged
  const Icon = TYPE_ICONS[item.itemType] || Flag
  const label = ITEM_TYPE_LABELS[item.itemType] || 'REVIEW ITEM'

  return (
    <div className={`px-4 py-2 flex items-center justify-between ${colors.header}`}>
      <div className="flex items-center gap-2">
        <Icon className={`h-5 w-5 ${colors.text}`} />
        <span className={`font-medium ${colors.text}`}>{label}</span>
        {item.predictions?.confidence !== undefined && item.predictions.confidence > 0 && (
          <Badge variant="warning" className="text-xs">
            {item.predictions.confidence}%
          </Badge>
        )}
        {item.daysWaiting > 0 && (
          <Badge variant="default" className="text-xs bg-gray-100 text-gray-600">
            <Clock className="h-3 w-3 mr-1" />
            {item.daysWaiting}d
          </Badge>
        )}
      </div>
      <span className="text-lg font-bold text-gray-900">
        {formatCurrency(item.amount)}
      </span>
    </div>
  )
}
