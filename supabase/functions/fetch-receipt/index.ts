import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Get receipt path from query params or body
    let receiptPath: string | null = null

    if (req.method === 'GET') {
      const url = new URL(req.url)
      receiptPath = url.searchParams.get('path')
    } else if (req.method === 'POST') {
      const body = await req.json()
      receiptPath = body.path || body.receipt_path
    }

    if (!receiptPath) {
      return new Response(
        JSON.stringify({ error: 'Missing receipt path parameter' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Create Supabase client with service role (server-side only)
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Download the receipt from storage
    const { data, error } = await supabase.storage
      .from('expense-receipts')
      .download(receiptPath)

    if (error) {
      console.error('Storage download error:', error)
      return new Response(
        JSON.stringify({ error: `Failed to fetch receipt: ${error.message}` }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!data) {
      return new Response(
        JSON.stringify({ error: 'Receipt not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Convert blob to base64
    const arrayBuffer = await data.arrayBuffer()
    const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)))

    // Determine content type from file extension
    const ext = receiptPath.split('.').pop()?.toLowerCase() || 'jpg'
    const mimeTypes: Record<string, string> = {
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'pdf': 'application/pdf',
      'webp': 'image/webp'
    }
    const contentType = mimeTypes[ext] || 'image/jpeg'

    // Return base64 encoded image with metadata
    return new Response(
      JSON.stringify({
        success: true,
        receipt_path: receiptPath,
        content_type: contentType,
        base64_image: base64,
        data_url: `data:${contentType};base64,${base64}`
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )

  } catch (err) {
    console.error('Fetch receipt error:', err)
    return new Response(
      JSON.stringify({ error: `Server error: ${err.message}` }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
