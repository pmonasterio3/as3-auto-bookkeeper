// Supabase Edge Function: receive-zoho-webhook
// Receives Zoho expense report webhooks and stores expenses in zoho_expenses table
// This triggers the queue controller to process expenses one-by-one via n8n

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

/**
 * Get a fresh Zoho access token using the refresh token
 * Refresh tokens don't expire, but access tokens expire in 1 hour
 */
async function getZohoAccessToken(): Promise<string | null> {
  const clientId = Deno.env.get('ZOHO_CLIENT_ID')
  const clientSecret = Deno.env.get('ZOHO_CLIENT_SECRET')
  const refreshToken = Deno.env.get('ZOHO_REFRESH_TOKEN')

  if (!clientId || !clientSecret || !refreshToken) {
    console.error('Missing Zoho OAuth credentials (ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN)')
    return null
  }

  try {
    const response = await fetch('https://accounts.zoho.com/oauth/v2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Zoho token refresh failed:', errorText)
      return null
    }

    const data = await response.json()
    return data.access_token
  } catch (error) {
    console.error('Zoho token refresh error:', error)
    return null
  }
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
    download_url: string
    file_name: string
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

        // Download and store receipt if available
        let receiptPath: string | null = null
        let receiptContentType: string | null = null

        // Check if expense has documents (receipt attached)
        const document = expense.documents?.[0]
        if (document?.document_id) {
          try {
            console.log(`Downloading receipt for expense ${expense.expense_id}, document ${document.document_id}`)

            // Get fresh Zoho OAuth token using refresh token
            const zohoAccessToken = await getZohoAccessToken()
            const zohoOrgId = Deno.env.get('ZOHO_ORG_ID') || '867260975'

            if (!zohoAccessToken) {
              console.error('Could not get Zoho access token - skipping receipt download')
            } else {
              // Fetch receipt from Zoho API
              const receiptUrl = `https://www.zohoapis.com/expense/v1/expenses/${expense.expense_id}/receipt`
              const receiptResponse = await fetch(receiptUrl, {
                headers: {
                  'Authorization': `Zoho-oauthtoken ${zohoAccessToken}`,
                  'X-com-zoho-expense-organizationid': zohoOrgId
                }
              })

              if (receiptResponse.ok) {
                const receiptBlob = await receiptResponse.blob()
                receiptContentType = receiptResponse.headers.get('content-type') || 'image/jpeg'

                // Determine file extension from document info or content type
                let extension = document.file_type || 'jpg'
                if (extension === 'jpeg') extension = 'jpg'

                const filename = `${expense.expense_id}.${extension}`
                receiptPath = `${report.report_id}/${filename}`

                // Upload to Supabase Storage
                const { error: uploadError } = await supabase.storage
                  .from('expense-receipts')
                  .upload(receiptPath, receiptBlob, {
                    contentType: receiptContentType,
                    upsert: true  // Overwrite if exists (for re-submissions)
                  })

                if (uploadError) {
                  console.error(`Receipt upload error for ${expense.expense_id}:`, uploadError)
                  receiptPath = null  // Clear path if upload failed
                } else {
                  console.log(`Receipt uploaded: ${receiptPath}`)
                }
              } else {
                const errorText = await receiptResponse.text()
                console.error(`Failed to download receipt: HTTP ${receiptResponse.status} - ${errorText}`)
              }
            }
          } catch (receiptError) {
            console.error(`Receipt processing error for ${expense.expense_id}:`, receiptError)
            // Continue without receipt - it's not critical
          }
        }

        // Insert expense into zoho_expenses table
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
            receipt_storage_path: receiptPath,
            receipt_content_type: receiptContentType,
            status: 'pending'  // Queue controller will pick this up
          }, {
            onConflict: 'zoho_expense_id',
            ignoreDuplicates: true  // Don't update if already exists (prevents re-processing)
          })

        if (insertError) {
          console.error(`Insert error for ${expense.expense_id}:`, insertError)
          errors.push(`${expense.expense_id}: ${insertError.message}`)
          errorCount++
        } else if (data === null) {
          // No data returned means it was a duplicate (ignored)
          console.log(`Expense ${expense.expense_id} already exists, skipped`)
          skippedCount++
        } else {
          console.log(`Expense ${expense.expense_id} inserted successfully`)
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
