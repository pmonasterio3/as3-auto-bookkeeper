import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import type { Json, Database } from '@/types/database'
import { Button } from '@/components/ui/Button'

type ProcessingError = Database['public']['Tables']['processing_errors']['Row']
type ErrorStatus = 'new' | 'investigating' | 'retried' | 'resolved' | 'ignored'

import {
  AlertTriangle,
  CheckCircle,
  Clock,
  Eye,
  RefreshCw,
  X,
  ChevronDown,
  ChevronUp
} from 'lucide-react'
import { formatRelativeTime, formatCurrency } from '@/lib/utils'

const STATUS_CONFIG: Record<ErrorStatus, { label: string; color: string; icon: typeof AlertTriangle }> = {
  new: { label: 'New', color: 'bg-red-100 text-red-800', icon: AlertTriangle },
  investigating: { label: 'Investigating', color: 'bg-yellow-100 text-yellow-800', icon: Eye },
  retried: { label: 'Retried', color: 'bg-blue-100 text-blue-800', icon: RefreshCw },
  resolved: { label: 'Resolved', color: 'bg-green-100 text-green-800', icon: CheckCircle },
  ignored: { label: 'Ignored', color: 'bg-gray-100 text-gray-800', icon: X },
}

function isValidStatus(status: string): status is ErrorStatus {
  return ['new', 'investigating', 'retried', 'resolved', 'ignored'].includes(status)
}

function getStatusConfig(status: string) {
  if (isValidStatus(status)) {
    return STATUS_CONFIG[status]
  }
  return STATUS_CONFIG.new // fallback
}

interface ParsedErrorDetails {
  merchant_name?: string
  amount?: number
  date?: string
  category_name?: string
  state?: string
  ai_decision?: string
  ai_confidence?: number
  error?: {
    message?: string
    description?: string
  }
}

function parseErrorDetails(details: Json | null): ParsedErrorDetails | null {
  if (!details || typeof details !== 'object') return null
  return details as ParsedErrorDetails
}

interface ParsedQBOError {
  summary: string
  code: string | null
  element: string | null
  detail: string | null
  timestamp: string | null
}

function parseQBOError(errorMessage: string | null): ParsedQBOError {
  const defaultResult: ParsedQBOError = {
    summary: 'Unknown error',
    code: null,
    element: null,
    detail: null,
    timestamp: null,
  }

  if (!errorMessage) return defaultResult

  try {
    // Try to parse as JSON first
    const parsed = JSON.parse(errorMessage)

    // Extract top-level fields
    defaultResult.summary = parsed.message || 'Unknown error'
    defaultResult.timestamp = parsed.timestamp ? new Date(parsed.timestamp).toLocaleString() : null

    // The description field contains another JSON string with the actual QBO error
    if (parsed.description) {
      // Remove the "400 - " prefix if present
      let descStr = parsed.description.replace(/^\d{3}\s*-\s*/, '')

      // Try to parse the nested JSON
      try {
        // Handle escaped JSON string
        if (descStr.startsWith('"') && descStr.endsWith('"')) {
          descStr = JSON.parse(descStr)
        }

        const descParsed = typeof descStr === 'string' ? JSON.parse(descStr) : descStr

        if (descParsed.Fault?.Error?.[0]) {
          const qboError = descParsed.Fault.Error[0]
          defaultResult.code = qboError.code || null
          defaultResult.element = qboError.element || null
          defaultResult.detail = qboError.Detail || null
          defaultResult.summary = qboError.Message || defaultResult.summary
        }
      } catch {
        // If nested parse fails, use regex fallback
        const codeMatch = descStr.match(/"code":"([^"]+)"/i)
        const elementMatch = descStr.match(/"element":"([^"]+)"/i)
        const detailMatch = descStr.match(/"Detail":"([^"]+)"/i)
        const messageMatch = descStr.match(/"Message":"([^"]+)"/i)

        if (codeMatch) defaultResult.code = codeMatch[1]
        if (elementMatch) defaultResult.element = elementMatch[1]
        if (detailMatch) defaultResult.detail = detailMatch[1]
        if (messageMatch) defaultResult.summary = messageMatch[1]
      }
    }

    return defaultResult
  } catch {
    // Fallback to regex for non-JSON strings
    const codeMatch = errorMessage.match(/"code":"([^"]+)"/i)
    const elementMatch = errorMessage.match(/"element":"([^"]+)"/i)
    const detailMatch = errorMessage.match(/"Detail":"([^"]+)"/i)
    const messageMatch = errorMessage.match(/"Message":"([^"]+)"/i)

    if (codeMatch) defaultResult.code = codeMatch[1]
    if (elementMatch) defaultResult.element = elementMatch[1]
    if (detailMatch) defaultResult.detail = detailMatch[1]
    if (messageMatch) defaultResult.summary = messageMatch[1]

    if (!defaultResult.summary || defaultResult.summary === 'Unknown error') {
      defaultResult.summary = errorMessage.substring(0, 150) + (errorMessage.length > 150 ? '...' : '')
    }

    return defaultResult
  }
}

export function ProcessingErrorsPanel() {
  const [errors, setErrors] = useState<ProcessingError[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [filter, setFilter] = useState<ErrorStatus | 'all'>('new')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  useEffect(() => {
    fetchErrors()
  }, [filter])

  async function fetchErrors() {
    setIsLoading(true)
    try {
      let query = supabase
        .from('processing_errors')
        .select('id, expense_id, zoho_report_id, error_node, error_message, error_details, raw_payload, status, retry_count, created_at, resolved_at, resolved_by, notes')
        .order('created_at', { ascending: false })
        .limit(100)

      if (filter !== 'all') {
        query = query.eq('status', filter)
      }

      const { data, error } = await query

      if (error) throw error
      setErrors((data || []) as ProcessingError[])
    } catch (err) {
      console.error('Failed to fetch errors:', err)
    } finally {
      setIsLoading(false)
    }
  }

  async function updateStatus(id: string, newStatus: ErrorStatus, notes?: string) {
    setUpdatingId(id)
    try {
      const updates: Record<string, unknown> = { status: newStatus }
      if (newStatus === 'resolved') {
        updates.resolved_at = new Date().toISOString()
      }
      if (notes) {
        updates.notes = notes
      }

      const { error } = await supabase
        .from('processing_errors')
        .update(updates)
        .eq('id', id)

      if (error) throw error
      fetchErrors()
    } catch (err) {
      console.error('Failed to update status:', err)
    } finally {
      setUpdatingId(null)
    }
  }

  const counts = {
    new: errors.filter(e => e.status === 'new').length,
    investigating: errors.filter(e => e.status === 'investigating').length,
    resolved: errors.filter(e => e.status === 'resolved').length,
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Filter Tabs */}
      <div className="flex gap-2 border-b border-gray-200 pb-3">
        {(['new', 'investigating', 'resolved', 'all'] as const).map(status => (
          <button
            key={status}
            onClick={() => setFilter(status)}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              filter === status
                ? 'bg-[#C10230] text-white'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            {status === 'all' ? 'All' : STATUS_CONFIG[status]?.label || status}
            {status !== 'all' && status === 'new' && counts.new > 0 && (
              <span className="ml-1.5 bg-white/20 px-1.5 py-0.5 rounded text-xs">
                {counts.new}
              </span>
            )}
          </button>
        ))}
        <div className="flex-1" />
        <Button variant="ghost" size="sm" onClick={fetchErrors}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* Error List */}
      {errors.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <CheckCircle className="h-12 w-12 mx-auto mb-3 text-green-400" />
          <p className="font-medium">No errors found</p>
          <p className="text-sm">All processing is running smoothly</p>
        </div>
      ) : (
        <div className="space-y-3">
          {errors.map(error => {
            const statusConfig = getStatusConfig(error.status)
            const StatusIcon = statusConfig.icon
            const rawPayload = parseErrorDetails(error.raw_payload)
            const isExpanded = expandedId === error.id
            const parsedError = parseQBOError(error.error_message)

            return (
              <div
                key={error.id}
                className="border border-gray-200 rounded-lg overflow-hidden bg-white"
              >
                {/* Header Row */}
                <div
                  className="p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                  onClick={() => setExpandedId(isExpanded ? null : error.id)}
                >
                  <div className="flex items-start gap-3">
                    <StatusIcon className={`h-5 w-5 mt-0.5 flex-shrink-0 ${
                      error.status === 'new' ? 'text-red-500' :
                      error.status === 'investigating' ? 'text-yellow-500' :
                      error.status === 'resolved' ? 'text-green-500' : 'text-gray-400'
                    }`} />

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`px-2 py-0.5 text-xs font-medium rounded ${statusConfig?.color}`}>
                          {statusConfig?.label}
                        </span>
                        {rawPayload?.merchant_name && (
                          <span className="text-sm font-medium text-gray-900">
                            {rawPayload.merchant_name}
                          </span>
                        )}
                        {rawPayload?.amount && (
                          <span className="text-sm text-gray-600">
                            {formatCurrency(rawPayload.amount)}
                          </span>
                        )}
                      </div>

                      <p className="text-sm font-medium text-gray-800">
                        {parsedError.summary}
                      </p>
                      {parsedError.detail && (
                        <p className="text-sm text-gray-600 mt-1 line-clamp-2">
                          {parsedError.detail}
                        </p>
                      )}

                      <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                        {parsedError.code && (
                          <span className="px-1.5 py-0.5 bg-gray-100 rounded font-mono">
                            QBO-{parsedError.code}
                          </span>
                        )}
                        {parsedError.element && (
                          <span className="text-gray-600">
                            Field: <code className="bg-gray-100 px-1 rounded">{parsedError.element}</code>
                          </span>
                        )}
                        {error.created_at && (
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatRelativeTime(error.created_at)}
                          </span>
                        )}
                        {error.retry_count && error.retry_count > 0 && (
                          <span>Retries: {error.retry_count}</span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {isExpanded ? (
                        <ChevronUp className="h-5 w-5 text-gray-400" />
                      ) : (
                        <ChevronDown className="h-5 w-5 text-gray-400" />
                      )}
                    </div>
                  </div>
                </div>

                {/* Expanded Details */}
                {isExpanded && (
                  <div className="border-t border-gray-100 bg-gray-50 p-4 space-y-4">
                    {/* Expense Details */}
                    {rawPayload && (
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                        <div>
                          <span className="text-gray-500 text-xs">Category</span>
                          <p className="font-medium">{rawPayload.category_name || '-'}</p>
                        </div>
                        <div>
                          <span className="text-gray-500 text-xs">Date</span>
                          <p className="font-medium">{rawPayload.date || '-'}</p>
                        </div>
                        <div>
                          <span className="text-gray-500 text-xs">State</span>
                          <p className="font-medium">{rawPayload.state || '-'}</p>
                        </div>
                        <div>
                          <span className="text-gray-500 text-xs">AI Decision</span>
                          <p className="font-medium">
                            {rawPayload.ai_decision || '-'}
                            {rawPayload.ai_confidence && ` (${rawPayload.ai_confidence}%)`}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Parsed Error Details */}
                    <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-red-500" />
                        <span className="font-medium text-gray-900">QBO API Error</span>
                        {parsedError.code && (
                          <span className="px-2 py-0.5 bg-red-100 text-red-800 rounded text-xs font-mono">
                            Code: {parsedError.code}
                          </span>
                        )}
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                        <div>
                          <span className="text-gray-500 text-xs">Error Message</span>
                          <p className="font-medium text-gray-900">{parsedError.summary}</p>
                        </div>
                        {parsedError.element && (
                          <div>
                            <span className="text-gray-500 text-xs">Affected Field</span>
                            <p className="font-mono text-gray-900">{parsedError.element}</p>
                          </div>
                        )}
                      </div>

                      {parsedError.detail && (
                        <div>
                          <span className="text-gray-500 text-xs">Detail</span>
                          <p className="text-sm text-gray-700 bg-gray-50 p-2 rounded mt-1">
                            {parsedError.detail}
                          </p>
                        </div>
                      )}

                      {parsedError.timestamp && (
                        <div className="text-xs text-gray-500">
                          QBO Error Time: {parsedError.timestamp}
                        </div>
                      )}
                    </div>

                    {/* Raw JSON (collapsible) */}
                    <details className="text-xs">
                      <summary className="cursor-pointer text-gray-500 hover:text-gray-700">
                        View raw error JSON
                      </summary>
                      <pre className="mt-2 bg-white border border-gray-200 rounded p-3 overflow-x-auto max-h-40 text-xs whitespace-pre-wrap">
                        {error.error_message ? (() => {
                          try {
                            return JSON.stringify(JSON.parse(error.error_message), null, 2)
                          } catch {
                            return error.error_message
                          }
                        })() : 'No error message'}
                      </pre>
                    </details>

                    {/* Notes */}
                    {error.notes && (
                      <div>
                        <span className="text-gray-500 text-xs block mb-1">Notes</span>
                        <p className="text-sm bg-white border border-gray-200 rounded p-3">
                          {error.notes}
                        </p>
                      </div>
                    )}

                    {/* Action Buttons */}
                    <div className="flex gap-2 pt-2">
                      {error.status === 'new' && (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => {
                              e.stopPropagation()
                              updateStatus(error.id, 'investigating')
                            }}
                            disabled={updatingId === error.id}
                          >
                            <Eye className="h-4 w-4 mr-1" />
                            Investigate
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => {
                              e.stopPropagation()
                              updateStatus(error.id, 'resolved')
                            }}
                            disabled={updatingId === error.id}
                          >
                            <CheckCircle className="h-4 w-4 mr-1" />
                            Mark Resolved
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => {
                              e.stopPropagation()
                              updateStatus(error.id, 'ignored')
                            }}
                            disabled={updatingId === error.id}
                          >
                            <X className="h-4 w-4 mr-1" />
                            Ignore
                          </Button>
                        </>
                      )}
                      {error.status === 'investigating' && (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => {
                              e.stopPropagation()
                              updateStatus(error.id, 'resolved')
                            }}
                            disabled={updatingId === error.id}
                          >
                            <CheckCircle className="h-4 w-4 mr-1" />
                            Mark Resolved
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => {
                              e.stopPropagation()
                              updateStatus(error.id, 'new')
                            }}
                            disabled={updatingId === error.id}
                          >
                            Back to New
                          </Button>
                        </>
                      )}
                      {(error.status === 'resolved' || error.status === 'ignored') && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation()
                            updateStatus(error.id, 'new')
                          }}
                          disabled={updatingId === error.id}
                        >
                          Reopen
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
