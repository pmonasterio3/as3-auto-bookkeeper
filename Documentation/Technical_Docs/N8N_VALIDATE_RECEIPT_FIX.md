# n8n Workflow Fix: Call validate-receipt After Upload

**Version:** 1.0
**Created:** December 28, 2025
**Status:** ⚠️ OBSOLETE - SUPERSEDED BY N8N_AI_RECEIPT_TOOL_FIX.md ⚠️

> **DO NOT USE THIS APPROACH.** The Edge Function receipt validation approach has been abandoned.
> The AI Agent's core purpose is to analyze receipts - moving validation to an Edge Function
> defeats this purpose. See `N8N_AI_RECEIPT_TOOL_FIX.md` for the correct architecture.

---

## The Problem

Expenses are failing with "no_receipt_attached" even when receipts exist because:

1. **receive-zoho-webhook** no longer calls validate-receipt (broken download_url logic was removed)
2. **n8n workflow** fetches receipt from Zoho, uploads to Storage, but never calls validate-receipt
3. **n8n reads stale validation** records that say "No receipt attached"

---

## The Fix

Add an HTTP Request node that calls validate-receipt **AFTER** the receipt is uploaded to Storage.

### Workflow Location

Insert **between** "Update Receipt Path" and "Edit Fields":

```
[Fetch Receipt from Zoho] → [Update Receipt Path] → [Call Validate Receipt] → [Edit Fields] → ...
```

---

## Node Configuration: Call Validate Receipt

### HTTP Request Node Settings

| Setting | Value |
|---------|-------|
| **Name** | Call Validate Receipt |
| **Method** | POST |
| **URL** | `https://fzwozzqwyzztadxgjryl.supabase.co/functions/v1/validate-receipt` |
| **Authentication** | None (headers below handle auth) |

### Headers (Add All 3)

| Header | Value |
|--------|-------|
| `Content-Type` | `application/json` |
| `Authorization` | `Bearer [SERVICE_ROLE_KEY]` |
| `apikey` | `[SERVICE_ROLE_KEY]` |

**IMPORTANT:** Use the legacy JWT service role key (starts with `eyJhbG...`), NOT `sb_publishable_...`

### Body

**Send Body:** Yes
**Body Content Type:** JSON
**Specify Body:** Using Fields Below (or raw JSON)

**Raw JSON Expression:**
```
={{ JSON.stringify({ "expense_id": $json.id }) }}
```

Or using fields:
- Parameter Name: `expense_id`
- Parameter Value: `{{ $json.id }}`

---

## Expected Response

```json
{
  "success": true,
  "expense_id": "14d8628e-4c19-4ce8-9ba1-381e146b8d50",
  "validation_id": "abc123...",
  "validation": {
    "merchant_extracted": "Roboflow, Inc.",
    "amount_extracted": 65.00,
    "amounts_match": true,
    "merchant_match": true,
    "confidence": 98,
    "issues": []
  },
  "duration_ms": 3500
}
```

---

## Update Edit Fields Node

After adding the validate-receipt call, update "Edit Fields" to include validation data:

```javascript
const inputItem = $input.first();
const expense = $('Update Receipt Path').first().json;
const validation = inputItem.json;  // From Call Validate Receipt

return [{
  json: {
    ...expense,
    receipt_validation: validation.validation || null,
    validation_confidence: validation.validation?.confidence || 0
  }
}];
```

---

## Remove: Fetch Receipt Validation Node

If there's a node that tries to read old validation from the database, **DELETE IT**.

The validation is now returned directly from the Edge Function call.

---

## Alternative: Wait Node

If the Edge Function takes too long (>30 seconds), you may need to:

1. Add a "Wait" node after the HTTP Request (5 seconds)
2. Then add a "Fetch Receipt Validation" Supabase node to read the result from the database

But typically the Edge Function returns within 3-5 seconds.

---

## Testing

1. Reset an expense:
   ```sql
   UPDATE zoho_expenses
   SET status = 'pending', processing_attempts = 0
   WHERE id = '14d8628e-4c19-4ce8-9ba1-381e146b8d50';
   ```

2. Trigger the queue controller:
   ```sql
   SELECT process_expense_queue();
   ```

3. Watch n8n execution - verify:
   - Receipt uploaded to Storage
   - validate-receipt called successfully
   - Validation data used in downstream processing

---

## Quick Reference: Edge Function Behavior

The `validate-receipt` Edge Function:

1. Receives `{ expense_id: UUID }`
2. Fetches expense from `zoho_expenses` table
3. Gets `receipt_storage_path` from expense
4. Creates signed URL from Supabase Storage (1-hour expiry)
5. Sends URL to Claude API (Claude fetches image directly - no binary in memory)
6. Claude analyzes receipt, returns JSON
7. Stores result in `receipt_validations` table
8. Updates `zoho_expenses.receipt_validated = true`
9. Returns validation result to caller

**Key:** Claude fetches the image from the URL. No binary data flows through the Edge Function or n8n.

---

*End of Fix Document*
