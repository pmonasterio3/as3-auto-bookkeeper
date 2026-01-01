# Agent 1 Complete Fix - December 29, 2025

**ROOT CAUSE FOUND: n8n HTTP Request Tool + $fromAI() is broken**

## Research Summary

| Finding | Source |
|---------|--------|
| `$fromAI()` doesn't work with HTTP Request Tool | [GitHub Issue #14274](https://github.com/n8n-io/n8n/issues/14274) |
| HTTP Request Tool doesn't pass binary to AI | [n8n Community](https://community.n8n.io/t/using-binaries-with-ai-agents/53128) |
| Must fetch image BEFORE AI Agent, pass as input | [n8n Community](https://community.n8n.io/t/how-to-pass-image-url-in-n8n-agent/112565) |

---

## The Problem

The Fetch Receipt Tool uses `$fromAI('receipt_path')` in the URL, but:

1. **n8n confirms this is broken**: "the HTTP Request Tool node doesn't support `$fromAI` syntax yet"
2. **Even if it worked, binary data doesn't pass back to AI** - known limitation
3. The AI says "Receipt image could not be fetched" because the tool never actually works

---

## The Solution

### Option A: Use Edge Function (Returns Base64 JSON - AI can read this)

**Step 1: Deploy the fetch-receipt edge function**

```bash
cd as3-auto-bookkeeper
npx supabase login
npx supabase functions deploy fetch-receipt --no-verify-jwt
```

**Step 2: Update Fetch Receipt Tool in n8n**

Change URL from:
```
=https://fzwozzqwyzztadxgjryl.supabase.co/storage/v1/object/expense-receipts/{{ $fromAI('receipt_path') }}
```

To:
```
=https://fzwozzqwyzztadxgjryl.supabase.co/functions/v1/fetch-receipt?path={{ $fromAI('receipt_path', 'The receipt_storage_path from the expense data', 'string') }}
```

**Step 3: Change Response Format**

In Fetch Receipt Tool options:
- Response Format: **JSON** (not File)

The edge function returns:
```json
{
  "success": true,
  "content_type": "image/jpeg",
  "data_url": "data:image/jpeg;base64,/9j/4AAQ..."
}
```

The AI can read `data_url` and analyze the image!

---

### Option B: Restructure Workflow (More Reliable)

Instead of using a tool, fetch the receipt BEFORE the AI Agent runs:

**Current flow (broken):**
```
Filter Monday → AI Agent (tries to use Fetch Receipt Tool - FAILS)
```

**Fixed flow:**
```
Filter Monday → Fetch Receipt from Storage → AI Agent (receives binary)
```

**Steps:**

1. Add new HTTP Request node "Fetch Receipt from Storage" BETWEEN Filter Monday and AI Agent

2. Configure it:
   - URL: `https://fzwozzqwyzztadxgjryl.supabase.co/functions/v1/fetch-receipt?path={{ $json.receipt_storage_path }}`
   - Method: GET
   - Response Format: JSON

3. Update AI Agent input to include the base64 image:
   - In the AI Agent text prompt, add:
   ```
   Receipt Image (base64): {{ $json.data_url || 'NO RECEIPT' }}
   ```

4. Remove or disable the Fetch Receipt Tool (it won't work anyway)

---

## FIX 2: Query Vendor Apostrophe Fix (Still Needed)

Change the query parameter from:
```
=SELECT * FROM Vendor WHERE DisplayName LIKE '%{{ $('Parse AI Decision').first().json.merchant_name_for_qbo }}%'
```

To:
```
=SELECT * FROM Vendor WHERE DisplayName LIKE '%{{ $('Parse AI Decision').first().json.merchant_name_for_qbo.replace(/'/g, "").replace(/'/g, "") }}%'
```

---

## What's Already Correct

| Node | Status |
|------|--------|
| Calculate Date Range | ±15 days |
| Match Bank Transaction | Uses `bank.amount` |
| AI Agent passthroughBinaryImages | true |

---

## Deployment Checklist

- [ ] Deploy `fetch-receipt` edge function (run `npx supabase functions deploy fetch-receipt --no-verify-jwt`)
- [ ] Update Fetch Receipt Tool URL to use edge function
- [ ] Change Fetch Receipt Tool response format to JSON
- [ ] Update Query Vendor with apostrophe fix
- [ ] Save workflow
- [ ] Test with one expense

---

## Why This Will Work

1. **Edge function uses service role key internally** - no auth issues
2. **Returns base64 JSON** - AI can read text, doesn't need binary handling
3. **$fromAI with description** - gives AI context about what to pass
4. **Apostrophe fix** - prevents QBO query errors

---

## Sources

- [n8n $fromAI Documentation](https://docs.n8n.io/advanced-ai/examples/using-the-fromai-function/)
- [GitHub Issue #14274 - HTTP Request Tool + $fromAI broken](https://github.com/n8n-io/n8n/issues/14274)
- [n8n Community - Binary with AI Agents](https://community.n8n.io/t/using-binaries-with-ai-agents/53128)
- [n8n Community - Pass Image to Agent](https://community.n8n.io/t/how-to-pass-image-url-in-n8n-agent/112565)
