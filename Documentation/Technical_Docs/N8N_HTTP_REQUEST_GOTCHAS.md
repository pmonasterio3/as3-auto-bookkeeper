# n8n HTTP Request Node - Common Gotchas and Solutions

**Created:** December 27, 2025
**Purpose:** Document hard-won lessons from n8n HTTP Request node issues

---

## Critical Gotcha #1: HTTP Method Defaults to GET

### Problem
When you create an HTTP Request node and configure headers, body, etc., **the HTTP method defaults to GET if not explicitly set**. GET requests **do not send request bodies**.

### Symptoms
- Edge Function receives empty body
- Error: `Unexpected end of JSON input` at `req.json()`
- Everything looks correct in n8n (headers, body configured) but body is never sent

### Solution
**ALWAYS explicitly set the HTTP Method to POST** when sending JSON body data.

```
Method: POST  ← MUST SET THIS EXPLICITLY
URL: https://your-endpoint.com
Send Body: ON
Body Content Type: JSON
```

---

## Critical Gotcha #2: JSON Body Expression Syntax

### Problem
n8n expression syntax in JSON Body field is confusing. Multiple wrong patterns:

### WRONG Patterns
```javascript
// Double equals - WRONG
=={{ $json }}

// Object without stringify when using raw - WRONG
={{ $json }}

// Missing equals sign - WRONG
{{ $json }}
```

### CORRECT Pattern
```javascript
// When specifyBody: "json" with expression
={{ JSON.stringify($json) }}
```

### Why It Works
- `=` tells n8n this is an expression
- `{{ }}` contains the JavaScript expression
- `JSON.stringify($json)` converts the JavaScript object to a JSON string
- The HTTP Request node sends this string as the request body

---

## Critical Gotcha #3: Supabase Edge Function Authentication

### Problem
Supabase Edge Functions have JWT verification ON by default. Using wrong keys results in `Invalid JWT` errors.

### Key Types (KNOW THE DIFFERENCE)

| Key Type | Format | Use For |
|----------|--------|---------|
| **Legacy Anon Key** | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` | `apikey` header |
| **Legacy Service Role Key** | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` | `Authorization: Bearer` header |
| **New Publishable Key** | `sb_publishable_...` | NOT for Edge Functions with JWT |
| **New Secret Key** | `sb_secret_...` | NOT for Edge Functions with JWT |

### Correct Headers for Edge Function
```
Authorization: Bearer <service_role_key>  ← Legacy JWT format
apikey: <anon_key>                        ← Legacy JWT format
Content-Type: application/json
x-api-key: <custom_secret>                ← If function uses custom auth
```

### Where to Find Legacy Keys
Supabase Dashboard → Settings → API → Project API Keys
- `anon` `public` = Anon Key (use for apikey header)
- `service_role` `secret` = Service Role Key (use for Authorization header)

---

## Critical Gotcha #4: n8n Data References After Supabase Nodes

### Problem
After a Supabase Update/Insert node executes, `$input.first().json` contains only the Supabase response (confirmation), NOT the original expense data.

### Symptoms
- Data disappears after Supabase operations
- Code nodes can't access expense fields that were available earlier
- Undefined errors when accessing `$json.expense_id` after update

### Solution
Reference the original data source explicitly:

```javascript
// WRONG - After Supabase update, $input only has update confirmation
const expense = $input.first().json;  // Contains { count: 1 } or similar

// CORRECT - Reference the original node by name
const expense = $('Edit Fields').first().json;
const qboData = $('Process QBO Accounts').first().json;
const receiptBinary = $('Fetch Receipt').first()?.binary;
```

---

## Critical Gotcha #5: Binary Data Preservation in Code Nodes

### Problem
When a Code node processes data with binary attachments (images, files), the binary data is lost unless explicitly preserved.

### Solution
Always include binary in return object:

```javascript
const inputItem = $input.first();
const expense = inputItem.json;

return [{
  json: {
    ...expense,
    // your modifications
  },
  binary: inputItem.binary  // CRITICAL: Preserve binary data
}];
```

---

## Quick Reference: Working HTTP Request to Edge Function

### Node Configuration
```
Name: Create Monday Subitem
Method: POST                          ← EXPLICIT, not default
URL: https://xxx.supabase.co/functions/v1/your-function

Headers:
  - Authorization: Bearer eyJhbG...   ← Service Role Key (legacy format)
  - apikey: eyJhbG...                 ← Anon Key (legacy format)
  - Content-Type: application/json
  - x-api-key: your-custom-secret     ← If function uses custom auth

Body:
  - Send Body: ON
  - Body Content Type: JSON
  - JSON Body: ={{ JSON.stringify($json) }}
```

### Preceding Code Node (Prepare Data)
```javascript
const expense = $input.first().json;

return [{
  json: {
    parent_item_id: String(expense.monday_revenue_item_id),
    item_name: expense.merchant_name || 'Expense',
    concept: expense.category_name || '',
    date: expense.date || null,
    amount: expense.amount || 0
  }
}];
```

---

## Debugging Checklist

When an HTTP Request to Edge Function fails:

- [ ] Is HTTP Method set to POST (not GET)?
- [ ] Is JSON Body using `={{ JSON.stringify($json) }}`?
- [ ] Are you using legacy JWT keys (eyJhbG...) not new format (sb_...)?
- [ ] Is Authorization header using `Bearer ` prefix?
- [ ] Is the preceding Code node outputting correct JSON structure?
- [ ] Test Edge Function with curl first to isolate n8n issues

### Curl Test Template
```bash
curl -X POST "https://xxx.supabase.co/functions/v1/your-function" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "apikey: YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_CUSTOM_SECRET" \
  -d '{"field1": "value1", "field2": "value2"}'
```

---

## Related Documentation

- `N8N_MONDAY_SUBITEM_FAILED_APPROACHES.md` - GraphQL escaping issues
- `N8N_SIMPLIFICATION_GUIDE.md` - Memory optimization
- `N8N_WORKFLOW_REBUILD_GUIDE.md` - Queue architecture

---

*Last Updated: December 27, 2025*
