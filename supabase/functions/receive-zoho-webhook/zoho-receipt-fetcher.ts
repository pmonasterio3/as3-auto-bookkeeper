/**
 * Zoho Receipt Fetcher
 * ====================
 *
 * Handles fetching receipt documents from Zoho Expense API
 * and uploading them to Supabase Storage.
 */

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

  const url = `https://www.zohoapis.com/expense/v1/organizations/${organizationId}/expenses/${expenseId}/receipt`

  console.log(`Fetching receipt from Zoho: ${url}`)

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Zoho-oauthtoken ${accessToken}`,
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

  const contentType = response.headers.get('content-type') || 'image/jpeg'
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
export async function fetchAndStoreReceipt(
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
