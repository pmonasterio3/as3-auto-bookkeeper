import { useState, useCallback, useEffect } from 'react'
import Papa, { type ParseResult } from 'papaparse'
import { supabase } from '@/lib/supabase'
import { formatRelativeTime } from '@/lib/utils'
import type { BankTransactionInsert, BankAccount } from '@/types/database'
import { Upload, AlertTriangle, CheckCircle, Loader2, CreditCard, Building, FileText, X, ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/Button'

// Generic CSV row with flexible keys (handles case variations)
interface CSVRow {
  [key: string]: string | undefined
}

interface FeedStatus {
  account_key: string
  display_name: string
  bank_name: string
  account_type: string
  csv_format: string
  lastImport: string | null
  count: number
  isActive: boolean
}

interface ParsedTransaction {
  transaction_date: string
  description: string
  amount: number  // Positive = expense, Negative = credit/refund
  source: string
  description_normalized: string
  extracted_vendor: string | null
  status: string
  is_credit: boolean  // True if this is a refund/credit (RECEIVED column)
  // Preview metadata
  raw_date: string
  raw_amount: string
  qbo_category?: string
}

interface ParseResult_Extended {
  transactions: ParsedTransaction[]
  creditCount: number  // Number of credit/refund transactions
  expenseCount: number // Number of expense transactions
  skippedNoAmount: number
  skippedInvalidDate: number
  parseErrors: string[]
  headers: string[]
  totalRows: number
  detectedFormat: string
}

interface ImportResult {
  success: number
  duplicates: number
  failed: number
  failedReasons: string[]
  accountName: string
}

// Helper: Get value from row with case-insensitive key matching
function getRowValue(row: CSVRow, ...possibleKeys: string[]): string {
  const rowKeys = Object.keys(row)
  for (const key of possibleKeys) {
    // Exact match first
    if (row[key] !== undefined) return row[key] || ''
    // Case-insensitive match
    const foundKey = rowKeys.find(k => k.toLowerCase() === key.toLowerCase())
    if (foundKey && row[foundKey] !== undefined) return row[foundKey] || ''
  }
  return ''
}

// Helper: Parse amount from string (handles $, commas, negative values)
function parseAmount(value: string): number {
  if (!value || value.trim() === '') return 0
  const cleaned = value.replace(/[$,\s]/g, '')
  const num = parseFloat(cleaned)
  return isNaN(num) ? 0 : Math.abs(num)
}

// Helper: Parse date from various formats to YYYY-MM-DD
function parseDate(value: string): { parsed: string | null; error: string | null } {
  if (!value || value.trim() === '') return { parsed: null, error: 'Empty date' }

  const trimmed = value.trim().replace(/"/g, '')

  // MM/DD/YYYY or M/D/YYYY
  if (trimmed.includes('/')) {
    const parts = trimmed.split('/')
    if (parts.length === 3) {
      const [month, day, year] = parts
      const m = month.padStart(2, '0')
      const d = day.padStart(2, '0')
      const y = year.length === 2 ? `20${year}` : year
      const result = `${y}-${m}-${d}`
      // Validate the result
      const testDate = new Date(result)
      if (!isNaN(testDate.getTime())) {
        return { parsed: result, error: null }
      }
    }
    return { parsed: null, error: `Invalid date format: ${value}` }
  }

  // YYYY-MM-DD (already in correct format)
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const testDate = new Date(trimmed)
    if (!isNaN(testDate.getTime())) {
      return { parsed: trimmed, error: null }
    }
  }

  // Try native Date parsing as fallback
  const testDate = new Date(trimmed)
  if (!isNaN(testDate.getTime())) {
    const y = testDate.getFullYear()
    const m = String(testDate.getMonth() + 1).padStart(2, '0')
    const d = String(testDate.getDate()).padStart(2, '0')
    return { parsed: `${y}-${m}-${d}`, error: null }
  }

  return { parsed: null, error: `Cannot parse date: ${value}` }
}

// Detect CSV format from headers
function detectCSVFormat(headers: string[]): string {
  const lowerHeaders = headers.map(h => h.toLowerCase())

  // QBO Export format: DATE, DESCRIPTION, From/To, SPENT, RECEIVED, ASSIGN TO
  if (lowerHeaders.includes('spent') || lowerHeaders.includes('received')) {
    return 'qbo_export'
  }

  // AMEX Direct: Reference, Extended Details, etc.
  if (lowerHeaders.includes('reference') || lowerHeaders.includes('extended details')) {
    return 'amex_direct'
  }

  // Wells Fargo Direct: Posting Date, Check or Slip #
  if (lowerHeaders.includes('posting date') || lowerHeaders.includes('check or slip #')) {
    return 'wells_fargo_direct'
  }

  // Generic: Date, Amount, Description
  if (lowerHeaders.includes('date') && (lowerHeaders.includes('amount') || lowerHeaders.includes('debit'))) {
    return 'generic'
  }

  return 'unknown'
}

export function BankFeedPanel() {
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([])
  const [feedStatus, setFeedStatus] = useState<FeedStatus[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isImporting, setIsImporting] = useState(false)
  const [isParsing, setIsParsing] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [lastResult, setLastResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showAccountPicker, setShowAccountPicker] = useState(false)

  // Preview state
  const [previewData, setPreviewData] = useState<ParseResult_Extended | null>(null)
  const [selectedAccount, setSelectedAccount] = useState<BankAccount | null>(null)
  const [showPreviewDetails, setShowPreviewDetails] = useState(false)

  useEffect(() => {
    fetchBankAccounts()
  }, [])

  async function fetchBankAccounts() {
    setIsLoading(true)
    try {
      const { data: accounts, error: accountsError } = await supabase
        .from('bank_accounts')
        .select('*')
        .eq('is_active', true)
        .order('display_name')

      if (accountsError) throw accountsError

      setBankAccounts((accounts || []) as BankAccount[])

      const { data: transactions, error: txnError } = await supabase
        .from('bank_transactions')
        .select('source, created_at')
        .order('created_at', { ascending: false })

      if (txnError) throw txnError

      const accountsList = (accounts || []) as BankAccount[]
      const txnsList = (transactions || []) as Array<{ source: string; created_at: string | null }>
      const status: FeedStatus[] = accountsList.map(account => {
        const accountTxns = txnsList.filter(t => t.source === account.account_key)
        return {
          account_key: account.account_key,
          display_name: account.display_name,
          bank_name: account.bank_name,
          account_type: account.account_type,
          csv_format: account.csv_format,
          lastImport: accountTxns[0]?.created_at || account.last_import_at || null,
          count: accountTxns.length,
          isActive: account.is_active ?? true
        }
      })

      setFeedStatus(status)
    } catch (err) {
      console.error('Failed to fetch bank accounts:', err)
      setError('Failed to load bank accounts')
    } finally {
      setIsLoading(false)
    }
  }

  const detectSource = useCallback((filename: string, headers: string[]): BankAccount | null => {
    const lowerName = filename.toLowerCase()

    // PRIORITY 1: Try to match by last_four digits in filename
    // Look for patterns like "7096", "3170", etc. in the filename
    const fourDigitPattern = /(\d{4})/g
    const digitsInFilename = lowerName.match(fourDigitPattern) || []

    for (const digits of digitsInFilename) {
      const matchedAccount = bankAccounts.find(a => a.last_four === digits)
      if (matchedAccount) {
        return matchedAccount
      }
    }

    // PRIORITY 2: Try to match by display_name keywords
    // But be careful with Wells Fargo - need to distinguish between accounts
    for (const account of bankAccounts) {
      // Check for specific account identifiers like "international", "driver training", etc.
      const displayKeywords = account.display_name.toLowerCase().split(/\s+/)
      const uniqueKeywords = displayKeywords.filter(kw =>
        kw.length > 3 && !['wells', 'fargo', 'bank', 'business'].includes(kw)
      )

      // If any unique keyword matches, return this account
      if (uniqueKeywords.some(kw => lowerName.includes(kw))) {
        return account
      }
    }

    // PRIORITY 3: Detect by content patterns in headers
    const format = detectCSVFormat(headers)
    if (format === 'amex_direct' || format === 'qbo_export') {
      // QBO exports work with any account, but prefer AMEX if "american" or "amex" in filename
      if (lowerName.includes('amex') || lowerName.includes('american')) {
        return bankAccounts.find(a => a.csv_format === 'amex') || null
      }
      // For Wells Fargo without specific identifier, DON'T auto-select
      // Let the user pick to avoid mis-categorization
      if (lowerName.includes('wells') || lowerName.includes('wf')) {
        // Only auto-select if there's exactly one Wells Fargo account
        const wfAccounts = bankAccounts.filter(a => a.csv_format === 'wells_fargo')
        if (wfAccounts.length === 1) {
          return wfAccounts[0]
        }
        // Multiple WF accounts - return null to prompt user selection
        return null
      }
      // Default to first AMEX account for QBO export
      return bankAccounts.find(a => a.csv_format === 'amex') || bankAccounts[0] || null
    }
    if (format === 'wells_fargo_direct') {
      const wfAccounts = bankAccounts.filter(a => a.csv_format === 'wells_fargo')
      if (wfAccounts.length === 1) {
        return wfAccounts[0]
      }
      return null
    }

    return null
  }, [bankAccounts])

  const normalizeDescription = (desc: string): string => {
    return desc.toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 100)
  }

  // NOTE: State extraction is NOT done during import.
  // States are determined by:
  // 1. Zoho Expense "Course Location" tag
  // 2. n8n processing via vendor_rules
  // 3. Manual review in attention queue
  // The web app import only stores raw bank data.

  const extractVendor = (desc: string): string | null => {
    let clean = desc.toUpperCase()

    // Remove Wells Fargo prefixes (with date patterns like "AUTHORIZED ON 12/05")
    clean = clean.replace(/^PURCHASE INTL\s+AUTHORIZED ON\s+\d{2}\/\d{2}\s+/, '')
    clean = clean.replace(/^PURCHASE\s+AUTHORIZED ON\s+\d{2}\/\d{2}\s+/, '')
    clean = clean.replace(/^RECURRING PAYMENT\s+AUTHORIZED ON\s+\d{2}\/\d{2}\s+/, '')
    clean = clean.replace(/^MONEY TRANSFER\s+AUTHORIZED ON\s+\d{2}\/\d{2}\s+/, '')

    // Remove card identifiers
    clean = clean.replace(/XXXX\d{4}/g, '')
    clean = clean.replace(/SXXXXXXXX\d+/g, '')
    clean = clean.replace(/CARD \d{4}/g, '')

    // Remove trailing state codes (2-letter codes at end)
    clean = clean.replace(/\s+[A-Z]{2}\s*$/g, '')

    // Clean up special characters but preserve spaces
    clean = clean.replace(/[^A-Z0-9\s]/g, ' ')

    // Get first 2-3 meaningful words
    const words = clean.trim().split(/\s+/).filter(w => w.length > 1)
    const vendorWords = words.slice(0, 3).join(' ')

    return vendorWords || null
  }

  // Parse CSV file and return preview data
  const parseCSVFile = useCallback((file: File): Promise<ParseResult_Extended> => {
    return new Promise((resolve, reject) => {
      Papa.parse<CSVRow>(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results: ParseResult<CSVRow>) => {
          const headers = results.meta.fields || []
          const format = detectCSVFormat(headers)
          const transactions: ParsedTransaction[] = []
          let creditCount = 0
          let expenseCount = 0
          let skippedNoAmount = 0
          let skippedInvalidDate = 0
          const parseErrors: string[] = []

          for (let i = 0; i < results.data.length; i++) {
            const row = results.data[i]
            const rowNum = i + 2 // +2 for header row and 0-index

            // Get values with case-insensitive matching
            const dateValue = getRowValue(row, 'DATE', 'Date', 'Transaction Date', 'Posting Date', 'date')
            const descValue = getRowValue(row, 'DESCRIPTION', 'Description', 'Memo', 'description')
            const spentValue = getRowValue(row, 'SPENT', 'Amount', 'Debit', 'amount', 'debit')
            const receivedValue = getRowValue(row, 'RECEIVED', 'Credit', 'received', 'credit')
            const qboCategory = getRowValue(row, 'ASSIGN TO', 'Category', 'assign to')

            // Parse amount - SPENT is positive (expense), RECEIVED is negative (refund/credit)
            const spentAmount = parseAmount(spentValue)
            const receivedAmount = parseAmount(receivedValue)

            // Determine amount: positive for expenses, negative for refunds/credits
            let amount = 0
            let isCredit = false
            if (spentAmount > 0) {
              amount = spentAmount
            } else if (receivedAmount > 0) {
              amount = -receivedAmount  // Negative = credit/refund
              isCredit = true
            }

            if (amount === 0) {
              skippedNoAmount++
              if (spentValue || receivedValue) {
                parseErrors.push(`Row ${rowNum}: Invalid amount (spent: "${spentValue}", received: "${receivedValue}")`)
              }
              continue
            }

            // Parse date
            const { parsed: parsedDate, error: dateError } = parseDate(dateValue)
            if (!parsedDate) {
              skippedInvalidDate++
              parseErrors.push(`Row ${rowNum}: ${dateError || 'Missing date'}`)
              continue
            }

            // Track credit vs expense counts
            if (isCredit) {
              creditCount++
            } else {
              expenseCount++
            }

            transactions.push({
              transaction_date: parsedDate,
              description: descValue || 'No description',
              amount,
              source: '', // Will be set on import
              description_normalized: normalizeDescription(descValue),
              extracted_vendor: extractVendor(descValue),
              status: 'unmatched',
              is_credit: isCredit,
              raw_date: dateValue,
              raw_amount: isCredit ? receivedValue : spentValue,
              qbo_category: qboCategory || undefined,
            })
          }

          resolve({
            transactions,
            creditCount,
            expenseCount,
            skippedNoAmount,
            skippedInvalidDate,
            parseErrors,
            headers,
            totalRows: results.data.length,
            detectedFormat: format,
          })
        },
        error: (error) => {
          reject(new Error(`CSV parse error: ${error.message}`))
        },
      })
    })
  }, [])

  // Process file: parse and show preview
  const processFile = useCallback(async (file: File, forceAccount?: BankAccount) => {
    setIsParsing(true)
    setError(null)
    setLastResult(null)
    setPreviewData(null)
    setShowAccountPicker(false)

    try {
      const parseResult = await parseCSVFile(file)

      if (parseResult.transactions.length === 0) {
        const reasons: string[] = []
        if (parseResult.totalRows === 0) reasons.push('File appears to be empty')
        if (parseResult.skippedNoAmount > 0) reasons.push(`${parseResult.skippedNoAmount} rows with no valid amount`)
        if (parseResult.skippedInvalidDate > 0) reasons.push(`${parseResult.skippedInvalidDate} rows with invalid dates`)
        if (parseResult.parseErrors.length > 0) reasons.push(`Parse errors: ${parseResult.parseErrors.slice(0, 3).join('; ')}`)

        setError(`No valid transactions found. ${reasons.join('. ')}`)
        setIsParsing(false)
        return
      }

      const account = forceAccount || detectSource(file.name, parseResult.headers)

      if (!account) {
        setPreviewData(parseResult)
        setShowAccountPicker(true)
        setIsParsing(false)
        return
      }

      // Show preview
      setSelectedAccount(account)
      setPreviewData(parseResult)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse CSV file')
    } finally {
      setIsParsing(false)
    }
  }, [parseCSVFile, detectSource])

  // Execute the actual import
  const executeImport = useCallback(async () => {
    if (!previewData || !selectedAccount) return

    setIsImporting(true)
    setError(null)

    try {
      const transactions: BankTransactionInsert[] = previewData.transactions.map(t => ({
        transaction_date: t.transaction_date,
        description: t.description,
        amount: t.amount,  // Positive = expense, Negative = credit/refund
        source: selectedAccount.account_key,
        description_normalized: t.description_normalized,
        extracted_vendor: t.extracted_vendor,
        // NOTE: extracted_state is NOT set during import - determined by n8n/Zoho
        status: 'unmatched',
      }))

      let successCount = 0
      let duplicateCount = 0
      let failedCount = 0
      const failedReasons: string[] = []

      // Insert with duplicate detection via unique constraint
      for (const txn of transactions) {
        const { error } = await supabase
          .from('bank_transactions')
          .insert(txn)

        if (error) {
          if (error.code === '23505') {
            // Unique constraint violation = duplicate transaction
            duplicateCount++
          } else {
            failedCount++
            failedReasons.push(`${txn.transaction_date}: ${error.message}`)
          }
        } else {
          successCount++
        }
      }

      // Update bank_accounts with last import info
      if (successCount > 0) {
        await supabase
          .from('bank_accounts')
          .update({
            last_import_at: new Date().toISOString(),
            last_import_count: successCount
          })
          .eq('id', selectedAccount.id)
      }

      setLastResult({
        success: successCount,
        duplicates: duplicateCount,
        failed: failedCount,
        failedReasons,
        accountName: selectedAccount.display_name,
      })

      // Clear preview state
      setPreviewData(null)
      setSelectedAccount(null)

      // Refresh feed status
      fetchBankAccounts()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setIsImporting(false)
    }
  }, [previewData, selectedAccount])

  const cancelImport = () => {
    setPreviewData(null)
    setSelectedAccount(null)
    setShowAccountPicker(false)
    setError(null)
  }

  const handleAccountSelect = (account: BankAccount) => {
    setSelectedAccount(account)
    setShowAccountPicker(false)
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file && file.name.toLowerCase().endsWith('.csv')) {
      processFile(file)
    } else {
      setError('Please upload a CSV file')
    }
  }, [processFile])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      processFile(file)
    }
    // Reset input so same file can be selected again
    e.target.value = ''
  }, [processFile])

  const getStatusColor = (status: FeedStatus) => {
    if (!status.lastImport) return { isStale: true, text: 'Never imported' }

    const lastDate = new Date(status.lastImport)
    const daysSince = Math.floor((Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24))

    return {
      isStale: daysSince > 5,
      text: `${formatRelativeTime(status.lastImport)} (${status.count} txns)`
    }
  }

  // Calculate preview stats
  const previewStats = previewData ? {
    total: previewData.transactions.length,
    credits: previewData.creditCount,
    expenses: previewData.expenseCount,
    dateRange: previewData.transactions.length > 0
      ? `${previewData.transactions[previewData.transactions.length - 1].transaction_date} to ${previewData.transactions[0].transaction_date}`
      : 'N/A',
    totalAmount: previewData.transactions.reduce((sum, t) => sum + t.amount, 0),
    skipped: previewData.skippedNoAmount + previewData.skippedInvalidDate,
  } : null

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      {/* Preview Mode */}
      {previewData && selectedAccount && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-[#C10230]" />
              <h3 className="font-medium text-gray-900">Import Preview</h3>
            </div>
            <button onClick={cancelImport} className="text-gray-400 hover:text-gray-600">
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Summary Card */}
          <div className="grid grid-cols-4 gap-4">
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-2xl font-bold text-gray-900">{previewStats?.total}</div>
              <div className="text-xs text-gray-500">Transactions to import</div>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-lg font-semibold text-gray-900">{previewStats?.dateRange}</div>
              <div className="text-xs text-gray-500">Date range</div>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-2xl font-bold text-green-600">${previewStats?.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
              <div className="text-xs text-gray-500">Total amount</div>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-2xl font-bold text-gray-400">{previewStats?.skipped}</div>
              <div className="text-xs text-gray-500">Rows skipped</div>
            </div>
          </div>

          {/* Account Info */}
          <div className="flex items-center gap-2 text-sm bg-blue-50 text-blue-700 rounded-lg px-3 py-2">
            <CreditCard className="h-4 w-4" />
            <span>Importing to: <strong>{selectedAccount.display_name}</strong></span>
            <span className="text-blue-500">({selectedAccount.bank_name})</span>
          </div>

          {/* Transaction breakdown and skipped info */}
          {previewStats && (previewStats.credits > 0 || previewStats.skipped > 0) && (
            <div className="text-sm bg-blue-50 text-blue-700 rounded-lg px-3 py-2">
              <div className="flex items-center gap-4">
                {previewStats.expenses > 0 && (
                  <span>{previewStats.expenses} expense{previewStats.expenses !== 1 ? 's' : ''}</span>
                )}
                {previewStats.credits > 0 && (
                  <span className="text-green-600">{previewStats.credits} credit{previewStats.credits !== 1 ? 's' : ''}/refund{previewStats.credits !== 1 ? 's' : ''}</span>
                )}
                {previewStats.skipped > 0 && (
                  <span className="text-amber-600">
                    {previewStats.skipped} row{previewStats.skipped !== 1 ? 's' : ''} skipped
                    ({previewData.skippedNoAmount > 0 ? `${previewData.skippedNoAmount} no amount` : ''}
                    {previewData.skippedNoAmount > 0 && previewData.skippedInvalidDate > 0 ? ', ' : ''}
                    {previewData.skippedInvalidDate > 0 ? `${previewData.skippedInvalidDate} invalid date` : ''})
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Parse errors */}
          {previewData.parseErrors.length > 0 && (
            <div className="text-sm">
              <button
                onClick={() => setShowPreviewDetails(!showPreviewDetails)}
                className="flex items-center gap-1 text-gray-500 hover:text-gray-700"
              >
                {showPreviewDetails ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                {previewData.parseErrors.length} parse warnings
              </button>
              {showPreviewDetails && (
                <div className="mt-2 max-h-32 overflow-auto bg-gray-50 rounded p-2 text-xs text-gray-600 font-mono">
                  {previewData.parseErrors.map((err, i) => <div key={i}>{err}</div>)}
                </div>
              )}
            </div>
          )}

          {/* Sample transactions */}
          <div className="border rounded-lg overflow-hidden">
            <div className="max-h-48 overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 sticky top-0">
                  <tr className="border-b">
                    <th className="text-left px-3 py-2 font-medium text-gray-600">Date</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-600">Description</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-600">Amount</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-600">Type</th>
                  </tr>
                </thead>
                <tbody>
                  {previewData.transactions.slice(0, 10).map((txn, i) => (
                    <tr key={i} className={`border-b last:border-b-0 hover:bg-gray-50 ${txn.is_credit ? 'bg-green-50' : ''}`}>
                      <td className="px-3 py-2 text-gray-600">{txn.transaction_date}</td>
                      <td className="px-3 py-2 text-gray-900 truncate max-w-xs" title={txn.description}>{txn.description}</td>
                      <td className={`px-3 py-2 text-right font-medium ${txn.is_credit ? 'text-green-600' : ''}`}>
                        {txn.is_credit ? '+' : ''}${Math.abs(txn.amount).toFixed(2)}
                      </td>
                      <td className="px-3 py-2">
                        {txn.is_credit ? (
                          <span className="text-xs px-1.5 py-0.5 bg-green-100 text-green-700 rounded">Credit</span>
                        ) : (
                          <span className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded">Expense</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {previewData.transactions.length > 10 && (
              <div className="px-3 py-2 bg-gray-50 text-xs text-gray-500 border-t">
                Showing 10 of {previewData.transactions.length} transactions
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={cancelImport} disabled={isImporting}>
              Cancel
            </Button>
            <Button onClick={executeImport} disabled={isImporting}>
              {isImporting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Importing...
                </>
              ) : (
                <>Import {previewData.transactions.length} Transactions</>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Account Picker (when auto-detect fails) */}
      {showAccountPicker && previewData && !selectedAccount && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-amber-600">
              <AlertTriangle className="h-5 w-5" />
              <h3 className="font-medium">Select Bank Account</h3>
            </div>
            <button onClick={cancelImport} className="text-gray-400 hover:text-gray-600">
              <X className="h-5 w-5" />
            </button>
          </div>

          <p className="text-sm text-gray-600">
            Could not auto-detect the bank account for this CSV. Found {previewData.transactions.length} transactions.
            Please select which account to import to:
          </p>

          <div className="grid grid-cols-2 gap-3">
            {bankAccounts.map(account => (
              <button
                key={account.id}
                onClick={() => handleAccountSelect(account)}
                className="flex items-center gap-3 p-3 bg-white border border-gray-200 rounded-lg text-left hover:border-[#C10230] hover:bg-red-50 transition-colors"
              >
                {account.account_type === 'credit_card' ? (
                  <CreditCard className="h-5 w-5 text-purple-600" />
                ) : (
                  <Building className="h-5 w-5 text-green-600" />
                )}
                <div>
                  <div className="font-medium text-gray-900">{account.display_name}</div>
                  <div className="text-xs text-gray-500">{account.bank_name}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Normal Mode (Drop Zone + Status) */}
      {!previewData && !showAccountPicker && (
        <div className="flex items-start gap-6">
          {/* Drop Zone */}
          <label
            className={`
              flex-shrink-0 w-56 h-24 rounded-lg border-2 border-dashed cursor-pointer
              flex flex-col items-center justify-center transition-colors
              ${isDragging
                ? 'border-[#C10230] bg-red-50'
                : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50'
              }
              ${isParsing ? 'pointer-events-none opacity-50' : ''}
            `}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
          >
            <input
              type="file"
              accept=".csv"
              onChange={handleFileSelect}
              className="hidden"
              disabled={isParsing}
            />
            {isParsing ? (
              <>
                <Loader2 className="h-6 w-6 text-[#C10230] animate-spin" />
                <span className="text-sm text-gray-500 mt-1">Parsing...</span>
              </>
            ) : (
              <>
                <Upload className="h-6 w-6 text-gray-400" />
                <span className="text-sm text-gray-500 mt-1">Drop CSV or click</span>
                <span className="text-xs text-gray-400">QBO export format</span>
              </>
            )}
          </label>

          {/* Status */}
          <div className="flex-1 space-y-2">
            <h3 className="text-sm font-medium text-gray-700">Bank Feed Status</h3>

            {isLoading ? (
              <div className="text-sm text-gray-500">Loading accounts...</div>
            ) : feedStatus.length === 0 ? (
              <div className="text-sm text-gray-500">No bank accounts configured. Add one in Bank Accounts settings.</div>
            ) : (
              <div className="grid grid-cols-2 gap-3 text-sm">
                {feedStatus.map(status => {
                  const { isStale, text } = getStatusColor(status)
                  return (
                    <div
                      key={status.account_key}
                      className={`flex items-center gap-2 ${isStale ? 'text-orange-600' : 'text-gray-600'}`}
                    >
                      {status.account_type === 'credit_card' ? (
                        <CreditCard className="h-4 w-4 flex-shrink-0" />
                      ) : (
                        <Building className="h-4 w-4 flex-shrink-0" />
                      )}
                      {isStale && <AlertTriangle className="h-4 w-4 flex-shrink-0" />}
                      <span className="font-medium truncate">{status.display_name}:</span>
                      <span className="truncate">{text}</span>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Last Result */}
            {lastResult && (
              <div className={`flex items-start gap-2 text-sm rounded-lg px-3 py-2 ${
                lastResult.failed > 0 ? 'bg-amber-50 text-amber-700' : 'bg-green-50 text-green-700'
              }`}>
                <CheckCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <div>
                  <div>
                    <strong>{lastResult.accountName}:</strong> Imported {lastResult.success} transactions
                    {lastResult.duplicates > 0 && `, ${lastResult.duplicates} duplicates skipped`}
                    {lastResult.failed > 0 && `, ${lastResult.failed} failed`}
                  </div>
                  {lastResult.failedReasons.length > 0 && (
                    <div className="text-xs mt-1 text-amber-600">
                      Errors: {lastResult.failedReasons.slice(0, 2).join('; ')}
                      {lastResult.failedReasons.length > 2 && ` (+${lastResult.failedReasons.length - 2} more)`}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
                <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
