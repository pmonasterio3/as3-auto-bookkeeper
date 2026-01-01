# Troubleshooting Guide

**Version:** 1.0 | **Updated:** December 31, 2025

---

## Quick Reference

| Symptom | Likely Cause | Jump To |
|---------|--------------|---------|
| "invalid_code" from Zoho | Refresh token expired | [Zoho OAuth Errors](#zoho-oauth-errors) |
| "Invalid URL Passed" | Org ID in URL path | [Zoho API Errors](#zoho-api-errors) |
| "mime type not supported" | Charset suffix in content-type | [Storage Errors](#supabase-storage-errors) |
| "Receipt not fetched" | Multiple possible causes | [Receipt Fetch Failures](#receipt-fetch-failures) |
| Expenses stuck in pending | Lambda not triggered | [Lambda Issues](#lambda-issues) |

---

## Zoho OAuth Errors

### Error: `{"error":"invalid_code"}`

**When It Appears:**
- Token refresh fails in Edge Function logs
- All expenses fail with "Receipt not fetched"

**Root Cause:**
The `ZOHO_REFRESH_TOKEN` stored in Supabase secrets is expired or invalid.

**Solution:**

1. Go to https://api-console.zoho.com/
2. Select your **Self Client**
3. Click **Generate Code** tab
4. Enter scope: `ZohoExpense.fullaccess.ALL`
5. Click **CREATE**
6. Copy code IMMEDIATELY (expires in 3-10 minutes!)

7. Within 3 minutes, run:
```bash
curl -X POST "https://accounts.zoho.com/oauth/v2/token" \
  -d "client_id=YOUR_CLIENT_ID" \
  -d "client_secret=YOUR_CLIENT_SECRET" \
  -d "grant_type=authorization_code" \
  -d "code=PASTE_CODE_HERE"
```

8. Copy `refresh_token` from response
9. Update in: **Supabase Dashboard → Project Settings → Edge Functions → Secrets → ZOHO_REFRESH_TOKEN**
10. Redeploy the Edge Function (click Edit, then Save)

**Verification:**
```bash
curl -X POST "https://accounts.zoho.com/oauth/v2/token" \
  -d "client_id=YOUR_CLIENT_ID" \
  -d "client_secret=YOUR_CLIENT_SECRET" \
  -d "grant_type=refresh_token" \
  -d "refresh_token=NEW_REFRESH_TOKEN"
```
Should return a new `access_token`.

---

### Error: `{"error":"You are not authorized"}`

**Root Cause:**
OAuth token was generated with insufficient scope.

**Solution:**
When generating the authorization code, use scope:
```
ZohoExpense.fullaccess.ALL
```

NOT `ZohoExpense.fullaccess.READ` (read-only won't work for receipt downloads).

---

## Zoho API Errors

### Error: `{"code": 5, "message": "Invalid URL Passed"}`

**Root Cause:**
Organization ID is in the URL path instead of the header.

**WRONG:**
```
GET https://www.zohoapis.com/expense/v1/organizations/867260975/expenses/{id}/receipt
```

**CORRECT:**
```
GET https://www.zohoapis.com/expense/v1/expenses/{id}/receipt
Headers:
  Authorization: Zoho-oauthtoken {access_token}
  X-com-zoho-expense-organizationid: 867260975
```

**Fix Location:** `supabase/functions/receive-zoho-webhook/index.ts` lines 90-100

---

### Error: HTTP 404 from receipt endpoint

**Root Cause:**
No receipt attached to the expense in Zoho.

**This is normal** - not all expenses have receipts. The Edge Function handles this gracefully by setting `receipt_storage_path = null`.

Lambda will flag these expenses for human review.

---

## Supabase Storage Errors

### Error: `mime type image/jpeg;charset=UTF-8 is not supported`

**Root Cause:**
Zoho returns content-type with charset suffix: `image/jpeg;charset=UTF-8`
Supabase Storage only accepts: `image/jpeg`

**Solution:**
Strip the charset suffix before uploading:
```typescript
const rawContentType = response.headers.get('content-type') || 'image/jpeg'
const contentType = rawContentType.split(';')[0].trim()
```

**Fix Location:** `supabase/functions/receive-zoho-webhook/index.ts` lines 113-115

---

### Error: `Storage upload failed: bucket not found`

**Root Cause:**
The `expense-receipts` bucket doesn't exist.

**Solution:**
1. Supabase Dashboard → Storage
2. Create bucket named `expense-receipts`
3. Set to private (service role access only)

---

## Receipt Fetch Failures

### Symptom: "SYSTEM FAILURE: Receipt not fetched from Zoho API"

This is a Lambda error message indicating no receipt was available when processing.

**Diagnostic Steps:**

1. **Check Edge Function logs** (Supabase Dashboard → Edge Functions → Logs)
   - Look for: `Fetching receipt for expense...`
   - If missing: Edge Function may have crashed before receipt fetch

2. **Check receipt_storage_path in database:**
```sql
SELECT zoho_expense_id, receipt_storage_path, status, flag_reason
FROM zoho_expenses
WHERE zoho_expense_id = 'YOUR_EXPENSE_ID';
```

3. **If receipt_storage_path is NULL:**
   - Could be Zoho OAuth issue (check for "invalid_code" in logs)
   - Could be missing receipt in Zoho
   - Could be API URL format issue

4. **Verify Zoho credentials:**
```bash
# Test token refresh
curl -X POST "https://accounts.zoho.com/oauth/v2/token" \
  -d "client_id=YOUR_CLIENT_ID" \
  -d "client_secret=YOUR_CLIENT_SECRET" \
  -d "grant_type=refresh_token" \
  -d "refresh_token=YOUR_REFRESH_TOKEN"

# Test receipt download (use access_token from above)
curl -X GET "https://www.zohoapis.com/expense/v1/expenses/YOUR_EXPENSE_ID/receipt" \
  -H "Authorization: Zoho-oauthtoken ACCESS_TOKEN" \
  -H "X-com-zoho-expense-organizationid: 867260975" \
  -o test_receipt.jpg
```

---

## Lambda Issues

### Symptom: Expenses stuck in "pending" status

**Root Cause Options:**

1. **pg_net trigger not firing**
   - Check that `trigger_queue_on_insert` exists on `zoho_expenses`
   - Verify `process_expense_queue()` function exists

2. **Lambda endpoint unreachable**
   - Check AWS API Gateway is up
   - Verify API key is correct in database function

3. **Lambda function erroring**
   - Check CloudWatch Logs: `/aws/lambda/process-expense`

**Diagnostic Query:**
```sql
-- Check recent pending expenses
SELECT id, zoho_expense_id, status, created_at, flag_reason
FROM zoho_expenses
WHERE status = 'pending'
ORDER BY created_at DESC
LIMIT 10;
```

---

### Symptom: Lambda processes but flags everything

**Check these common causes:**

1. **No matching bank transaction**
   - Lambda requires a matching bank feed entry within ±3 days and amount tolerance
   - Import bank transactions if missing

2. **AI confidence too low**
   - Check Lambda logs for confidence scores
   - Scores < 95% route to human review

3. **Missing category mapping**
   - Verify `qbo_accounts` table has mapping for the expense category

---

## Database Issues

### Query: Find recent failures
```sql
SELECT zoho_expense_id, merchant_name, amount, status,
       flag_reason, receipt_storage_path
FROM zoho_expenses
WHERE status = 'flagged'
ORDER BY created_at DESC
LIMIT 20;
```

### Query: Check receipt storage
```sql
SELECT zoho_expense_id,
       receipt_storage_path IS NOT NULL as has_receipt,
       receipt_content_type,
       status
FROM zoho_expenses
ORDER BY created_at DESC
LIMIT 20;
```

### Query: Verify bank transaction matches
```sql
SELECT ze.zoho_expense_id, ze.merchant_name, ze.amount,
       bt.description, bt.amount as bank_amount
FROM zoho_expenses ze
LEFT JOIN bank_transactions bt ON ze.bank_transaction_id = bt.id
WHERE ze.created_at > NOW() - INTERVAL '7 days';
```

---

## Monitoring Checklist

**Daily:**
- [ ] Check flagged expenses in Exception Dashboard
- [ ] Review Lambda CloudWatch logs for errors

**Weekly:**
- [ ] Verify Zoho refresh token still works
- [ ] Check bank transaction import is current
- [ ] Review pg_net trigger execution

**After Issues:**
- [ ] Check Edge Function logs first
- [ ] Then Lambda logs
- [ ] Then database state

---

## Credential Locations

| Credential | Location |
|------------|----------|
| Zoho OAuth | Supabase Dashboard → Edge Functions → Secrets |
| QBO OAuth | AWS Secrets Manager → `as3-bookkeeper/prod` |
| Lambda API Key | Stored in Supabase `process_expense_queue()` function |

---

*Document created: December 31, 2025 - After resolving multiple production issues*
