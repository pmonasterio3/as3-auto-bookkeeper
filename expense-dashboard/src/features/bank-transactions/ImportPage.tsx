import { useState, type ChangeEvent } from 'react'
import Papa, { type ParseResult } from 'papaparse'
import { supabase } from '@/lib/supabase'
import { formatCurrency } from '@/lib/utils'
import type { BankTransactionInsert } from '@/types/database'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Upload, FileText, CheckCircle, AlertTriangle } from 'lucide-react'

interface CSVRow {
  Date?: string
  'Transaction Date'?: string
  date?: string
  Description?: string
  description?: string
  Memo?: string
  Amount?: string
  amount?: string
  Debit?: string
  Credit?: string
}

interface ParsedTransaction {
  transaction_date: string
  description: string
  amount: number
  source: 'amex' | 'wells_fargo'
  description_normalized: string
  extracted_vendor: string | null
  extracted_state: string | null
}

export function ImportPage() {
  const [file, setFile] = useState<File | null>(null)
  const [source, setSource] = useState<'amex' | 'wells_fargo'>('amex')
  const [preview, setPreview] = useState<ParsedTransaction[]>([])
  const [isUploading, setIsUploading] = useState(false)
  const [result, setResult] = useState<{ success: number; duplicates: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (selectedFile) {
      setFile(selectedFile)
      setResult(null)
      setError(null)
      parseFile(selectedFile)
    }
  }

  const normalizeDescription = (desc: string): string => {
    return desc.toUpperCase().replace(/[^A-Z0-9]/g, '')
  }

  const extractState = (desc: string): string | null => {
    const statePatterns = [
      /\s(CA|TX|CO|WA|NJ|FL|MT)\s/i,
      /\s(CALIFORNIA|TEXAS|COLORADO|WASHINGTON|NEW JERSEY|FLORIDA|MONTANA)/i,
    ]
    for (const pattern of statePatterns) {
      const match = desc.match(pattern)
      if (match) {
        const state = match[1].toUpperCase()
        const stateMap: Record<string, string> = {
          CALIFORNIA: 'CA', TEXAS: 'TX', COLORADO: 'CO',
          WASHINGTON: 'WA', 'NEW JERSEY': 'NJ', FLORIDA: 'FL', MONTANA: 'MT',
        }
        return stateMap[state] || state
      }
    }
    return null
  }

  const extractVendor = (desc: string): string => {
    // Take first meaningful words from description
    const cleaned = desc.replace(/\d{4,}/g, '').replace(/[^A-Za-z\s]/g, ' ').trim()
    const words = cleaned.split(/\s+/).slice(0, 3)
    return words.join(' ')
  }

  const parseFile = (file: File) => {
    Papa.parse<CSVRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results: ParseResult<CSVRow>) => {
        try {
          const transactions: ParsedTransaction[] = results.data
            .filter((row) => {
              // Filter out header rows or empty rows
              const hasDate = row.Date || row['Transaction Date'] || row.date
              const hasAmount = row.Amount || row.amount || row.Debit || row.Credit
              return hasDate && hasAmount
            })
            .map((row) => {
              // Handle different CSV formats
              const dateField = row.Date || row['Transaction Date'] || row.date || ''
              const descField = row.Description || row.description || row.Memo || ''
              let amount = 0

              // AMEX format: single Amount column (negative for charges)
              // Wells Fargo: Debit/Credit columns
              if (row.Amount) {
                amount = Math.abs(parseFloat(row.Amount.replace(/[$,]/g, '')))
              } else if (row.Debit) {
                amount = Math.abs(parseFloat(row.Debit.replace(/[$,]/g, '')))
              } else if (row.Credit) {
                amount = Math.abs(parseFloat(row.Credit.replace(/[$,]/g, '')))
              }

              // Parse date (handle MM/DD/YYYY or YYYY-MM-DD)
              let parsedDate = dateField
              if (dateField.includes('/')) {
                const [month, day, year] = dateField.split('/')
                parsedDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
              }

              return {
                transaction_date: parsedDate,
                description: descField,
                amount,
                source,
                description_normalized: normalizeDescription(descField),
                extracted_vendor: extractVendor(descField),
                extracted_state: extractState(descField),
              }
            })
            .filter((t) => t.amount > 0 && t.transaction_date)

          setPreview(transactions.slice(0, 10))
        } catch {
          setError('Failed to parse file. Please check the format.')
        }
      },
      error: () => {
        setError('Failed to read file')
      },
    })
  }

  const handleImport = async () => {
    if (!file) return

    setIsUploading(true)
    setError(null)

    try {
      // Re-parse the full file for import
      Papa.parse<CSVRow>(file, {
        header: true,
        skipEmptyLines: true,
        complete: async (results: ParseResult<CSVRow>) => {
          const transactions: BankTransactionInsert[] = results.data
            .filter((row) => {
              const hasDate = row.Date || row['Transaction Date'] || row.date
              const hasAmount = row.Amount || row.amount || row.Debit || row.Credit
              return hasDate && hasAmount
            })
            .map((row) => {
              const dateField = row.Date || row['Transaction Date'] || row.date || ''
              const descField = row.Description || row.description || row.Memo || ''
              let amount = 0

              if (row.Amount) {
                amount = Math.abs(parseFloat(row.Amount.replace(/[$,]/g, '')))
              } else if (row.Debit) {
                amount = Math.abs(parseFloat(row.Debit.replace(/[$,]/g, '')))
              } else if (row.Credit) {
                amount = Math.abs(parseFloat(row.Credit.replace(/[$,]/g, '')))
              }

              let parsedDate = dateField
              if (dateField.includes('/')) {
                const [month, day, year] = dateField.split('/')
                parsedDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
              }

              return {
                transaction_date: parsedDate,
                description: descField,
                amount,
                source,
                description_normalized: normalizeDescription(descField),
                extracted_vendor: extractVendor(descField),
                extracted_state: extractState(descField),
                status: 'unmatched',
              }
            })
            .filter((t) => t.amount > 0 && t.transaction_date)

          // Insert with upsert to handle duplicates
          let successCount = 0
          let duplicateCount = 0

          for (const txn of transactions) {
            const { error } = await supabase
              .from('bank_transactions')
              .upsert(txn, {
                onConflict: 'source,transaction_date,amount,description_normalized',
                ignoreDuplicates: true,
              })

            if (error) {
              if (error.code === '23505') { // Duplicate
                duplicateCount++
              }
            } else {
              successCount++
            }
          }

          setResult({ success: successCount, duplicates: duplicateCount })
          setIsUploading(false)
        },
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
      setIsUploading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Import Bank Transactions</h1>
        <p className="mt-1 text-gray-500">
          Upload CSV files from AMEX or Wells Fargo
        </p>
      </div>

      {/* Upload form */}
      <Card>
        <CardHeader>
          <CardTitle>Upload CSV File</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Source selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Bank Source
            </label>
            <div className="flex gap-4">
              <label className="flex items-center">
                <input
                  type="radio"
                  name="source"
                  value="amex"
                  checked={source === 'amex'}
                  onChange={(e) => setSource(e.target.value as 'amex' | 'wells_fargo')}
                  className="mr-2"
                />
                AMEX
              </label>
              <label className="flex items-center">
                <input
                  type="radio"
                  name="source"
                  value="wells_fargo"
                  checked={source === 'wells_fargo'}
                  onChange={(e) => setSource(e.target.value as 'amex' | 'wells_fargo')}
                  className="mr-2"
                />
                Wells Fargo
              </label>
            </div>
          </div>

          {/* File input */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              CSV File
            </label>
            <div className="flex items-center gap-4">
              <label className="flex items-center justify-center px-4 py-2 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50">
                <Upload className="h-4 w-4 mr-2" />
                Choose File
                <input
                  type="file"
                  accept=".csv"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>
              {file && (
                <span className="text-sm text-gray-600 flex items-center">
                  <FileText className="h-4 w-4 mr-1" />
                  {file.name}
                </span>
              )}
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          {/* Success */}
          {result && (
            <div className="p-4 rounded-lg bg-green-50 border border-green-200">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-green-600" />
                <span className="font-medium text-green-700">Import Complete</span>
              </div>
              <p className="mt-1 text-sm text-green-600">
                {result.success} transactions imported, {result.duplicates} duplicates skipped
              </p>
            </div>
          )}

          {/* Import button */}
          <Button
            onClick={handleImport}
            disabled={!file || isUploading}
            isLoading={isUploading}
          >
            Import Transactions
          </Button>
        </CardContent>
      </Card>

      {/* Preview */}
      {preview.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Preview (First 10 Rows)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead>
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                      Date
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                      Amount
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                      Vendor
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                      State
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                      Description
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {preview.map((txn, i) => (
                    <tr key={i}>
                      <td className="px-4 py-2 text-sm">{txn.transaction_date}</td>
                      <td className="px-4 py-2 text-sm font-medium">
                        {formatCurrency(txn.amount)}
                      </td>
                      <td className="px-4 py-2 text-sm">{txn.extracted_vendor || '-'}</td>
                      <td className="px-4 py-2 text-sm">
                        {txn.extracted_state || (
                          <span className="text-orange-500 flex items-center">
                            <AlertTriangle className="h-3 w-3 mr-1" />
                            Unknown
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-500 font-mono truncate max-w-xs">
                        {txn.description}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
