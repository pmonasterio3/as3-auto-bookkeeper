// Supabase Edge Function: create-monday-subitem
// Creates a subitem in Monday.com Course Revenue Tracker
// Bypasses n8n HTTP Request node expression/escaping issues

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface SubitemRequest {
  parent_item_id: string
  item_name: string
  concept: string
  date: string
  amount: number | string
  status?: string
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const startTime = Date.now()

  try {
    // Validate API key authentication
    // This protects the endpoint from unauthorized access
    const expectedSecret = Deno.env.get('N8N_WEBHOOK_SECRET')
    const providedSecret = req.headers.get('x-api-key')

    if (!expectedSecret) {
      throw new Error('Missing N8N_WEBHOOK_SECRET environment variable')
    }

    if (!providedSecret || providedSecret !== expectedSecret) {
      console.error('Authentication failed: Invalid or missing API key')
      return new Response(
        JSON.stringify({ error: 'Unauthorized - invalid API key' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const mondayApiKey = Deno.env.get('MONDAY_API_KEY')

    if (!mondayApiKey) {
      throw new Error('Missing MONDAY_API_KEY environment variable')
    }

    // Parse request body
    const body: SubitemRequest = await req.json()

    const { parent_item_id, item_name, concept, date, amount, status = 'Paid' } = body

    if (!parent_item_id || !item_name) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: parent_item_id, item_name' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`Creating subitem for parent ${parent_item_id}: ${item_name}`)

    // Build column values for the subitem
    // Column IDs from Subitems of Course Revenue Tracker board (18381637294):
    // - text_mkxs8ntt: Concept
    // - status: Status (Pending/Paid/Over Due)
    // - date0: Date
    // - numeric_mkxs13eg: Amount
    const columnValues = {
      text_mkxs8ntt: concept || '',
      status: { label: status },
      date0: { date: date || null },
      numeric_mkxs13eg: String(amount || 0)
    }

    // Build the GraphQL mutation
    // Using inline values (not variables) to avoid escaping issues
    const columnValuesJson = JSON.stringify(columnValues)

    const mutation = `
      mutation {
        create_subitem(
          parent_item_id: "${parent_item_id}",
          item_name: "${item_name.replace(/"/g, '\\"')}",
          column_values: ${JSON.stringify(columnValuesJson)}
        ) {
          id
          name
        }
      }
    `

    console.log('GraphQL mutation:', mutation)

    // Call Monday.com API
    const mondayResponse = await fetch('https://api.monday.com/v2', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': mondayApiKey,
        'API-Version': '2024-10'
      },
      body: JSON.stringify({ query: mutation })
    })

    if (!mondayResponse.ok) {
      const errorText = await mondayResponse.text()
      console.error('Monday.com API error:', mondayResponse.status, errorText)
      throw new Error(`Monday.com API error: ${mondayResponse.status} - ${errorText}`)
    }

    const mondayResult = await mondayResponse.json()
    console.log('Monday.com response:', JSON.stringify(mondayResult))

    // Check for GraphQL errors
    if (mondayResult.errors && mondayResult.errors.length > 0) {
      console.error('GraphQL errors:', mondayResult.errors)
      throw new Error(`GraphQL error: ${mondayResult.errors[0].message}`)
    }

    const subitem = mondayResult.data?.create_subitem

    if (!subitem) {
      throw new Error('No subitem returned from Monday.com')
    }

    const duration = Date.now() - startTime
    console.log(`Subitem created successfully in ${duration}ms: ${subitem.id}`)

    return new Response(
      JSON.stringify({
        success: true,
        subitem_id: subitem.id,
        subitem_name: subitem.name,
        parent_item_id: parent_item_id,
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
