// Supabase Edge Function: validate-receipt
// Uses Claude AI to extract and validate receipt data
// Key: Claude fetches image from URL - no binary data in Edge Function memory

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ClaudeMessage {
  role: 'user' | 'assistant'
  content: Array<{
    type: 'text' | 'image'
    text?: string
    source?: {
      type: 'url'
      url: string
    }
  }>
}

interface ValidationResult {
  merchant_extracted: string | null
  amount_extracted: number | null
  date_extracted: string | null
  location_extracted: string | null
  amounts_match: boolean
  merchant_match: boolean
  confidence: number
  issues: string[]
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const startTime = Date.now()

  try {
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY')

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing Supabase environment variables')
    }

    if (!anthropicApiKey) {
      throw new Error('Missing ANTHROPIC_API_KEY environment variable')
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Parse request body
    const { expense_id } = await req.json()

    if (!expense_id) {
      return new Response(
        JSON.stringify({ error: 'Missing expense_id in request body' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`Validating receipt for expense: ${expense_id}`)

    // Fetch expense from database
    const { data: expense, error: fetchError } = await supabase
      .from('zoho_expenses')
      .select('id, zoho_expense_id, merchant_name, amount, expense_date, receipt_storage_path, receipt_content_type')
      .eq('id', expense_id)
      .single()

    if (fetchError || !expense) {
      console.error('Expense fetch error:', fetchError)
      return new Response(
        JSON.stringify({ error: `Expense not found: ${expense_id}` }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check if receipt exists
    if (!expense.receipt_storage_path) {
      console.log(`No receipt for expense ${expense_id}`)

      // Record validation result with no receipt
      const { data: validationData, error: insertError } = await supabase
        .from('receipt_validations')
        .insert({
          expense_id: expense.id,
          merchant_extracted: null,
          amount_extracted: null,
          date_extracted: null,
          location_extracted: null,
          amounts_match: false,
          merchant_match: false,
          confidence: 0,
          issues: ['No receipt attached to expense'],
          raw_response: null,
          model_used: 'none',
          processing_time_ms: Date.now() - startTime
        })
        .select('id')
        .single()

      if (insertError) {
        console.error('Validation insert error:', insertError)
      }

      // Update expense
      await supabase
        .from('zoho_expenses')
        .update({
          receipt_validated: true,
          receipt_validation_id: validationData?.id || null,
          updated_at: new Date().toISOString()
        })
        .eq('id', expense.id)

      return new Response(
        JSON.stringify({
          success: true,
          expense_id,
          validation: { confidence: 0, issues: ['No receipt attached'] },
          duration_ms: Date.now() - startTime
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get signed URL for receipt (valid for 1 hour)
    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
      .from('expense-receipts')
      .createSignedUrl(expense.receipt_storage_path, 3600)

    if (signedUrlError || !signedUrlData?.signedUrl) {
      console.error('Signed URL error:', signedUrlError)
      throw new Error(`Could not get signed URL for receipt: ${signedUrlError?.message}`)
    }

    const receiptUrl = signedUrlData.signedUrl
    console.log(`Got signed URL for receipt, calling Claude API...`)

    // Build Claude API request
    // Claude will fetch the image from the URL - no binary data in our memory
    const claudePayload = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'url',
                url: receiptUrl
              }
            },
            {
              type: 'text',
              text: `You are a receipt validation assistant. Analyze this receipt image and extract the following information.

CONTEXT FROM ZOHO EXPENSE REPORT:
- Expected Merchant: ${expense.merchant_name || 'Unknown'}
- Expected Amount: $${expense.amount || 0}
- Expense Date: ${expense.expense_date || 'Unknown'}

EXTRACT FROM THE RECEIPT IMAGE:
1. Merchant/Store Name (exactly as shown on receipt)
2. Total Amount (the final total, including tax)
3. Transaction Date (if visible)
4. Location/City/State (if visible)

VALIDATE:
1. Does the receipt amount match the expense amount ($${expense.amount})? Allow $0.01 tolerance for rounding.
2. Does the merchant name on receipt match or reasonably relate to "${expense.merchant_name}"?

Respond in this exact JSON format:
{
  "merchant_extracted": "string or null",
  "amount_extracted": number or null,
  "date_extracted": "YYYY-MM-DD or null",
  "location_extracted": "string or null",
  "amounts_match": boolean,
  "merchant_match": boolean,
  "confidence": 0-100,
  "issues": ["array of any issues or discrepancies found"]
}

CONFIDENCE SCORING:
- 95-100: Perfect match, clear receipt
- 80-94: Good match with minor discrepancies
- 60-79: Readable but some mismatches
- 40-59: Partially readable or significant mismatch
- 0-39: Unreadable or major issues

Only output valid JSON, no other text.`
            }
          ]
        }
      ]
    }

    // Call Claude API
    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(claudePayload)
    })

    if (!claudeResponse.ok) {
      const errorText = await claudeResponse.text()
      console.error('Claude API error:', claudeResponse.status, errorText)
      throw new Error(`Claude API error: ${claudeResponse.status} - ${errorText}`)
    }

    const claudeResult = await claudeResponse.json()
    const rawResponse = claudeResult.content?.[0]?.text || ''
    console.log('Claude response:', rawResponse)

    // Parse Claude's JSON response
    let validation: ValidationResult
    try {
      // Extract JSON from response (in case there's extra text)
      const jsonMatch = rawResponse.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        throw new Error('No JSON found in response')
      }
      validation = JSON.parse(jsonMatch[0])
    } catch (parseError) {
      console.error('JSON parse error:', parseError)
      validation = {
        merchant_extracted: null,
        amount_extracted: null,
        date_extracted: null,
        location_extracted: null,
        amounts_match: false,
        merchant_match: false,
        confidence: 0,
        issues: ['Failed to parse AI response', rawResponse.substring(0, 200)]
      }
    }

    // Store validation result
    const { data: validationData, error: insertError } = await supabase
      .from('receipt_validations')
      .insert({
        expense_id: expense.id,
        merchant_extracted: validation.merchant_extracted,
        amount_extracted: validation.amount_extracted,
        date_extracted: validation.date_extracted,
        location_extracted: validation.location_extracted,
        amounts_match: validation.amounts_match,
        merchant_match: validation.merchant_match,
        confidence: validation.confidence,
        issues: validation.issues || [],
        raw_response: rawResponse,
        model_used: 'claude-sonnet-4-20250514',
        processing_time_ms: Date.now() - startTime
      })
      .select('id')
      .single()

    if (insertError) {
      console.error('Validation insert error:', insertError)
      throw new Error(`Failed to store validation: ${insertError.message}`)
    }

    // Build expense update object
    const expenseUpdates: Record<string, unknown> = {
      receipt_validated: true,
      receipt_validation_id: validationData.id,
      vendor_clean: validation.merchant_extracted,
      updated_at: new Date().toISOString()
    }

    // AUTO-CORRECT AMOUNT: If receipt shows different amount with high confidence, fix it
    // This ensures bank matching has the correct amount to work with
    let amountCorrected = false
    const originalAmount = expense.amount
    if (
      !validation.amounts_match &&
      validation.amount_extracted !== null &&
      validation.confidence >= 70 &&
      Math.abs(validation.amount_extracted - expense.amount) > 0.01
    ) {
      expenseUpdates.amount = validation.amount_extracted
      expenseUpdates.original_amount = originalAmount  // Preserve original for audit
      amountCorrected = true
      console.log(`Amount auto-corrected: $${originalAmount} → $${validation.amount_extracted}`)

      // Add correction note to issues
      const correctionNote = `Amount auto-corrected from $${originalAmount} to $${validation.amount_extracted} based on receipt`
      validation.issues = [...(validation.issues || []), correctionNote]

      // Update the validation record with the correction note
      await supabase
        .from('receipt_validations')
        .update({ issues: validation.issues })
        .eq('id', validationData.id)
    }

    // Update expense with validation result (and corrected amount if applicable)
    const { error: updateError } = await supabase
      .from('zoho_expenses')
      .update(expenseUpdates)
      .eq('id', expense.id)

    if (updateError) {
      console.error('Expense update error:', updateError)
    }

    const duration = Date.now() - startTime
    console.log(`Validation complete in ${duration}ms: confidence=${validation.confidence}%${amountCorrected ? ' (amount corrected)' : ''}`)

    return new Response(
      JSON.stringify({
        success: true,
        expense_id,
        validation_id: validationData.id,
        validation: {
          merchant_extracted: validation.merchant_extracted,
          amount_extracted: validation.amount_extracted,
          amounts_match: validation.amounts_match,
          merchant_match: validation.merchant_match,
          confidence: validation.confidence,
          issues: validation.issues
        },
        amount_corrected: amountCorrected,
        original_amount: amountCorrected ? originalAmount : undefined,
        new_amount: amountCorrected ? validation.amount_extracted : undefined,
        duration_ms: duration
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Edge Function error:', error)
    const duration = Date.now() - startTime
    return new Response(
      JSON.stringify({
        error: error.message,
        stack: error.stack,
        duration_ms: duration
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
