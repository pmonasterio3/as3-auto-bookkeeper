# Code Changes Reference

**Quick reference for all code modifications needed**

---

## 1. supabase_client.py - Date Range Fix

**File:** `lambda/layers/common/python/utils/supabase_client.py`
**Line:** ~158-163

### Find:
```python
params = {
    "status": "eq.unmatched",
    "source": f"eq.{source}",
    "transaction_date": f"gte.{start_date}",
    "transaction_date": f"lte.{end_date}",
    "select": "id,transaction_date,description,amount,extracted_vendor,source",
    "order": "transaction_date.asc",
}
```

### Replace with:
```python
params = {
    "status": "eq.unmatched",
    "source": f"eq.{source}",
    "and": f"(transaction_date.gte.{start_date},transaction_date.lte.{end_date})",
    "select": "id,transaction_date,description,amount,extracted_vendor,source",
    "order": "transaction_date.asc",
}
```

---

## 2. qbo_client.py - Vendor Escaping Fix

**File:** `lambda/layers/common/python/utils/qbo_client.py`
**Line:** ~207-210

### Find:
```python
def _escape_vendor_name(self, name: str) -> str:
    return name.replace("'", "''")
```

### Replace with:
```python
def _escape_vendor_name(self, name: str) -> str:
    """
    Escape vendor name for QBO SQL query.
    Handles ASCII and Unicode quote variants.
    """
    if not name:
        return name

    # Unicode quote variants that appear in vendor names
    quote_chars = ["'", "'", "'", "`", "´"]

    result = name
    for char in quote_chars:
        result = result.replace(char, "''")

    return result
```

---

## 3. receive-zoho-webhook/index.ts - Combined File

**File:** `supabase/functions/receive-zoho-webhook/index.ts`

### Remove this import:
```typescript
import { fetchAndStoreReceipt } from './zoho-receipt-fetcher.ts'
```

### Add before `serve()` function (around line 45):

```typescript
// ========== ZOHO RECEIPT FETCHER (INLINE) ==========
interface ZohoTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
}

let cachedTokens: ZohoTokens | null = null

async function getZohoAccessToken(): Promise<string> {
  const now = Date.now()
  if (cachedTokens && cachedTokens.expiresAt > now + 60000) {
    return cachedTokens.accessToken
  }

  const clientId = Deno.env.get('ZOHO_CLIENT_ID')
  const clientSecret = Deno.env.get('ZOHO_CLIENT_SECRET')
  const refreshToken = Deno.env.get('ZOHO_REFRESH_TOKEN')

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Missing Zoho OAuth credentials')
  }

  const response = await fetch('https://accounts.zoho.com/oauth/v2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }),
  })

  if (!response.ok) {
    throw new Error(`Zoho token refresh failed: ${await response.text()}`)
  }

  const data = await response.json()
  cachedTokens = {
    accessToken: data.access_token,
    refreshToken: refreshToken,
    expiresAt: now + (data.expires_in * 1000),
  }
  return data.access_token
}

async function fetchReceiptFromZoho(
  expenseId: string
): Promise<{ blob: Blob; contentType: string; fileName: string } | null> {
  const accessToken = await getZohoAccessToken()
  const orgId = Deno.env.get('ZOHO_ORG_ID')
  if (!orgId) throw new Error('Missing ZOHO_ORG_ID')

  const metaResponse = await fetch(
    `https://www.zohoapis.com/expense/v1/organizations/${orgId}/expenses/${expenseId}/receipts`,
    { headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` } }
  )

  if (!metaResponse.ok) return null

  const metaData = await metaResponse.json()
  const receipts = metaData.receipts || []
  if (receipts.length === 0) return null

  const receipt = receipts[0]
  const downloadResponse = await fetch(
    `https://www.zohoapis.com/expense/v1/organizations/${orgId}/expenses/${expenseId}/receipts/${receipt.receipt_id}`,
    { headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` } }
  )

  if (!downloadResponse.ok) return null

  const contentType = downloadResponse.headers.get('content-type') || 'image/jpeg'
  const blob = await downloadResponse.blob()
  const extMap: Record<string, string> = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'application/pdf': 'pdf'
  }
  const ext = extMap[contentType] || 'jpg'

  return { blob, contentType, fileName: `${expenseId}.${ext}` }
}

async function uploadReceiptToStorage(
  supabase: any, blob: Blob, fileName: string, contentType: string
): Promise<string> {
  const storagePath = `receipts/${new Date().toISOString().slice(0, 7)}/${fileName}`
  const { error } = await supabase.storage
    .from('expense-receipts')
    .upload(storagePath, blob, { contentType, upsert: true })
  if (error) throw new Error(`Storage upload failed: ${error.message}`)
  return storagePath
}

async function fetchAndStoreReceipt(
  supabase: any, expenseId: string
): Promise<{ storagePath: string; contentType: string } | null> {
  const receipt = await fetchReceiptFromZoho(expenseId)
  if (!receipt) return null
  const storagePath = await uploadReceiptToStorage(
    supabase, receipt.blob, receipt.fileName, receipt.contentType
  )
  return { storagePath, contentType: receipt.contentType }
}
// ========== END ZOHO RECEIPT FETCHER ==========
```

---

## 4. SQL - Add Missing QBO Account Mapping

**Run in Supabase SQL Editor:**

```sql
-- Check what QBO account ID to use (look up in QBO)
-- Then run:
INSERT INTO qbo_accounts (name, qbo_id, account_type, zoho_category_match, is_cogs)
VALUES ('Vehicle Rent/Wash - COS', 'YOUR_QBO_ID_HERE', 'Expense', 'Vehicle (Rent/Wash) - COS', true)
ON CONFLICT (name) DO UPDATE SET zoho_category_match = EXCLUDED.zoho_category_match;
```

---

## 5. SQL - Fix Existing Expenses Missing Receipts

After Edge Function is fixed, re-trigger receipt fetch for existing expenses:

```sql
-- Identify expenses needing receipt retry
SELECT id, zoho_expense_id, vendor_name, amount
FROM zoho_expenses
WHERE receipt_storage_path IS NULL
AND status IN ('pending', 'error', 'flagged')
ORDER BY created_at DESC;

-- Reset status to pending so they get reprocessed
UPDATE zoho_expenses
SET status = 'pending',
    flag_reason = NULL,
    updated_at = NOW()
WHERE receipt_storage_path IS NULL
AND status IN ('error', 'flagged');
```

---

## Summary Checklist

- [ ] **supabase_client.py** - Fix date range query (5 min)
- [ ] **qbo_client.py** - Improve vendor escaping (5 min)
- [ ] **index.ts** - Combine with receipt fetcher (15 min)
- [ ] **SQL** - Add QBO account mapping (5 min)
- [ ] **Deploy Edge Function** via Dashboard (10 min)
- [ ] **Deploy Lambda** via SAM (10 min)
- [ ] **Test** with real expense (15 min)

**Total estimated time: ~1 hour for Phase 1 fixes**

---

*End of Code Changes Reference*
