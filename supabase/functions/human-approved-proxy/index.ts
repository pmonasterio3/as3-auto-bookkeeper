// Supabase Edge Function: human-approved-proxy
// Proxies requests to AWS Lambda to avoid CORS issues
// Browser -> Edge Function -> Lambda (server-to-server, no CORS)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const LAMBDA_URL = 'https://7lvn2u8z5l.execute-api.us-east-1.amazonaws.com/prod/human-approved'
const LAMBDA_API_KEY = Deno.env.get('LAMBDA_API_KEY') || ''

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()

    console.log('Proxying to Lambda:', JSON.stringify(body))

    // Forward to Lambda
    const lambdaResponse = await fetch(LAMBDA_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': LAMBDA_API_KEY,
      },
      body: JSON.stringify(body),
    })

    const result = await lambdaResponse.json()

    console.log('Lambda response:', lambdaResponse.status, JSON.stringify(result))

    return new Response(JSON.stringify(result), {
      status: lambdaResponse.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Proxy error:', error)
    return new Response(
      JSON.stringify({ error: error.message || 'Proxy failed' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
})
