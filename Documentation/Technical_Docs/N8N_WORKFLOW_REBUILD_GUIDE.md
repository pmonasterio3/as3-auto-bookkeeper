# n8n Workflow Rebuild Guide: Queue-Based Single-Expense Processing

**Version:** 1.0
**Created:** December 11, 2025
**For:** Pablo Ortiz-Monasterio
**Workflow ID:** ZZPC3jm6mXbLrp3u (to be rebuilt)

---

## Pre-Requisites (Must Be Done First)

Before rebuilding the n8n workflow, these database components must exist:

1. **`zoho_expenses` table** - Stores incoming expenses from Edge Function
2. **`process_expense_queue()` function** - Claims expenses and calls n8n
3. **Database triggers** - Fires on INSERT and status UPDATE
4. **`expense-receipts` Storage bucket** - Holds receipt images
5. **Edge Function** - Receives Zoho webhook and stores expenses

**You will complete these AFTER the n8n workflow is ready.**

---

## Step-by-Step Workflow Rebuild

### Overview: 18 Nodes Total

```
1. Webhook Trigger ─────────────────────────────────────────────┐
2. Fetch Expense from DB                                        │
3. IF Status = Processing ─── NO ─── Exit: Already Processed    │
   │ YES                                                        │
4. Fetch Receipt from Storage                                   │
5. IF Category Contains "- COS" ─── YES ─── 6. Fetch Monday ────┤
   │ NO                                                         │
   ├────────────────────────────────────────────────────────────┤
7. Merge (combines paths)                                       │
8. Fetch Bank Transactions ───┐                                 │
9. Fetch QBO Accounts ────────┼─── (Parallel)                   │
10. Fetch QBO Classes ────────┘                                 │
11. Merge Reference Data                                        │
12. AI Agent (Claude)                                           │
13. IF Match Found ─── NO ─── 18. Flag for Review ─── Update ───┘
    │ YES
14. IF Confidence >= 95% ─── NO ─── 18. Flag for Review ────────┘
    │ YES
15. Lookup/Create QBO Vendor                                    │
16. Create QBO Purchase                                         │
17. Upload Receipt to QBO (if exists)                           │
    │                                                           │
    ├─── Update Bank Transaction                                │
    └─── Update Expense Status (SUCCESS) ───────────────────────┘

Error Handler (catches all errors) ─── Update Status = Error ───┘
```

---

## Node 1: Webhook Trigger

**Action:** Create new webhook trigger

1. Add node: **Webhook**
2. Configure:
   - **HTTP Method:** POST
   - **Path:** `process-expense`
   - **Authentication:** None (internal use only)
   - **Response Mode:** Using 'Respond to Webhook' node

**Test URL will be:** `https://as3driving.app.n8n.cloud/webhook/process-expense`

**Expected incoming payload:**
```json
{
  "expense_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

---

## Node 2: Fetch Expense

**Action:** Query Supabase for the expense record

1. Add node: **Supabase**
2. Configure:
   - **Credential:** Your Supabase credential
   - **Operation:** Get Many Rows
   - **Table:** `zoho_expenses`
   - **Return All:** OFF
   - **Limit:** 1
   - **Filters:**
     - Field: `id`
     - Condition: `equals`
     - Value: `{{ $json.body.expense_id }}`

**Connect:** Webhook Trigger → Fetch Expense

---

## Node 3: IF Status = Processing

**Action:** Verify expense is still in 'processing' state (prevents duplicates)

1. Add node: **IF**
2. Configure:
   - **Conditions:** String
   - **Value 1:** `{{ $json.status }}`
   - **Operation:** Equals
   - **Value 2:** `processing`

**True branch:** Continue to Fetch Receipt
**False branch:** Connect to "Exit: Already Processed" node (No Operation)

**Connect:** Fetch Expense → IF Status = Processing

---

## Node 4: Fetch Receipt from Storage

**Action:** Download receipt image from Supabase Storage

1. Add node: **HTTP Request**
2. Configure:
   - **Method:** GET
   - **URL:** `{{ $env.SUPABASE_URL }}/storage/v1/object/expense-receipts/{{ $json.receipt_storage_path }}`
   - **Authentication:** Predefined Credential Type
   - **Credential Type:** Header Auth
   - **Name:** `Authorization`
   - **Value:** `Bearer {{ $env.SUPABASE_SERVICE_KEY }}`
   - **Response Format:** File
   - **Put Output in Field:** `data`

**Alternative using Supabase node (if available):**
- Operation: Download
- Bucket: `expense-receipts`
- File Path: `{{ $json.receipt_storage_path }}`

**Connect:** IF Status = Processing (True) → Fetch Receipt

---

## Node 5: IF is COS

**Action:** Check if this is a Cost of Sales expense (needs Monday event)

1. Add node: **IF**
2. Configure:
   - **Conditions:** String
   - **Value 1:** `{{ $json.category_name }}`
   - **Operation:** Contains
   - **Value 2:** `- COS`

**True branch:** Fetch Monday Event
**False branch:** Add Empty Monday (skip Monday lookup)

**Connect:** Fetch Receipt → IF is COS

---

## Node 6: Fetch Monday Event (COS Only)

**Action:** Query Monday.com for events overlapping expense date

1. Add node: **HTTP Request**
2. Configure:
   - **Method:** POST
   - **URL:** `https://api.monday.com/v2`
   - **Authentication:** Header Auth
   - **Header Name:** `Authorization`
   - **Header Value:** `{{ $env.MONDAY_API_KEY }}`
   - **Body Content Type:** JSON
   - **Body:**
```json
{
  "query": "query { boards(ids: [8294758830]) { items_page(limit: 100) { items { id name column_values { id text value } } } } }"
}
```

3. Add node: **Code** (Filter Monday Events)
   - Name: `Filter Monday Event`
```javascript
const expense = $('Fetch Expense').first().json;
const expenseDate = new Date(expense.expense_date);
const mondayData = $input.first().json;

// Parse Monday items
const items = mondayData.data?.boards?.[0]?.items_page?.items || [];

// Find event where expense_date is between start_date and end_date
let matchedEvent = null;

for (const item of items) {
  const columns = {};
  for (const col of item.column_values) {
    columns[col.id] = col.text || col.value;
  }

  // Adjust these column IDs to match your Monday board
  const startDate = columns['date4'] ? new Date(columns['date4']) : null;
  const endDate = columns['date'] ? new Date(columns['date']) : null;
  const venue = columns['text'] || '';
  const state = columns['status'] || '';

  if (startDate && endDate && expenseDate >= startDate && expenseDate <= endDate) {
    matchedEvent = {
      monday_item_id: item.id,
      event_name: item.name,
      venue: venue,
      state: state
    };
    break;
  }
}

return [{
  json: {
    ...expense,
    monday_event: matchedEvent
  },
  binary: $('Fetch Receipt').first().binary
}];
```

**Connect:** IF is COS (True) → HTTP Request Monday → Filter Monday Event

---

## Node 6b: Add Empty Monday (Non-COS Path)

**Action:** For non-COS expenses, add null monday_event

1. Add node: **Code**
   - Name: `Add Empty Monday`
```javascript
const expense = $('Fetch Expense').first().json;

return [{
  json: {
    ...expense,
    monday_event: null
  },
  binary: $('Fetch Receipt').first().binary
}];
```

**Connect:** IF is COS (False) → Add Empty Monday

---

## Node 7: Merge Paths

**Action:** Merge COS and Non-COS paths back together

1. Add node: **Merge**
2. Configure:
   - **Mode:** Combine
   - **Combination Mode:** Merge By Position
   - **Options:** (leave default)

**Connect:**
- Filter Monday Event → Merge
- Add Empty Monday → Merge

---

## Node 8-10: Fetch Reference Data (Parallel)

**Action:** Fetch bank transactions, QBO accounts, and QBO classes in parallel

### Node 8: Fetch Bank Transactions

1. Add node: **Supabase**
   - Name: `Fetch Bank Transactions`
2. Configure:
   - **Operation:** Get Many Rows
   - **Table:** `bank_transactions`
   - **Return All:** ON
   - **Filters:**
     - Filter 1: `status` equals `unmatched`
     - Filter 2: `transaction_date` >= `{{ DateTime.fromISO($json.expense_date).minus({days: 3}).toISODate() }}`
     - Filter 3: `transaction_date` <= `{{ DateTime.fromISO($json.expense_date).plus({days: 3}).toISODate() }}`

### Node 9: Fetch QBO Accounts

1. Add node: **Supabase**
   - Name: `Fetch QBO Accounts`
2. Configure:
   - **Operation:** Get Many Rows
   - **Table:** `qbo_accounts`
   - **Return All:** ON

### Node 10: Fetch QBO Classes

1. Add node: **Supabase**
   - Name: `Fetch QBO Classes`
2. Configure:
   - **Operation:** Get Many Rows
   - **Table:** `qbo_classes`
   - **Return All:** ON

**Connect:** Merge → (all three in parallel):
- Merge → Fetch Bank Transactions
- Merge → Fetch QBO Accounts
- Merge → Fetch QBO Classes

---

## Node 11: Merge Reference Data

**Action:** Combine all reference data into single object

1. Add node: **Code**
   - Name: `Merge Reference Data`
```javascript
const expense = $('Merge').first().json;
const binary = $('Merge').first().binary;

const bankTransactions = $('Fetch Bank Transactions').all().map(item => item.json);
const qboAccounts = $('Fetch QBO Accounts').all().map(item => item.json);
const qboClasses = $('Fetch QBO Classes').all().map(item => item.json);

return [{
  json: {
    expense: expense,
    reference_data: {
      bank_transactions: bankTransactions,
      qbo_accounts: qboAccounts,
      qbo_classes: qboClasses
    },
    monday_event: expense.monday_event
  },
  binary: binary
}];
```

**Connect:**
- Fetch Bank Transactions → Merge Reference Data
- Fetch QBO Accounts → Merge Reference Data
- Fetch QBO Classes → Merge Reference Data

---

## Node 12: AI Agent

**Action:** Use Claude to analyze expense and find bank match

1. Add node: **AI Agent** (from @n8n/n8n-nodes-langchain)
2. Configure:
   - **Model:** Anthropic Claude (claude-3-5-sonnet-20241022 or claude-sonnet-4-5-20250514)
   - **System Message:** (leave empty, use prompt below)
   - **Prompt Type:** Define Below
   - **Text:** (see full prompt below)
   - **Options:**
     - **Max Iterations:** 6
     - **Return Intermediate Steps:** OFF
     - **Passthrough Binary Images:** ON

**AI Prompt:**
```
You are Agent 1: Expense Matcher for AS3 Driver Training.

## YOUR TASK
Match the expense to a bank transaction and determine QBO categorization.

## INPUT DATA

### Expense:
- ID: {{ $json.expense.id }}
- Zoho ID: {{ $json.expense.zoho_expense_id }}
- Amount: ${{ $json.expense.amount }}
- Merchant: {{ $json.expense.merchant_name }}
- Date: {{ $json.expense.expense_date }}
- Category: {{ $json.expense.category_name }}
- State Tag: {{ $json.expense.state_tag }}
- Paid Through: {{ $json.expense.paid_through }}

### Receipt Image:
Attached as binary. Verify amount and merchant.

### Bank Transactions (unmatched, ±3 days):
{{ JSON.stringify($json.reference_data.bank_transactions, null, 2) }}

### QBO Accounts:
{{ JSON.stringify($json.reference_data.qbo_accounts, null, 2) }}

### QBO Classes (for state):
{{ JSON.stringify($json.reference_data.qbo_classes, null, 2) }}

### Monday Event (if COS):
{{ $json.monday_event ? JSON.stringify($json.monday_event, null, 2) : 'Not applicable' }}

## MATCHING RULES

1. **Amount Match:** Must be within $0.50
2. **Date Match:** Within ±3 days
3. **Vendor Match:** Description should contain similar merchant name

## STATE DETERMINATION

- COS expenses: Use monday_event.state if available, else state_tag
- Non-COS: Use state_tag
- "Other" tag = NC (North Carolina - admin state)

## QBO ACCOUNT LOOKUP

Find qbo_account where zoho_category_match contains the expense category_name.

## QBO CLASS LOOKUP

Find qbo_class where state_code matches determined state.

## CONFIDENCE SCORING

Start at 100, subtract:
- No bank match: -40
- Receipt amount mismatch (>$1): -30
- No receipt: -25
- COS without Monday event: -20
- State unclear: -20
- Category not found: -15

## OUTPUT (JSON only, no markdown)

{
  "matched_bank_txn_id": "uuid or null",
  "match_confidence": 95,
  "qbo_account_id": "35",
  "qbo_class_id": "1000000004",
  "state_code": "CA",
  "flag_reason": null,
  "receipt_verified": true
}

If confidence < 95, provide flag_reason explaining why.
```

**Connect:** Merge Reference Data → AI Agent

---

## Node 13: Parse AI Output

**Action:** Extract JSON from AI response

1. Add node: **Code**
   - Name: `Parse AI Output`
```javascript
const aiOutput = $input.first().json.output;
const expense = $('Merge Reference Data').first().json.expense;

// Parse JSON from AI response (may be wrapped in markdown)
let parsed;
try {
  // Try direct parse
  parsed = typeof aiOutput === 'string' ? JSON.parse(aiOutput) : aiOutput;
} catch (e) {
  // Try extracting from markdown code block
  const jsonMatch = aiOutput.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (jsonMatch) {
    parsed = JSON.parse(jsonMatch[1]);
  } else {
    throw new Error('Could not parse AI output: ' + aiOutput);
  }
}

return [{
  json: {
    expense_id: expense.id,
    zoho_expense_id: expense.zoho_expense_id,
    merchant_name: expense.merchant_name,
    amount: expense.amount,
    expense_date: expense.expense_date,
    category_name: expense.category_name,
    paid_through: expense.paid_through,
    receipt_storage_path: expense.receipt_storage_path,
    ...parsed
  }
}];
```

**Connect:** AI Agent → Parse AI Output

---

## Node 14: IF Match Found

**Action:** Check if AI found a bank transaction match

1. Add node: **IF**
   - Name: `IF Match Found`
2. Configure:
   - **Conditions:** Boolean
   - **Value 1:** `{{ $json.matched_bank_txn_id !== null && $json.matched_bank_txn_id !== 'null' }}`
   - **Operation:** Equals
   - **Value 2:** `true`

**True:** Continue to confidence check
**False:** Flag for Review

**Connect:** Parse AI Output → IF Match Found

---

## Node 15: IF Confidence >= 95%

**Action:** Check if confidence meets threshold

1. Add node: **IF**
   - Name: `IF Confidence >= 95`
2. Configure:
   - **Conditions:** Number
   - **Value 1:** `{{ $json.match_confidence }}`
   - **Operation:** Larger or Equal
   - **Value 2:** `95`

**True:** Continue to QBO posting
**False:** Flag for Review

**Connect:** IF Match Found (True) → IF Confidence >= 95

---

## Node 16: Lookup/Create QBO Vendor

### Node 16a: Query Vendor

1. Add node: **HTTP Request**
   - Name: `Query QBO Vendor`
2. Configure:
   - **Method:** GET
   - **URL:** `https://quickbooks.api.intuit.com/v3/company/123146088634019/query?query=SELECT * FROM Vendor WHERE DisplayName = '{{ encodeURIComponent($json.merchant_name) }}'`
   - **Authentication:** OAuth2
   - **Credential:** QuickBooks OAuth2

### Node 16b: IF Vendor Exists

1. Add node: **IF**
   - Name: `IF Vendor Exists`
2. Configure:
   - **Conditions:** Number
   - **Value 1:** `{{ $json.QueryResponse?.Vendor?.length || 0 }}`
   - **Operation:** Larger
   - **Value 2:** `0`

### Node 16c: Create Vendor (if not exists)

1. Add node: **HTTP Request**
   - Name: `Create QBO Vendor`
2. Configure:
   - **Method:** POST
   - **URL:** `https://quickbooks.api.intuit.com/v3/company/123146088634019/vendor`
   - **Authentication:** OAuth2
   - **Body Content Type:** JSON
   - **Body:**
```json
{
  "DisplayName": "{{ $json.merchant_name }}",
  "Active": true
}
```

### Node 16d: Get Vendor ID

1. Add node: **Code**
   - Name: `Get Vendor ID`
```javascript
const input = $input.first().json;
const expenseData = $('Parse AI Output').first().json;

let vendorId;

// Check if vendor already existed
if (input.QueryResponse?.Vendor?.length > 0) {
  vendorId = input.QueryResponse.Vendor[0].Id;
} else if (input.Vendor?.Id) {
  // Newly created vendor
  vendorId = input.Vendor.Id;
} else {
  throw new Error('Could not determine vendor ID');
}

return [{
  json: {
    ...expenseData,
    vendor_id: vendorId
  }
}];
```

**Connect:**
- IF Confidence >= 95 (True) → Query QBO Vendor
- Query QBO Vendor → IF Vendor Exists
- IF Vendor Exists (True) → Get Vendor ID
- IF Vendor Exists (False) → Create QBO Vendor → Get Vendor ID

---

## Node 17: Create QBO Purchase

1. Add node: **HTTP Request**
   - Name: `Create QBO Purchase`
2. Configure:
   - **Method:** POST
   - **URL:** `https://quickbooks.api.intuit.com/v3/company/123146088634019/purchase?minorversion=65`
   - **Authentication:** OAuth2
   - **Body Content Type:** JSON
   - **Body:**
```json
{
  "AccountRef": {
    "value": "={{ $json.paid_through.includes('AMEX') ? '99' : '49' }}"
  },
  "PaymentType": "={{ $json.paid_through.includes('AMEX') ? 'CreditCard' : 'Check' }}",
  "TxnDate": "={{ $json.expense_date }}",
  "EntityRef": {
    "value": "={{ $json.vendor_id }}"
  },
  "Line": [{
    "Amount": {{ $json.amount }},
    "DetailType": "AccountBasedExpenseLineDetail",
    "AccountBasedExpenseLineDetail": {
      "AccountRef": { "value": "{{ $json.qbo_account_id }}" },
      "ClassRef": { "value": "{{ $json.qbo_class_id }}" }
    }
  }],
  "PrivateNote": "Zoho: {{ $json.zoho_expense_id }}"
}
```

**Connect:** Get Vendor ID → Create QBO Purchase

---

## Node 18: Get Purchase ID

1. Add node: **Code**
   - Name: `Get Purchase ID`
```javascript
const purchase = $input.first().json;
const expenseData = $('Get Vendor ID').first().json;

return [{
  json: {
    ...expenseData,
    purchase_id: purchase.Purchase.Id
  }
}];
```

**Connect:** Create QBO Purchase → Get Purchase ID

---

## Node 19: IF Receipt Exists

**Action:** Only upload receipt if one exists

1. Add node: **IF**
   - Name: `IF Receipt Exists`
2. Configure:
   - **Conditions:** String
   - **Value 1:** `{{ $json.receipt_storage_path }}`
   - **Operation:** Is Not Empty

**True:** Upload to QBO
**False:** Skip to bank update

**Connect:** Get Purchase ID → IF Receipt Exists

---

## Node 20: Upload Receipt to QBO

1. Add node: **HTTP Request**
   - Name: `Upload Receipt to QBO`
2. Configure:
   - **Method:** POST
   - **URL:** `https://quickbooks.api.intuit.com/v3/company/123146088634019/upload?minorversion=65`
   - **Authentication:** OAuth2
   - **Body Content Type:** Multipart Form Data
   - **Body Parameters:**
     - Name: `file_metadata_01`
     - Value:
```json
{
  "AttachableRef": [{
    "EntityRef": {
      "type": "Purchase",
      "value": "{{ $json.purchase_id }}"
    }
  }],
  "FileName": "receipt_{{ $json.zoho_expense_id }}.jpg"
}
```
   - Name: `file_content_01`
   - Value: Use binary data from earlier node

**Note:** This node is tricky - you may need to use a Code node to properly format the multipart request.

**Connect:** IF Receipt Exists (True) → Upload Receipt to QBO

---

## Node 21: Update Bank Transaction

1. Add node: **Supabase**
   - Name: `Update Bank Transaction`
2. Configure:
   - **Operation:** Update Row
   - **Table:** `bank_transactions`
   - **Select Row By:** `id`
   - **Row ID:** `{{ $json.matched_bank_txn_id }}`
   - **Fields:**
     - `status`: `matched`
     - `matched_expense_id`: `{{ $json.zoho_expense_id }}`
     - `matched_at`: `{{ $now.toISO() }}`
     - `matched_by`: `agent`
     - `match_confidence`: `{{ $json.match_confidence }}`
     - `qbo_purchase_id`: `{{ $json.purchase_id }}`

**Connect:**
- IF Receipt Exists (True) → Upload Receipt → Update Bank Transaction
- IF Receipt Exists (False) → Update Bank Transaction

---

## Node 22: Update Expense Status (Success)

**CRITICAL:** This triggers the queue to process the next expense

1. Add node: **Supabase**
   - Name: `Update Expense Success`
2. Configure:
   - **Operation:** Update Row
   - **Table:** `zoho_expenses`
   - **Select Row By:** `id`
   - **Row ID:** `{{ $json.expense_id }}`
   - **Fields:**
     - `status`: `posted`
     - `bank_transaction_id`: `{{ $json.matched_bank_txn_id }}`
     - `qbo_purchase_id`: `{{ $json.purchase_id }}`
     - `qbo_posted_at`: `{{ $now.toISO() }}`
     - `match_confidence`: `{{ $json.match_confidence }}`
     - `processed_at`: `{{ $now.toISO() }}`

**Connect:** Update Bank Transaction → Update Expense Success

---

## Node 23: Respond to Webhook (Success)

1. Add node: **Respond to Webhook**
   - Name: `Success Response`
2. Configure:
   - **Response Code:** 200
   - **Response Body:**
```json
{
  "success": true,
  "expense_id": "{{ $json.expense_id }}",
  "status": "posted",
  "qbo_purchase_id": "{{ $json.purchase_id }}"
}
```

**Connect:** Update Expense Success → Success Response

---

## Node 24: Flag for Review

**Action:** Handle low confidence or no match cases

1. Add node: **Supabase**
   - Name: `Insert to Expense Queue`
2. Configure:
   - **Operation:** Insert Row
   - **Table:** `expense_queue`
   - **Fields:**
     - `zoho_expense_id`: `{{ $json.zoho_expense_id }}`
     - `vendor_name`: `{{ $json.merchant_name }}`
     - `amount`: `{{ $json.amount }}`
     - `expense_date`: `{{ $json.expense_date }}`
     - `category_suggested`: `{{ $json.category_name }}`
     - `state_suggested`: `{{ $json.state_code }}`
     - `confidence_score`: `{{ $json.match_confidence }}`
     - `flag_reason`: `{{ $json.flag_reason }}`
     - `suggested_bank_txn_id`: `{{ $json.matched_bank_txn_id }}`
     - `status`: `pending`

**Connect:**
- IF Match Found (False) → Insert to Expense Queue
- IF Confidence >= 95 (False) → Insert to Expense Queue

---

## Node 25: Update Expense Flagged

1. Add node: **Supabase**
   - Name: `Update Expense Flagged`
2. Configure:
   - **Operation:** Update Row
   - **Table:** `zoho_expenses`
   - **Select Row By:** `id`
   - **Row ID:** `{{ $json.expense_id }}`
   - **Fields:**
     - `status`: `flagged`
     - `match_confidence`: `{{ $json.match_confidence }}`
     - `last_error`: `{{ $json.flag_reason }}`
     - `processed_at`: `{{ $now.toISO() }}`

**Connect:** Insert to Expense Queue → Update Expense Flagged

---

## Node 26: Respond Flagged

1. Add node: **Respond to Webhook**
   - Name: `Flagged Response`
2. Configure:
   - **Response Code:** 200
   - **Response Body:**
```json
{
  "success": true,
  "expense_id": "{{ $json.expense_id }}",
  "status": "flagged",
  "flag_reason": "{{ $json.flag_reason }}"
}
```

**Connect:** Update Expense Flagged → Flagged Response

---

## Error Handler Setup

1. Click on workflow settings (gear icon)
2. Enable **Error Workflow**
3. Create error handling path:

### Error Handler Nodes

#### Error Trigger
1. Add node: **Error Trigger**

#### Get Expense ID from Error
1. Add node: **Code**
   - Name: `Extract Expense ID`
```javascript
// Try to get expense_id from error context
const errorData = $input.first().json;
let expenseId = null;

// Check various locations where expense_id might be
if (errorData.execution?.data?.resultData?.runData?.['Fetch Expense']?.[0]?.data?.main?.[0]?.[0]?.json?.id) {
  expenseId = errorData.execution.data.resultData.runData['Fetch Expense'][0].data.main[0][0].json.id;
} else if (errorData.workflow?.parameters?.expense_id) {
  expenseId = errorData.workflow.parameters.expense_id;
}

return [{
  json: {
    expense_id: expenseId,
    error_message: errorData.message || 'Unknown error',
    node_name: errorData.node?.name || 'Unknown'
  }
}];
```

#### Update Expense Error Status
1. Add node: **Supabase**
   - Name: `Update Expense Error`
2. Configure:
   - **Operation:** Update Row
   - **Table:** `zoho_expenses`
   - **Select Row By:** `id`
   - **Row ID:** `{{ $json.expense_id }}`
   - **Fields:**
     - `status`: `error`
     - `last_error`: `{{ $json.error_message.substring(0, 500) }}`
     - `processed_at`: `{{ $now.toISO() }}`

#### Send Teams Notification
1. Add node: **HTTP Request**
   - Name: `Teams Error Notification`
2. Configure:
   - **Method:** POST
   - **URL:** Your Teams webhook URL
   - **Body Content Type:** JSON
   - **Body:**
```json
{
  "@type": "MessageCard",
  "@context": "https://schema.org/extensions",
  "summary": "Expense Processing Error",
  "themeColor": "FF0000",
  "title": "Expense Processing Failed",
  "sections": [{
    "facts": [
      { "name": "Expense ID", "value": "{{ $json.expense_id }}" },
      { "name": "Error", "value": "{{ $json.error_message }}" },
      { "name": "Node", "value": "{{ $json.node_name }}" }
    ]
  }]
}
```

**Connect:**
- Error Trigger → Extract Expense ID → Update Expense Error → Teams Error Notification

---

## Final Checklist

After building all nodes:

- [ ] All nodes connected properly
- [ ] Webhook path is `/process-expense`
- [ ] Supabase credentials configured
- [ ] QBO OAuth2 credentials configured
- [ ] Monday.com API key configured (in environment variables)
- [ ] Error handler workflow connected
- [ ] Teams webhook URL configured

### Test the Workflow

1. Save and activate the workflow
2. Note the webhook URL
3. Test with curl:
```bash
curl -X POST https://as3driving.app.n8n.cloud/webhook/process-expense \
  -H "Content-Type: application/json" \
  -d '{"expense_id": "test-uuid-here"}'
```

**The workflow is now ready.** Next, you need to set up the database infrastructure (zoho_expenses table, triggers, Edge Function) so that expenses can flow into the queue.

---

## Visual Connection Summary

```
[Webhook] → [Fetch Expense] → [IF Processing?]
                                    │
              ┌─────── NO ──────────┤
              ▼                     │ YES
        [Exit Early]                ▼
                              [Fetch Receipt]
                                    │
                                    ▼
                              [IF is COS?]
                               /         \
                          YES /           \ NO
                             ▼             ▼
                      [Monday API]    [Add Empty Monday]
                             \             /
                              \           /
                               ▼         ▼
                                [Merge]
                                   │
                    ┌──────────────┼──────────────┐
                    ▼              ▼              ▼
              [Bank Txns]    [QBO Accounts]  [QBO Classes]
                    │              │              │
                    └──────────────┼──────────────┘
                                   ▼
                          [Merge Reference]
                                   │
                                   ▼
                             [AI Agent]
                                   │
                                   ▼
                           [Parse AI Output]
                                   │
                                   ▼
                          [IF Match Found?]
                             /          \
                        NO /              \ YES
                          ▼                ▼
                   [Flag Path]      [IF Confidence?]
                                       /        \
                                  NO /            \ YES
                                    ▼              ▼
                              [Flag Path]    [Query Vendor]
                                                   │
                                                   ▼
                                           [IF Vendor Exists?]
                                              /          \
                                         NO /              \ YES
                                           ▼                │
                                    [Create Vendor]         │
                                           \               /
                                            \             /
                                             ▼           ▼
                                           [Get Vendor ID]
                                                   │
                                                   ▼
                                           [Create Purchase]
                                                   │
                                                   ▼
                                          [IF Receipt Exists?]
                                             /          \
                                        YES /            \ NO
                                           ▼              │
                                    [Upload Receipt]      │
                                           \             /
                                            \           /
                                             ▼         ▼
                                       [Update Bank Txn]
                                                │
                                                ▼
                                       [Update Expense: posted]
                                                │
                                                ▼
                                       [Success Response]
```

---

*End of n8n Workflow Rebuild Guide*
