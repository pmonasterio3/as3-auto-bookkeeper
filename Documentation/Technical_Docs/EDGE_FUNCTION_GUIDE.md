# Edge Function Guide: receive-zoho-webhook

**Version:** 1.0 | **Updated:** December 31, 2025

---

## Overview

The `receive-zoho-webhook` Edge Function is the entry point for all expense processing. It receives webhooks from Zoho Expense, fetches receipt images, and stores everything in Supabase.

---

## File Location

```
supabase/functions/receive-zoho-webhook/index.ts
```

**Important:** This is a SINGLE FILE deployment. All code must be in `index.ts` because Supabase Dashboard deployment only supports single files.

---

## Required Secrets

Configure in: **Supabase Dashboard → Project Settings → Edge Functions → Secrets**

| Secret | Example Value | How to Get |
|--------|---------------|------------|
| `ZOHO_CLIENT_ID` | `1000.ABC123...` | Zoho API Console → Self Client |
| `ZOHO_CLIENT_SECRET` | `48bcb421b42cc...` | Zoho API Console → Self Client |
| `ZOHO_REFRESH_TOKEN` | `1000.xyz789...` | See "Generating Refresh Token" below |
| `ZOHO_ORGANIZATION_ID` | `867260975` | Zoho Expense → Admin → Organization ID |
| `SUPABASE_URL` | `https://xxx.supabase.co` | Auto-provided |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJhbGci...` | Auto-provided |

---

## Zoho OAuth Setup

### Understanding Zoho OAuth

Zoho uses OAuth 2.0 with refresh tokens:

1. **Refresh Token** - Long-lived (doesn't expire unless revoked)
2. **Access Token** - Short-lived (1 hour), generated from refresh token
3. **Authorization Code** - Very short-lived (3-10 minutes), used ONCE to get refresh token

### Generating a New Refresh Token

**When to do this:**
- First-time setup
- Getting `invalid_code` error
- Changing OAuth scopes

**Steps:**

1. Go to https://api-console.zoho.com/
2. Select your **Self Client**
3. Go to **Generate Code** tab
4. Enter scope: `ZohoExpense.fullaccess.ALL`
5. Click **CREATE**
6. Copy the code IMMEDIATELY (expires in 3-10 minutes!)

7. Run this curl command within 3 minutes:
```bash
curl -X POST "https://accounts.zoho.com/oauth/v2/token" \
  -d "client_id=YOUR_CLIENT_ID" \
  -d "client_secret=YOUR_CLIENT_SECRET" \
  -d "grant_type=authorization_code" \
  -d "code=PASTE_CODE_HERE"
```

8. Response contains your `refresh_token`:
```json
{
  "access_token": "1000.abc...",
  "refresh_token": "1000.xyz...",   <-- SAVE THIS
  "scope": "ZohoExpense.fullaccess.READ",
  "api_domain": "https://www.zohoapis.com",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

9. Update `ZOHO_REFRESH_TOKEN` in Supabase secrets

### Testing the Refresh Token

```bash
curl -X POST "https://accounts.zoho.com/oauth/v2/token" \
  -d "client_id=YOUR_CLIENT_ID" \
  -d "client_secret=YOUR_CLIENT_SECRET" \
  -d "grant_type=refresh_token" \
  -d "refresh_token=YOUR_REFRESH_TOKEN"
```

Should return a new `access_token`. If you get `invalid_code`, the refresh token is bad and you need to generate a new one.

---

## Zoho Receipt API

### Correct URL Format

```
GET https://www.zohoapis.com/expense/v1/expenses/{expense_id}/receipt
Headers:
  Authorization: Zoho-oauthtoken {access_token}
  X-com-zoho-expense-organizationid: {org_id}
```

### WRONG URL Format (Common Mistake)

```
# WRONG - org ID should NOT be in URL path
GET https://www.zohoapis.com/expense/v1/organizations/{org_id}/expenses/{expense_id}/receipt
```

### Content-Type Gotcha

Zoho returns: `image/jpeg;charset=UTF-8`
Supabase Storage accepts: `image/jpeg`

**Solution:** Strip the charset suffix:
```typescript
const rawContentType = response.headers.get('content-type') || 'image/jpeg'
const contentType = rawContentType.split(';')[0].trim()
```

---

## Webhook Payload Structure

Zoho sends:
```json
{
  "expense_report": {
    "report_id": "5647323000001105255",
    "report_name": "ER-00123",
    "expenses": [
      {
        "expense_id": "5647323000001110005",
        "date": "2025-11-06",
        "total": 22.98,
        "merchant_name": "Oliver's Markets",
        "category_name": "Travel - Employee Meals",
        "line_items": [
          {
            "tags": [
              {
                "tag_name": "Course Location",
                "tag_option_name": "California"
              }
            ]
          }
        ],
        "documents": [
          {
            "document_id": "5647323000001110011",
            "file_name": "receipt.jpg"
          }
        ]
      }
    ]
  }
}
```

---

## Deployment

### Via Supabase Dashboard (Recommended)

1. Go to: **Supabase Dashboard → Edge Functions → receive-zoho-webhook**
2. Click **Edit**
3. Replace all code with contents of `index.ts`
4. Click **Save**

### Via CLI (if configured)

```bash
supabase functions deploy receive-zoho-webhook
```

---

## Viewing Logs

1. **Supabase Dashboard → Edge Functions → receive-zoho-webhook → Logs**
2. Filter by time range
3. Look for:
   - `Received Zoho webhook at...` - Webhook received
   - `Fetching receipt from Zoho...` - API call starting
   - `Fetched receipt: X bytes` - Receipt downloaded
   - `Receipt uploaded successfully` - Stored in Supabase
   - `Expense X inserted with ID Y` - Database insert success

---

## Common Errors & Solutions

### "Zoho OAuth error: invalid_code"
**Cause:** Refresh token is expired or invalid
**Fix:** Generate a new refresh token (see above)

### "mime type image/jpeg;charset=UTF-8 is not supported"
**Cause:** Supabase Storage doesn't accept charset suffix
**Fix:** Strip charset from content-type before upload

### "Invalid URL Passed" from Zoho
**Cause:** Organization ID in URL path instead of header
**Fix:** Use header `X-com-zoho-expense-organizationid`

### "You are not authorized"
**Cause:** OAuth token lacks required scope
**Fix:** Regenerate refresh token with scope `ZohoExpense.fullaccess.ALL`

### "Storage upload failed"
**Cause:** Various - check specific error
**Common fixes:**
- Ensure `expense-receipts` bucket exists
- Verify service role key is correct
- Check file size limits

---

## Testing the Edge Function

### Manual Test with curl

```bash
curl -X POST "https://YOUR_PROJECT.supabase.co/functions/v1/receive-zoho-webhook" \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "expense_report": {
      "report_id": "test123",
      "expenses": [{
        "expense_id": "5647323000001110005",
        "date": "2025-12-31",
        "total": 10.00,
        "merchant_name": "Test Merchant"
      }]
    }
  }'
```

### Resend from Zoho

1. Zoho Expense → Reports → Find approved report
2. Click **...** menu → **Resend Webhook**

---

*Document created: December 31, 2025*
