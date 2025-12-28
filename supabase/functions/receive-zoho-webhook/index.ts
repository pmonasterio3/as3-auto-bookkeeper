// Supabase Edge Function: receive-zoho-webhook
// Receives Zoho expense report webhooks and stores expenses in zoho_expenses table
// This triggers the queue controller to process expenses one-by-one via n8n
// Receipt handling and validation is done by n8n workflow (has Zoho OAuth)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

        // Insert expense into zoho_expenses table
        // Receipt handling is done by n8n (has Zoho OAuth for API access)
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
            receipt_storage_path: null,  // Set by n8n after fetching from Zoho API
            receipt_content_type: null,
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
