// Supabase Edge Function: receive-zoho-webhook
// Receives Zoho expense report webhooks and stores expenses in zoho_expenses table
// This triggers the queue controller to process expenses one-by-one via Lambda
// Receipt is fetched from Zoho API and stored in Supabase Storage
//
// IMPORTANT: This is a COMBINED single-file deployment.
// Edge Functions deployed via Supabase Dashboard only support single files.
// The zoho-receipt-fetcher.ts code is inlined below.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ========== ZOHO RECEIPT FETCHER (INLINED) ==========
// Originally from zoho-receipt-fetcher.ts - combined for single-file deployment

interface ZohoTokens {
  accessToken: string
  expiresAt: number
}

// In-memory token cache (reused across invocations in same cold start)
let cachedTokens: ZohoTokens | null = null

/**
 * Get a valid Zoho access token, refreshing if necessary.
 */
async function getZohoAccessToken(): Promise<string> {
  const now = Date.now()

  // Use cached token if still valid (with 5 min buffer)
  if (cachedTokens && cachedTokens.expiresAt > now + 300000) {
    return cachedTokens.accessToken
  }

  // Get credentials from environment
  const clientId = Deno.env.get('ZOHO_CLIENT_ID')
  const clientSecret = Deno.env.get('ZOHO_CLIENT_SECRET')
  const refreshToken = Deno.env.get('ZOHO_REFRESH_TOKEN')

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Missing Zoho OAuth credentials in environment')
  }

  console.log('Refreshing Zoho access token...')

  // Refresh the token
  const response = await fetch('https://accounts.zoho.com/oauth/v2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }),
  })

  const data = await response.json()

  if (data.error) {
    console.error('Zoho token refresh failed:', data)
    throw new Error(`Zoho OAuth error: ${data.error}`)
  }

  if (!data.access_token) {
    throw new Error('No access_token in Zoho response')
  }

  // Cache the new token (expires_in is in seconds)
  cachedTokens = {
    accessToken: data.access_token,
    expiresAt: now + (data.expires_in * 1000),
  }

  console.log('Zoho access token refreshed successfully')
  return cachedTokens.accessToken
}

/**
 * Fetch a receipt document from Zoho Expense API.
 */
async function fetchReceiptFromZoho(
  organizationId: string,
  expenseId: string
): Promise<{ data: ArrayBuffer; contentType: string } | null> {
  const accessToken = await getZohoAccessToken()

  // CORRECT URL format - org ID goes in header, NOT in URL path
  const url = `https://www.zohoapis.com/expense/v1/expenses/${expenseId}/receipt`

  console.log(`Fetching receipt from Zoho: ${url}`)

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Zoho-oauthtoken ${accessToken}`,
      'X-com-zoho-expense-organizationid': organizationId,
    },
  })

  if (!response.ok) {
    if (response.status === 404) {
      console.log(`No receipt found for expense ${expenseId}`)
      return null
    }
    const errorText = await response.text()
    console.error(`Zoho API error ${response.status}: ${errorText}`)
    throw new Error(`Zoho API error: ${response.status}`)
  }

  // Strip charset suffix - Supabase Storage doesn't accept "image/jpeg;charset=UTF-8"
  const rawContentType = response.headers.get('content-type') || 'image/jpeg'
  const contentType = rawContentType.split(';')[0].trim()
  const data = await response.arrayBuffer()

  console.log(`Fetched receipt: ${data.byteLength} bytes, type: ${contentType}`)

  return { data, contentType }
}

/**
 * Upload receipt to Supabase Storage and return the path.
 */
async function uploadReceiptToStorage(
  supabase: SupabaseClient,
  expenseId: string,
  receiptData: ArrayBuffer,
  contentType: string
): Promise<string> {
  // Determine file extension from content type
  const extMap: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'application/pdf': 'pdf',
  }
  const ext = extMap[contentType] || 'jpg'

  // Create storage path: receipts/{YYYY}/{MM}/{expense_id}.{ext}
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const storagePath = `receipts/${year}/${month}/${expenseId}.${ext}`

  console.log(`Uploading receipt to storage: ${storagePath}`)

  // Upload to Supabase Storage
  const { error } = await supabase.storage
    .from('expense-receipts')
    .upload(storagePath, receiptData, {
      contentType,
      upsert: true, // Overwrite if exists (for retries)
    })

  if (error) {
    console.error('Storage upload error:', error)
    throw new Error(`Storage upload failed: ${error.message}`)
  }

  console.log(`Receipt uploaded successfully: ${storagePath}`)
  return storagePath
}

/**
 * Main function: Fetch receipt from Zoho and upload to storage.
 * Returns the storage path, or null if no receipt exists.
 */
async function fetchAndStoreReceipt(
  supabase: SupabaseClient,
  zohoExpenseId: string
): Promise<{ storagePath: string; contentType: string } | null> {
  const organizationId = Deno.env.get('ZOHO_ORGANIZATION_ID')

  if (!organizationId) {
    throw new Error('Missing ZOHO_ORGANIZATION_ID in environment')
  }

  // Fetch from Zoho
  const receipt = await fetchReceiptFromZoho(organizationId, zohoExpenseId)

  if (!receipt) {
    return null
  }

  // Upload to storage
  const storagePath = await uploadReceiptToStorage(
    supabase,
    zohoExpenseId,
    receipt.data,
    receipt.contentType
  )

  return {
    storagePath,
    contentType: receipt.contentType,
  }
}
// ========== END ZOHO RECEIPT FETCHER ==========

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ZohoExpense {
  expense_id: string
  date: string
  total: number
  merchant_name: string
  category_name: string
  description?: string
  paid_through_account_name?: string
  line_items?: Array<{
    tags?: Array<{
      tag_name: string
      tag_option_name: string
    }>
  }>
  documents?: Array<{
    document_id: string
    file_name: string
    file_type: string
  }>
}

interface ZohoReport {
  report_id: string
  report_name: string
  report_number?: string
  submitted_by?: {
    name: string
    email: string
    user_id: string
  }
  expenses: ZohoExpense[]
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const startTime = Date.now()

  try {
    // Initialize Supabase client with service role key
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing Supabase environment variables')
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Parse incoming webhook payload
    const payload = await req.json()
    console.log('Received Zoho webhook at', new Date().toISOString())
    console.log('Payload preview:', JSON.stringify(payload).substring(0, 500))

    // Extract expense report from payload
    // Zoho sends: { expense_report: { ... } } or { body: { expense_report: { ... } } }
    const report: ZohoReport = payload.expense_report || payload.body?.expense_report

    if (!report || !report.expenses) {
      console.error('Invalid payload structure:', Object.keys(payload))
      return new Response(
        JSON.stringify({
          error: 'Invalid payload: missing expense_report or expenses',
          received_keys: Object.keys(payload)
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const expenses = report.expenses
    console.log(`Processing report ${report.report_id} with ${expenses.length} expenses`)

    // Store report metadata first (upsert to handle re-submissions)
    const { error: reportError } = await supabase
      .from('zoho_expense_reports')
      .upsert({
        zoho_report_id: report.report_id,
        report_number: report.report_number,
        report_name: report.report_name,
        submitter_name: report.submitted_by?.name,
        submitter_email: report.submitted_by?.email,
        submitter_user_id: report.submitted_by?.user_id,
        expense_count: expenses.length,
        total_amount: expenses.reduce((sum, e) => sum + (e.total || 0), 0),
        report_status: 'approved',
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'zoho_report_id',
        ignoreDuplicates: false  // Update if exists
      })

    if (reportError) {
      console.error('Failed to store report metadata:', reportError)
      // Continue anyway - expense storage is more important
    }

    let insertedCount = 0
    let skippedCount = 0
    let errorCount = 0
    const errors: string[] = []

    // Process each expense
    for (const expense of expenses) {
      try {
        // Extract state tag from line items (Course Location tag)
        const stateTag = expense.line_items?.[0]?.tags
          ?.find((t) => t.tag_name === 'Course Location')
          ?.tag_option_name || null

        // Fetch receipt from Zoho API and upload to Supabase Storage
        // This is CRITICAL - Zoho expenses are created FROM receipts, so receipt MUST exist
        let receiptStoragePath: string | null = null
        let receiptContentType: string | null = null

        try {
          console.log(`Fetching receipt for expense ${expense.expense_id}...`)
          const receiptResult = await fetchAndStoreReceipt(supabase, expense.expense_id)

          if (receiptResult) {
            receiptStoragePath = receiptResult.storagePath
            receiptContentType = receiptResult.contentType
            console.log(`Receipt stored: ${receiptStoragePath}`)
          } else {
            console.warn(`No receipt found for expense ${expense.expense_id}`)
          }
        } catch (receiptError) {
          // Log but don't fail the entire expense - Lambda will handle missing receipts
          console.error(`Failed to fetch receipt for ${expense.expense_id}:`, receiptError)
        }

        // Insert expense into zoho_expenses table with receipt path
        // Using upsert with ignoreDuplicates for idempotency
        const { data, error: insertError } = await supabase
          .from('zoho_expenses')
          .upsert({
            zoho_expense_id: expense.expense_id,
            zoho_report_id: report.report_id,
            zoho_report_name: report.report_name,
            raw_payload: expense,
            expense_date: expense.date,
            amount: expense.total,
            merchant_name: expense.merchant_name,
            vendor_name: expense.merchant_name,  // For backward compatibility
            category_name: expense.category_name,
            description: expense.description,
            state_tag: stateTag,
            paid_through: expense.paid_through_account_name,
            receipt_storage_path: receiptStoragePath,
            receipt_content_type: receiptContentType,
            status: 'pending'  // Queue controller will pick this up
          }, {
            onConflict: 'zoho_expense_id',
            ignoreDuplicates: true  // Don't update if already exists (prevents re-processing)
          })
          .select('id')
          .single()

        if (insertError) {
          // Check if it's a duplicate (PGRST116 = no rows returned from single())
          if (insertError.code === 'PGRST116') {
            console.log(`Expense ${expense.expense_id} already exists, skipped`)
            skippedCount++
          } else {
            console.error(`Insert error for ${expense.expense_id}:`, insertError)
            errors.push(`${expense.expense_id}: ${insertError.message}`)
            errorCount++
          }
        } else if (data?.id) {
          console.log(`Expense ${expense.expense_id} inserted with ID ${data.id}`)
          insertedCount++
        }
      } catch (expenseError) {
        console.error(`Error processing expense ${expense.expense_id}:`, expenseError)
        errors.push(`${expense.expense_id}: ${expenseError.message}`)
        errorCount++
      }
    }

    const duration = Date.now() - startTime
    console.log(`Completed in ${duration}ms: ${insertedCount} inserted, ${skippedCount} skipped, ${errorCount} errors`)

    // Return success response
    return new Response(
      JSON.stringify({
        success: true,
        report_id: report.report_id,
        report_name: report.report_name,
        total_expenses: expenses.length,
        inserted: insertedCount,
        skipped: skippedCount,
        errors: errorCount,
        error_details: errors.length > 0 ? errors : undefined,
        duration_ms: duration
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  } catch (error) {
    console.error('Edge Function error:', error)
    return new Response(
      JSON.stringify({
        error: error.message,
        stack: error.stack
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})
