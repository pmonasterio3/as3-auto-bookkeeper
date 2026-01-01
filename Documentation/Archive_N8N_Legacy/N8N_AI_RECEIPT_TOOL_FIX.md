# n8n Workflow Fix: AI Agent Receipt Tool Architecture

**Version:** 1.0
**Created:** December 28, 2025
**Status:** CRITICAL FIX - SUPERSEDES N8N_VALIDATE_RECEIPT_FIX.md and N8N_SIMPLIFICATION_GUIDE.md

---

## The Problem

The AI Agent cannot see or analyze receipt images because:

1. `passthroughBinaryImages` was set to `false`
2. System message explicitly says "DO NOT attempt to analyze receipt images"
3. An Edge Function was doing validation instead (wrong architecture)

**This defeats the entire purpose of the AI Agent** - its core job IS to analyze receipts, validate amounts, and make intelligent categorization decisions.

---

## The Correct Architecture

**Zero binary in workflow nodes. AI fetches receipt on-demand via HTTP Request Tool.**

```
[Webhook] → [Fetch Expense] → [Upload Receipt to Storage] → [Update Receipt Path]
                                                                    ↓
                                                             [IF is COS?]
                                                              /         \
                                                         YES /           \ NO
                                                            ↓             ↓
                                                   [Monday API]    [Add Empty Monday]
                                                            \             /
                                                             ↓           ↓
                                                              [Merge]
                                                                 ↓
                            ┌────────────────────────────────────┼────────────────────────────────────┐
                            ↓                                    ↓                                    ↓
                      [Bank Txns]                          [QBO Accounts]                       [QBO Classes]
                            │                                    │                                    │
                            └────────────────────────────────────┼────────────────────────────────────┘
                                                                 ↓
                                                    [Merge Reference Data]
                                                                 ↓
                                                           [AI Agent]
                                                    ┌──────────────────────┐
                                                    │  HTTP Request Tools: │
                                                    │  - Fetch Receipt     │ ← AI calls this to see image
                                                    │  - categorization_   │
                                                    │    history           │
                                                    └──────────────────────┘
                                                                 ↓
                                                      [Parse AI Decision]
                                                                 ↓
                                                        [Create Purchase]
                                                                 ↓
                                                      [Prepare Receipt Upload]
                                                                 ↓
                                                       [IF Has Receipt?]
                                                        /             \
                                                   YES /               \ NO
                                                      ↓                 ↓
                                          [Fetch Receipt for QBO]   [Skip]
                                                      ↓
                                            [Upload to QBO]
                                                      ↓
                                              [Update Status]
```

**Key Principle:** Binary data only exists during:
1. Initial upload to Supabase Storage (isolated HTTP operation)
2. AI Agent's tool call to fetch receipt (isolated HTTP operation)
3. QBO upload (fresh fetch, isolated HTTP operation)

**NO binary flows through Code nodes = NO memory duplication = NO crashes**

---

## Step-by-Step Implementation

### Step 1: Delete Call Validate Receipt Connection

**Location:** Between "Update Receipt Path" and "Call Validate Receipt"

**Action:** Delete the connection wire. Do NOT delete the node yet.

---

### Step 2: Create New Connection

**Action:** Connect "Update Receipt Path" directly to "IF is COS"

This bypasses the Edge Function call entirely.

---

### Step 3: Delete Call Validate Receipt Node

**Action:** Now delete the "Call Validate Receipt" node completely.

The Edge Function approach is abandoned.

---

### Step 4: Add Fetch Receipt Tool to AI Agent

**Location:** AI Agent node → Tools section

**Add:** HTTP Request Tool

| Setting | Value |
|---------|-------|
| **Name** | Fetch Receipt Tool |
| **Description** | Fetch receipt image from Supabase Storage. Use this to see and analyze the receipt. Pass the receipt_storage_path value. |
| **Method** | GET |
| **URL** | `https://fzwozzqwyzztadxgjryl.supabase.co/storage/v1/object/expense-receipts/{{ $fromAI('receipt_path', 'The receipt_storage_path from expense data', 'string') }}` |
| **Authentication** | Supabase API (use existing credential) |
| **Options** | Response Format: File |

**Critical:** The `$fromAI()` function lets the AI control what path to fetch. The AI reads `receipt_storage_path` from the expense data and passes it to this tool.

---

### Step 5: Modify Filter Monday Node

**Replace entire code with:**

```javascript
const mondayEvents = $input.all().map(item => item.json);
const expense = $('Edit Fields').first().json;
const qboData = $('Process QBO Accounts').first().json;

const expenseDate = new Date(expense.date);
const expenseState = expense.state;

let matchedEvent = null;
let bestScore = 0;

for (const event of mondayEvents) {
  if (!event.start_date) continue;

  const startDate = new Date(event.start_date);
  const endDate = new Date(event.end_date || event.start_date);

  // Allow 2-day buffer
  startDate.setDate(startDate.getDate() - 2);
  endDate.setDate(endDate.getDate() + 2);

  if (expenseDate >= startDate && expenseDate <= endDate) {
    let score = 1;

    // Exact date range match bonus
    const exactStart = new Date(event.start_date);
    const exactEnd = new Date(event.end_date || event.start_date);
    if (expenseDate >= exactStart && expenseDate <= exactEnd) {
      score += 2;
    }

    // State match bonus (+10)
    if (event.state && expenseState && event.state === expenseState) {
      score += 10;
    }

    if (score > bestScore) {
      bestScore = score;
      matchedEvent = event;
    }
  }
}

return [{
  json: {
    ...qboData,
    monday_event: matchedEvent,
    monday_event_id: matchedEvent?.monday_item_id || null,
    monday_event_name: matchedEvent?.event_name || null,
    monday_venue: matchedEvent?.venue || null,
    monday_venue_address: matchedEvent?.venue_address || null,
    monday_state: matchedEvent?.state || null
  }
}];
```

**What changed:** Removed all `binary:` references and `receipt_validation` references.

---

### Step 6: Modify Add Empty Monday Node

**Replace entire code with:**

```javascript
const expense = $('Process QBO Accounts').first().json;

if (!expense || !expense.expense_id) {
  return [{
    json: {
      error: 'No expense data found in Add Empty Monday',
      monday_event: null
    }
  }];
}

return [{
  json: {
    ...expense,
    monday_event: null,
    monday_event_id: null,
    monday_event_name: null,
    monday_venue: null
  }
}];
```

**What changed:** Removed all `binary:` references and `receipt_validation` references.

---

### Step 7: Modify AI Agent - Enable Binary Passthrough

**Location:** AI Agent node → Options

**Set:** `passthroughBinaryImages` = `true`

This allows the AI to see images returned by the Fetch Receipt Tool.

---

### Step 8: Modify AI Agent - Update Prompt Text

**Replace the user prompt with:**

```
## EXPENSE TO CATEGORIZE

**Expense ID:** {{ $json.expense_id }}
**Supabase ID:** {{ $json.supabase_id }}
**Date:** {{ $json.date }}
**Amount:** ${{ $json.amount }}
**Merchant (from Zoho):** {{ $json.merchant }}
**Category (from Zoho):** {{ $json.category }}
**Description:** {{ $json.description || 'None' }}
**State Tag (from Zoho):** {{ $json.state || 'None' }}
**Payment Method:** {{ $json.paid_through }}
**Receipt Path:** {{ $json.receipt_storage_path || 'NO RECEIPT' }}

## MONDAY EVENT (if matched)

{{ $json.monday_event ? JSON.stringify($json.monday_event, null, 2) : 'No Monday event matched for this expense.' }}

## BANK TRANSACTIONS (potential matches)

{{ JSON.stringify($json.bank_transactions || [], null, 2) }}

## QBO ACCOUNTS

{{ JSON.stringify($json.qbo_accounts || [], null, 2) }}

## QBO CLASSES (for state tracking)

{{ JSON.stringify($json.qbo_classes || [], null, 2) }}

---

## YOUR TASK

1. **FIRST**: If receipt_storage_path exists, use the "Fetch Receipt Tool" to view and analyze the receipt image.

2. **Validate the receipt** against the expense:
   - Does the receipt amount match ${{ $json.amount }}?
   - Does the merchant on receipt match "{{ $json.merchant }}"?
   - **IMPORTANT: Extract the DATE from the receipt.** Does it match {{ $json.date }}?
   - If receipt date differs from expense date, note this and USE THE RECEIPT DATE for bank matching.

3. **Find the matching bank transaction** from the list provided.
   - Use the RECEIPT DATE (if extracted) when looking for date matches
   - Allow ± 2 days from receipt date for bank transaction matching
   - If no match on receipt date, fall back to expense date

4. **Determine the correct QBO account** for this expense type.

5. **Determine the correct QBO class** (state) using:
   - State tag from Zoho: "{{ $json.state }}"
   - Monday event state (if matched)
   - If "Other" → use NC (North Carolina / Admin)

6. **Call the categorization_history tool** to record your decision.

7. **Return your decision** in this exact JSON format:
```json
{
  "bank_transaction_id": "uuid or null",
  "qbo_account_id": "number",
  "qbo_account_name": "string",
  "qbo_class_id": "number",
  "qbo_class_name": "string",
  "vendor_name": "string (cleaned)",
  "confidence": 0-100,
  "reasoning": "Brief explanation",
  "receipt_validated": true/false,
  "receipt_issues": ["array of any receipt problems"],
  "receipt_date": "YYYY-MM-DD or null if no receipt/unreadable",
  "date_corrected": true/false
}
```
```

---

### Step 9: Modify AI Agent - Update System Message

**Replace the system message with:**

```
You are an expert expense categorization agent for AS3 Driver Training.

## YOUR CORE PURPOSE
Analyze expense data AND receipt images to make accurate categorization decisions.

## TOOLS AVAILABLE

1. **Fetch Receipt Tool** - Use this FIRST when receipt_storage_path exists. This fetches the receipt image from Supabase Storage so you can see and analyze it.

2. **categorization_history** - Use this to record your decision in the database.

## WORKFLOW

1. Read the expense data provided
2. If receipt_storage_path is present, call Fetch Receipt Tool with that path
3. Analyze the receipt image for: merchant name, total amount, date, any discrepancies
4. Match to a bank transaction (prefer exact amount match, allow ±$0.50)
5. Select correct QBO account based on category
6. Select correct QBO class based on state tag or Monday event
7. Call categorization_history tool
8. Return your decision as JSON

## STATE MAPPING

- CA → California (Class ID: 1000000004)
- TX → Texas (Class ID: 1000000006)
- CO → Colorado (Class ID: 1000000007)
- WA → Washington (Class ID: 1000000008)
- NJ → New Jersey (Class ID: 1000000009)
- FL → Florida (Class ID: 1000000010)
- MT → Montana (Class ID: 1000000011)
- Other/NC → Admin/North Carolina (Class ID: 1000000012)

## CONFIDENCE SCORING

Start at 100, subtract:
- No bank transaction match: -40
- Amount mismatch > $1: -30
- Receipt unreadable: -25
- State unclear: -20
- Merchant name mismatch: -15
- No receipt provided: -10

## DATE HANDLING (CRITICAL FOR BANK MATCHING)

Receipt dates are more accurate than Zoho expense dates. When analyzing receipts:

1. **Extract the transaction date** from the receipt image
2. **Compare to expense date** provided in the data
3. **If dates differ, USE THE RECEIPT DATE** when searching for bank transaction matches
4. Bank transactions should be matched by receipt date ± 2 days, not expense date

Common date discrepancies:
- Expense submitted days after purchase (use receipt date)
- Credit card posting delay (receipt date = actual purchase)
- Timezone differences (receipt date is authoritative)

Include `receipt_date` and `date_corrected` in your JSON output.

## CRITICAL RULES

- NEVER guess a state. Use Zoho tag or Monday event state only.
- If confidence < 70, flag for human review.
- Always validate receipt amount against expense amount.
- Clean vendor names (remove prefixes like "TST*", card numbers, etc.)
```

---

### Step 10: Modify Merge Vendor Result Node

**Current code likely has binary references. Replace with:**

```javascript
const prevData = $('AI Agent').first().json;
const vendorResult = $input.first().json;

return [{
  json: {
    ...prevData,
    vendor_id: vendorResult?.Vendor?.Id || null,
    vendor_name: vendorResult?.Vendor?.DisplayName || prevData.vendor_name
  }
}];
```

**What changed:** Removed `binary:` line.

---

### Step 11: Modify Prepare Receipt Upload Node

**Replace entire code with:**

```javascript
const purchaseData = $input.first().json;
const purchaseId = purchaseData.Purchase?.Id || purchaseData.id;
const expense = $('Edit Fields').first().json;
const parseAI = $('Parse AI Decision').first()?.json;
const bankTransactionId = parseAI?.bank_transaction_id || expense.bank_transaction_id;

// No receipt? Return early
if (!expense.receipt_storage_path) {
  return [{
    json: {
      purchase_id: purchaseId,
      expense_id: expense.expense_id,
      bank_transaction_id: bankTransactionId,
      supabase_id: expense.supabase_id,
      has_receipt: false
    }
  }];
}

// Has receipt - pass path info (NOT binary)
return [{
  json: {
    purchase_id: purchaseId,
    expense_id: expense.expense_id,
    bank_transaction_id: bankTransactionId,
    supabase_id: expense.supabase_id,
    receipt_storage_path: expense.receipt_storage_path,
    receipt_content_type: expense.receipt_content_type || 'image/jpeg',
    has_receipt: true
  }
}];
```

**What changed:** Returns path info only, no binary.

---

### Step 12: Add "Fetch Receipt for QBO" Node

**Location:** After "IF Has Receipt" (true branch), before "Upload Receipt to QBO"

**Type:** HTTP Request

| Setting | Value |
|---------|-------|
| **Name** | Fetch Receipt for QBO |
| **Method** | GET |
| **URL** | `https://fzwozzqwyzztadxgjryl.supabase.co/storage/v1/object/expense-receipts/{{ $json.receipt_storage_path }}` |
| **Authentication** | Supabase API |
| **Options** | Response Format: File |

This fetches the receipt fresh for QBO upload - binary only exists in this isolated operation.

---

### Step 13: Verify IF Has Receipt Condition

**Condition should be:**

```
{{ $json.has_receipt === true }}
```

or

```
{{ $json.receipt_storage_path }}
```

---

## Testing

After applying all changes:

1. Find a pending expense with a receipt:
   ```sql
   SELECT id, zoho_expense_id, merchant_name, receipt_storage_path, status
   FROM zoho_expenses
   WHERE receipt_storage_path IS NOT NULL
     AND status = 'pending'
   LIMIT 1;
   ```

2. Trigger the workflow with that expense ID

3. Check the AI Agent execution:
   - Should show "Fetch Receipt Tool" being called
   - Should show the AI analyzing the receipt image
   - Should return a decision with `receipt_validated: true`

4. Verify QBO has the receipt attached

---

## Why This Architecture Works

1. **Memory Isolation:** Binary data never flows through Code nodes. Each HTTP operation is isolated.

2. **AI Control:** The AI decides when to fetch the receipt based on whether `receipt_storage_path` exists.

3. **Clean Data Flow:** All nodes pass JSON only. Binary exists only during HTTP fetch operations.

4. **QBO Upload Works:** The receipt is fetched fresh right before QBO upload, avoiding binary duplication.

5. **Queue-Based + This Fix = Complete Solution:** The queue architecture (1 expense per execution) plus this tool-based approach eliminates all memory issues.

---

## Files Superseded

- `N8N_VALIDATE_RECEIPT_FIX.md` - Obsolete (Edge Function approach abandoned)
- `N8N_SIMPLIFICATION_GUIDE.md` - Obsolete (was removing AI receipt analysis)

The AI Agent's core purpose IS to analyze receipts. This fix restores that functionality.

---

---

## Enhancement: Receipt Date Extraction (December 28, 2025)

Added date extraction from receipts to improve bank transaction matching:

1. AI extracts transaction date from receipt image
2. Compares to Zoho expense date
3. Uses receipt date for bank matching (more accurate)
4. Reports `receipt_date` and `date_corrected` in JSON output

This is purely a prompt enhancement - no node changes required.

*End of Fix Document - Updated December 28, 2025*
