# AS3 Expense Automation - n8n Workflow Specification

**Version:** 3.1 (Queue-Based Single-Expense Processing)
**Last Updated:** December 16, 2025
**Workflow ID:** ZZPC3jm6mXbLrp3u (Agent 1 - COMPLETE ✅), TBD (Agent 2), TBD (Agent 3)
**Instance:** as3driving.app.n8n.cloud

---

## ⚠️ MAJOR ARCHITECTURE CHANGE: v3.0 Queue-Based Processing

**Effective:** December 11, 2025

**BREAKING CHANGE:** The workflow NO LONGER receives Zoho webhooks directly or processes multiple expenses in a loop.

### Old Architecture (v2.0)
- Zoho → n8n webhook → Loop over expenses → Process all in single execution
- **Problem:** Memory exhaustion with 23+ expenses (188MB+ per execution)
- **Problem:** Binary data (receipts) lost during loop iterations
- **Problem:** One failed expense blocks entire report

### New Architecture (v3.0)
- Zoho → Supabase Edge Function → `zoho_expenses` table
- Database trigger → n8n webhook (single `expense_id`)
- n8n fetches ONE expense → Processes → Updates status
- Queue controller manages max 5 concurrent executions

### Benefits
- **Memory isolation:** Each execution processes one expense with fresh memory
- **Self-healing:** Failed expenses don't block others
- **Observable:** All expense states visible in database (`status` column)
- **Retryable:** Reset status to 'pending' to reprocess
- **Scalable:** Handles reports of any size (tested up to 100+ expenses)
- **Reliable:** No more binary data loss or iteration issues

### Migration Impact
- ✅ Zoho webhook goes to Supabase Edge Function (already deployed)
- ✅ Database schema includes `zoho_expenses` table with queue controller trigger
- ⚠️ **THIS DOCUMENT:** n8n workflow must be rebuilt to accept single expense_id
- ⚠️ All loop-based patterns are deprecated

See `expense-automation-architecture.md` for full details.

---

## Table of Contents

1. [Overview](#overview)
2. [Code Node Best Practices](#code-node-best-practices)
3. [Agent 1: Single-Expense Processor](#agent-1-single-expense-processor)
4. [Agent 2: Orphan Processor](#agent-2-orphan-processor)
5. [AI Agent Configuration](#ai-agent-configuration)
6. [Queue Recovery Procedures](#queue-recovery-procedures)
7. [Error Handling](#error-handling)
8. [Testing Strategy](#testing-strategy)

---

## Overview

### Problem Statement

The v2.0 workflow processed multiple expenses in a loop within a single n8n execution. This caused:

1. **Memory exhaustion** with large reports (23+ expenses = 188MB+)
2. **Binary data loss** when not explicitly preserved in Code nodes
3. **Iteration limit failures** (AI agent hitting 10-iteration limit)
4. **Blocking failures** (one bad expense blocks entire report)

### Solution: Queue-Based Architecture

Instead of processing all expenses in one execution, the new architecture:

1. **Zoho webhook** → Supabase Edge Function (stores all expenses in database)
2. **Database trigger** → Calls n8n for each expense (with `expense_id`)
3. **n8n processes ONE expense** → Updates status → Trigger fires for next expense
4. **Queue controller** limits concurrency to 5 simultaneous executions

### Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     Queue-Based Processing                      │
└─────────────────────────────────────────────────────────────────┘

[Zoho Webhook: Expense Report Approved]
            │
            ▼
[Supabase Edge Function: store_zoho_expenses]
   - Stores each expense in zoho_expenses table
   - Status: 'pending'
   - Receipt uploaded to Storage
            │
            ▼
[Database Trigger: ON UPDATE status TO 'pending']
   - Checks: COUNT(*) WHERE status = 'processing' < 5
   - Updates: ONE expense SET status = 'processing'
   - Calls: n8n webhook with expense_id via pg_net
            │
            ▼
[n8n Workflow: POST /process-expense]
   - Fetches expense from zoho_expenses
   - Fetches receipt from Storage
   - Matches to bank_transaction
   - Posts to QBO
   - Updates: status = 'posted' OR 'error' OR 'flagged'
            │
            ▼
[Database Trigger: ON UPDATE status FROM 'processing']
   - Detects: One expense finished
   - Loops back: Processes next pending expense
```

### Three Agent Workflows

| Agent | Trigger | Purpose | Volume |
|-------|---------|---------|--------|
| **Agent 1: Zoho Expense Processor** | Webhook (per expense) | Match single expense to bank, post to QBO | High (100-200/month) |
| **Agent 2: Orphan & Recurring Processor** | Schedule (daily) | Process unmatched bank txns after 45 days | Low (10-20/month) |
| **Agent 3: Income Reconciler** - DEFERRED | Schedule (daily) | Match STRIPE deposits to WooCommerce | TBD |

---

## Code Node Best Practices

**NOTE:** Many v2.0 patterns are deprecated in v3.0 because we no longer process multiple expenses in a loop.

### v3.0 Simplified Patterns (Single Expense)

#### Pattern 1: Fetching Expense from Database

```javascript
// Get the single expense from Supabase query
const expense = $('Fetch Expense').first().json;
const expenseId = expense.id;
const zohoCategoryName = expense.category_name;
const amount = expense.amount;
```

#### Pattern 2: Using Receipt Binary Data

```javascript
// Receipt is already fetched from Storage as single item
const receiptItem = $('Fetch Receipt').first();
const receiptBinary = receiptItem.binary;

// No need to preserve binary in loops - there is no loop!
```

#### Pattern 3: Preparing QBO Payload

```javascript
const expense = $('Fetch Expense').first().json;
const vendor = $('Lookup Vendor').first().json;
const qboClass = $('Fetch QBO Class').first().json;

// Simple payload creation - no mapping needed
return [{
  json: {
    VendorRef: { value: vendor.qbo_vendor_id },
    TxnDate: expense.expense_date,
    Line: [{
      Amount: expense.amount,
      DetailType: 'AccountBasedExpenseLineDetail',
      AccountBasedExpenseLineDetail: {
        AccountRef: { value: expense.qbo_account_id },
        ClassRef: { value: qboClass.qbo_class_id }
      }
    }],
    PrivateNote: `Zoho: ${expense.zoho_expense_id}`
  }
}];
```

### Deprecated v2.0 Patterns

❌ **DO NOT USE:** `$runIndex` (no longer needed - no loop)
❌ **DO NOT USE:** `.map()` over multiple expenses (single expense only)
❌ **DO NOT USE:** Binary preservation patterns for loops (no loop to preserve through)

---

## Agent 1: Single-Expense Processor

**Workflow ID:** ZZPC3jm6mXbLrp3u ✅ COMPLETE
**Trigger:** `POST /process-expense { "expense_id": "uuid" }`
**Called by:** Supabase `process_expense_queue()` trigger via `pg_net`
**Status:** Production-ready, successfully processing expenses

### December 16, 2025 Fixes

**1. Bank Transaction Query - HTTP Request Pattern**

The Supabase node could not handle date filtering correctly with ±3 days. Replaced with HTTP Request node using PostgREST query syntax.

**Node Configuration:**
- **Type:** `n8n-nodes-base.httpRequest`
- **Method:** GET
- **Authentication:** Supabase API (predefined credentials)
- **URL:** `https://fzwozzqwyzztadxgjryl.supabase.co/rest/v1/bank_transactions`

**Query Parameters:**
```
select=id,transaction_date,description,amount,status,source,extracted_vendor
status=eq.unmatched
transaction_date=gte.{{ $json.date_start }}
transaction_date=lte.{{ $json.date_end }}
```

**Headers:**
- `apikey`: Supabase anon key (from credentials)
- `Authorization`: `Bearer [service_role_key]` (from credentials)
- `Prefer`: `return=representation`

**Date Calculation (Code Node Before Query):**
```javascript
const expense = $('Fetch Expense').first().json;
const expenseDate = new Date(expense.expense_date);

// Calculate ±3 days for bank transaction matching
const dateStart = new Date(expenseDate);
dateStart.setDate(dateStart.getDate() - 3);

const dateEnd = new Date(expenseDate);
dateEnd.setDate(dateEnd.getDate() + 3);

return [{
  json: {
    ...expense,
    date_start: dateStart.toISOString().split('T')[0],
    date_end: dateEnd.toISOString().split('T')[0]
  }
}];
```

**2. Data Flow After Supabase Update Nodes**

Supabase update nodes return only their update confirmation, breaking the data chain. Solution: Reference earlier nodes explicitly.

**Pattern:**
```javascript
// CORRECT: Reference earlier node explicitly
const expense = $('Process QBO Accounts').first().json;
const qboClass = $('Fetch QBO Class').first().json;
const receiptBinary = $('Fetch Receipt').first()?.binary;

// INCORRECT: This won't work after Supabase update
const expense = $input.first().json;
```

**Example in "Prepare Purchase Payload" Node:**
```javascript
const expense = $('Process QBO Accounts').first().json;
const vendor = $('Lookup Vendor').first().json;
const qboClass = $('Fetch QBO Class').first().json;
const bankMatch = $('Match Bank Transaction').first().json;

return [{
  json: {
    AccountRef: { value: expense.paid_through.includes('AMEX') ? '99' : '49' },
    PaymentType: expense.paid_through.includes('AMEX') ? 'CreditCard' : 'Check',
    TxnDate: expense.expense_date,
    EntityRef: { value: vendor.vendor_id },
    Line: [{
      Amount: expense.amount,
      DetailType: 'AccountBasedExpenseLineDetail',
      AccountBasedExpenseLineDetail: {
        AccountRef: { value: expense.qbo_account_id },
        ClassRef: { value: qboClass.qbo_class_id }
      }
    }],
    PrivateNote: `Zoho: ${expense.zoho_expense_id} | State: ${expense.state_tag}`
  }
}];
```

**3. Filter Monday State Matching**

When multiple Monday events match by date, prefer the one whose state matches the expense state.

**Logic in "Filter Monday" Code Node:**
```javascript
const mondayItems = $input.all();
const expense = $('Fetch Receipt').first().json;

let bestMatch = null;
let bestScore = 0;

for (const item of mondayItems) {
  const event = item.json;
  let score = 100; // Base score for date match

  // State matching bonus
  if (event.state === expense.state_tag) {
    score += 10; // Prefer events in same state
  }

  // Date proximity (closer = higher score)
  const dateDiff = Math.abs(
    new Date(event.start_date) - new Date(expense.expense_date)
  ) / (1000 * 60 * 60 * 24);
  score -= dateDiff;

  if (score > bestScore) {
    bestScore = score;
    bestMatch = event;
  }
}

return [{
  json: {
    ...expense,
    monday_event: bestMatch,
    monday_state: bestMatch?.state || null
  },
  binary: $('Fetch Receipt').first()?.binary
}];
```

**4. Flag Reason Column**

Added `flag_reason` TEXT column to `zoho_expenses` table to store why expenses are flagged.

**Migration:**
```sql
ALTER TABLE zoho_expenses ADD COLUMN IF NOT EXISTS flag_reason TEXT;
```

**Usage in Workflow:**
- Set when confidence < 95%
- Set when no bank match found
- Set when receipt validation fails
- Displayed in Review Queue UI

### Workflow Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                  Agent 1: Single-Expense Processor (v3.0)                   │
│                  Trigger: POST /process-expense { expense_id }              │
└─────────────────────────────────────────────────────────────────────────────┘

  [Webhook Trigger]
         │
         ▼
  [Fetch Expense from zoho_expenses]
         │
         ▼
  [IF status = 'processing']──NO──>[Exit: Already Processed]
         │ YES
         ▼
  [Fetch Receipt from Storage]
         │
         ▼
  [IF is COS?]──YES──>[Fetch Monday Event]──┐
         │ NO                               │
         │                                  │
         ▼◄─────────────────────────────────┘
  [Fetch Reference Data: Parallel]
  ├─ bank_transactions (unmatched, ±3 days)
  ├─ qbo_accounts
  └─ qbo_classes
         │
         ▼
  [AI Agent: Match & Categorize]
  - Tools: NONE (all data pre-fetched)
  - Output: matched bank_transaction_id, confidence, QBO account
         │
         ▼
  [IF Match Found?]──NO──>[Flag for Review]──>[Update: status='flagged']──>[Exit]
         │ YES
         ▼
  [IF Confidence >= 95%?]──NO──>[Flag for Review]──>[Update: status='flagged']──>[Exit]
         │ YES
         ▼
  [Lookup/Create QBO Vendor]
         │
         ▼
  [Fetch QBO Class (for state)]
         │
         ▼
  [Create QBO Purchase]
  - AccountRef: Payment account (AMEX or Wells Fargo)
  - ExpenseLineDetail: Account + ClassRef
  - EntityRef: Vendor
         │
         ▼
  [Upload Receipt to QBO]
  - Use Attachable API
  - Binary data from Fetch Receipt step
         │
         ▼
  [Update Bank Transaction]
  UPDATE bank_transactions
  SET status = 'matched',
      matched_expense_id = zoho_expense_id,
      qbo_purchase_id = purchase_id,
      qbo_vendor_id = vendor_id
  WHERE id = matched_bank_txn_id
         │
         ▼
  [Update Expense Status]
  UPDATE zoho_expenses
  SET status = 'posted',
      bank_transaction_id = matched_bank_txn_id,
      qbo_purchase_id = purchase_id,
      qbo_posted_at = NOW(),
      processed_at = NOW()
  WHERE id = expense_id
         │
         ▼
  [Exit: Success]
         │
         └──On Error──>[Update: status='error', last_error]──>[Teams Notification]
```

### Node Specifications

#### Node 1: Webhook Trigger

**Type:** `n8n-nodes-base.webhook`
**Purpose:** Receive single expense_id from queue controller

**Configuration:**
```json
{
  "httpMethod": "POST",
  "path": "process-expense",
  "responseMode": "lastNode",
  "options": {}
}
```

**Expected Request Body:**
```json
{
  "expense_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

---

#### Node 2: Fetch Expense

**Type:** `n8n-nodes-base.supabase`
**Purpose:** Get full expense record from database

**Configuration:**
```json
{
  "operation": "getAll",
  "tableId": "zoho_expenses",
  "filters": {
    "conditions": [
      {
        "keyName": "id",
        "condition": "eq",
        "keyValue": "={{ $json.body.expense_id }}"
      }
    ]
  },
  "options": {
    "queryName": "single()"
  }
}
```

**Output Fields:**
- `id` (UUID)
- `zoho_expense_id` (string)
- `zoho_report_id` (string)
- `zoho_report_name` (string)
- `category_name` (string)
- `state_tag` (string)
- `merchant_name` (string)
- `amount` (numeric)
- `expense_date` (date)
- `paid_through` (string)
- `receipt_storage_path` (string)
- `status` (enum: 'pending', 'processing', 'posted', 'error', 'flagged')
- `raw_payload` (jsonb - full Zoho expense object)

---

#### Node 3: Check Status

**Type:** `n8n-nodes-base.if`
**Purpose:** Prevent duplicate processing

**Configuration:**
```json
{
  "conditions": {
    "string": [
      {
        "value1": "={{ $json.status }}",
        "operation": "equals",
        "value2": "processing"
      }
    ]
  }
}
```

**True Branch:** Continue processing
**False Branch:** Exit (already processed or error state)

---

#### Node 4: Fetch Receipt

**Type:** `n8n-nodes-base.supabase`
**Operation:** Storage download

**Configuration:**
```json
{
  "operation": "download",
  "bucketId": "expense-receipts",
  "fileName": "={{ $json.receipt_storage_path }}"
}
```

**Output:** Binary data (receipt image)

---

#### Node 5: IF is COS

**Type:** `n8n-nodes-base.if`
**Purpose:** Route to Monday.com venue lookup for Cost of Sales expenses

**Configuration:**
```json
{
  "conditions": {
    "string": [
      {
        "value1": "={{ $json.category_name }}",
        "operation": "contains",
        "value2": "- COS"
      }
    ]
  }
}
```

**True Branch:** Fetch Monday Event
**False Branch:** Skip to reference data fetch

---

#### Node 6: Fetch Monday Event (COS only)

**Type:** `n8n-nodes-base.code`
**Purpose:** Query Monday.com API for events overlapping expense date

**JavaScript Code:**
```javascript
const expense = $('Fetch Expense').first().json;
const expenseDate = new Date(expense.expense_date);

// Monday.com GraphQL query
const query = `query {
  items(board_ids: [8294758830]) {
    id
    name
    column_values {
      id
      text
      value
    }
  }
}`;

// Execute query via Monday.com HTTP Request node
// Filter events where start_date <= expense_date <= end_date
// Extract venue name and state

// Return matched event or null
return [{
  json: {
    ...expense,
    monday_event_id: matchedEvent?.id || null,
    monday_venue: matchedEvent?.venue || null,
    monday_state: matchedEvent?.state || null
  }
}];
```

**Note:** This may be replaced with HTTP Request node + Filter node for cleaner implementation.

---

#### Node 7: Fetch Reference Data (Parallel)

**Structure:** 3 parallel Supabase nodes

##### Node 7a: Fetch Bank Transactions

```json
{
  "operation": "getAll",
  "tableId": "bank_transactions",
  "filters": {
    "conditions": [
      {
        "keyName": "status",
        "condition": "eq",
        "keyValue": "unmatched"
      },
      {
        "keyName": "transaction_date",
        "condition": "gte",
        "keyValue": "={{ DateTime.fromISO($json.expense_date).minus({days: 3}).toISODate() }}"
      },
      {
        "keyName": "transaction_date",
        "condition": "lte",
        "keyValue": "={{ DateTime.fromISO($json.expense_date).plus({days: 3}).toISODate() }}"
      }
    ]
  }
}
```

##### Node 7b: Fetch QBO Accounts

```json
{
  "operation": "getAll",
  "tableId": "qbo_accounts",
  "returnAll": true
}
```

##### Node 7c: Fetch QBO Classes

```json
{
  "operation": "getAll",
  "tableId": "qbo_classes",
  "returnAll": true
}
```

---

#### Node 8: AI Agent

**Type:** `@n8n/n8n-nodes-langchain.agent`
**Model:** Claude Sonnet 4.5 (claude-sonnet-4-5-20250929)

**Configuration:**
```json
{
  "promptType": "define",
  "text": "<see AI Agent System Prompt below>",
  "options": {
    "systemMessage": "",
    "passthroughBinaryImages": true,
    "maxIterations": 6
  }
}
```

**Tools:** NONE - All data is pre-fetched and provided in prompt

**Input Data:**
- Expense record (from Fetch Expense)
- Receipt image (binary)
- Reference data (bank_transactions, qbo_accounts, qbo_classes)
- Monday event (if COS)

**Output Expected (JSON):**
```json
{
  "matched_bank_txn_id": "uuid or null",
  "match_confidence": 95,
  "qbo_account_id": "35",
  "qbo_class_id": "1000000004",
  "state_code": "CA",
  "flag_reason": "null or reason string"
}
```

---

#### Node 9: IF Match Found

**Type:** `n8n-nodes-base.if`

**Configuration:**
```json
{
  "conditions": {
    "boolean": [
      {
        "value1": "={{ $json.matched_bank_txn_id !== null }}",
        "value2": true
      }
    ]
  }
}
```

**False Branch:** Flag for Review → Update status='flagged' → Exit

---

#### Node 10: IF Confidence >= 95%

**Type:** `n8n-nodes-base.if`

**Configuration:**
```json
{
  "conditions": {
    "number": [
      {
        "value1": "={{ $json.match_confidence }}",
        "operation": "largerEqual",
        "value2": 95
      }
    ]
  }
}
```

**False Branch:** Flag for Review → Update status='flagged' → Exit

---

#### Node 11: Lookup/Create QBO Vendor

**Structure:** 3 nodes (Query → IF Exists → Create)

##### Node 11a: Query Vendor

**Type:** `n8n-nodes-base.httpRequest`
**Method:** GET
**URL:** `https://quickbooks.api.intuit.com/v3/company/123146088634019/query`

**Query Parameters:**
```
query: SELECT * FROM Vendor WHERE DisplayName = '{{ $json.merchant_name }}'
```

##### Node 11b: IF Vendor Exists

**Type:** `n8n-nodes-base.if`

Check if `QueryResponse.Vendor.length > 0`

##### Node 11c: Create Vendor (if not exists)

**Type:** `n8n-nodes-base.httpRequest`
**Method:** POST
**URL:** `https://quickbooks.api.intuit.com/v3/company/123146088634019/vendor`

**Body:**
```json
{
  "DisplayName": "{{ $json.merchant_name }}",
  "Active": true
}
```

---

#### Node 12: Fetch QBO Class

**Type:** `n8n-nodes-base.supabase`
**Purpose:** Get ClassRef value for state

**Configuration:**
```json
{
  "operation": "getAll",
  "tableId": "qbo_classes",
  "filters": {
    "conditions": [
      {
        "keyName": "state_code",
        "condition": "eq",
        "keyValue": "={{ $json.state_code }}"
      }
    ]
  },
  "options": {
    "queryName": "single()"
  }
}
```

---

#### Node 13: Create QBO Purchase

**Type:** `n8n-nodes-base.httpRequest`
**Method:** POST
**URL:** `https://quickbooks.api.intuit.com/v3/company/123146088634019/purchase?minorversion=65`
**Authentication:** quickBooksOAuth2Api

**Body:**
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

**Output:**
```json
{
  "Purchase": {
    "Id": "123",
    "...": "..."
  }
}
```

---

#### Node 14: Upload Receipt to QBO

**Type:** `n8n-nodes-base.httpRequest`
**Method:** POST
**URL:** `https://quickbooks.api.intuit.com/v3/company/123146088634019/upload?minorversion=65`
**Authentication:** quickBooksOAuth2Api
**Content-Type:** multipart/form-data

**Body:**
- `file_metadata_01`: Attachable JSON
- `file_content_01`: Receipt binary data

**Attachable JSON:**
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

**Note:** Only execute if receipt exists (IF node before this).

---

#### Node 15: Update Bank Transaction

**Type:** `n8n-nodes-base.supabase`
**Operation:** Update

**Configuration:**
```json
{
  "operation": "update",
  "tableId": "bank_transactions",
  "filterType": "id",
  "id": "={{ $json.matched_bank_txn_id }}",
  "fieldsUi": {
    "fieldValues": [
      { "fieldId": "status", "fieldValue": "matched" },
      { "fieldId": "matched_expense_id", "fieldValue": "={{ $json.zoho_expense_id }}" },
      { "fieldId": "matched_at", "fieldValue": "={{ $now.toISO() }}" },
      { "fieldId": "matched_by", "fieldValue": "agent" },
      { "fieldId": "match_confidence", "fieldValue": "={{ $json.match_confidence }}" },
      { "fieldId": "qbo_purchase_id", "fieldValue": "={{ $json.purchase_id }}" },
      { "fieldId": "qbo_vendor_id", "fieldValue": "={{ $json.vendor_id }}" }
    ]
  }
}
```

---

#### Node 16: Update Expense Status (Success)

**Type:** `n8n-nodes-base.supabase`
**Operation:** Update

**Configuration:**
```json
{
  "operation": "update",
  "tableId": "zoho_expenses",
  "filterType": "id",
  "id": "={{ $json.expense_id }}",
  "fieldsUi": {
    "fieldValues": [
      { "fieldId": "status", "fieldValue": "posted" },
      { "fieldId": "bank_transaction_id", "fieldValue": "={{ $json.matched_bank_txn_id }}" },
      { "fieldId": "qbo_purchase_id", "fieldValue": "={{ $json.purchase_id }}" },
      { "fieldId": "qbo_posted_at", "fieldValue": "={{ $now.toISO() }}" },
      { "fieldId": "processed_at", "fieldValue": "={{ $now.toISO() }}" }
    ]
  }
}
```

**CRITICAL:** This UPDATE triggers the queue controller to process the next expense.

---

#### Node 17: Error Handler (Global)

**Type:** `n8n-nodes-base.supabase` (Update on error)
**Triggered by:** Error trigger on any node

**Configuration:**
```json
{
  "operation": "update",
  "tableId": "zoho_expenses",
  "filterType": "id",
  "id": "={{ $json.expense_id }}",
  "fieldsUi": {
    "fieldValues": [
      { "fieldId": "status", "fieldValue": "error" },
      { "fieldId": "last_error", "fieldValue": "={{ $json.error.message }}" },
      { "fieldId": "processing_attempts", "fieldValue": "={{ $json.processing_attempts + 1 }}" },
      { "fieldId": "processed_at", "fieldValue": "={{ $now.toISO() }}" }
    ]
  }
}
```

**Also:** Send Teams notification with error details.

---

#### Node 18: Flag for Review (Low Confidence)

**Type:** `n8n-nodes-base.supabase`
**Operation:** Insert

**Configuration:**
```json
{
  "operation": "insert",
  "tableId": "expense_queue",
  "fieldsUi": {
    "fieldValues": [
      { "fieldId": "zoho_expense_id", "fieldValue": "={{ $json.zoho_expense_id }}" },
      { "fieldId": "zoho_report_name", "fieldValue": "={{ $json.zoho_report_name }}" },
      { "fieldId": "vendor_name", "fieldValue": "={{ $json.merchant_name }}" },
      { "fieldId": "amount", "fieldValue": "={{ $json.amount }}" },
      { "fieldId": "expense_date", "fieldValue": "={{ $json.expense_date }}" },
      { "fieldId": "category_suggested", "fieldValue": "={{ $json.category_name }}" },
      { "fieldId": "state_suggested", "fieldValue": "={{ $json.state_tag }}" },
      { "fieldId": "confidence_score", "fieldValue": "={{ $json.match_confidence }}" },
      { "fieldId": "flag_reason", "fieldValue": "={{ $json.flag_reason }}" },
      { "fieldId": "suggested_bank_txn_id", "fieldValue": "={{ $json.matched_bank_txn_id }}" },
      { "fieldId": "original_data", "fieldValue": "={{ JSON.stringify($json) }}" }
    ]
  }
}
```

**Then:** Update zoho_expenses status='flagged' and exit.

---

## Agent 2: Orphan Processor

**Status:** TO BE BUILT (v3.0 compatible)
**Trigger:** Schedule (daily) or Manual
**Purpose:** Process unmatched bank transactions after 45-day grace period

### Architecture Note

Agent 2 handles a LOW VOLUME of orphaned transactions (typically <10 per week). Therefore, **loop-based processing is acceptable** for Agent 2.

**Agent 2 can use the v2.0 loop patterns** because:
- Small batch size (rarely exceeds 20 items)
- No receipt binary data to preserve
- Already has all reference data (vendor_rules, qbo_accounts)

### Workflow Overview (Loop-Based)

```
[Schedule Trigger: Daily 6 AM]
        │
        ▼
[Supabase: Query Orphan Transactions]
  WHERE status = 'unmatched'
    AND transaction_date < NOW() - 45 days
        │
        ▼
[Fetch Reference Data: Parallel]
  ├─ vendor_rules
  ├─ qbo_accounts
  └─ qbo_classes
        │
        ▼
[Split Out: Loop Over Orphan Transactions]
        │
        ▼
[Code: State Determination Waterfall]
  1. Check vendor_rules for pattern match
  2. Parse description for city/state
  3. Check date proximity to courses
  4. Cannot determine → needs_review = true
        │
        ▼
[IF: State Determined?]
        │
   YES  │  NO
    │   └───>[Queue for Human Review]
    ▼
[Lookup/Create QBO Vendor]
    ▼
[Create QBO Purchase]
    ▼
[Update bank_transactions: status='orphan_processed']
    ▼
[End Loop]
```

**NOTE:** Full specifications for Agent 2 will be documented after Agent 1 is rebuilt and tested.

---

## AI Agent Configuration

### Agent 1 System Prompt

```
You are Agent 1: Zoho Expense Processor for AS3 Driver Training.

Your job: Match a single approved Zoho expense to an existing bank transaction and prepare it for QuickBooks Online posting.

## CRITICAL: You have NO tools

All reference data has been pre-fetched and is provided in your context. You do NOT need to query anything.

Your output will be used by subsequent n8n nodes to:
1. Post the Purchase to QBO
2. Update the bank transaction
3. Upload the receipt

## INPUT DATA PROVIDED

### Expense Record:
- Zoho Expense ID: {{ $json.expense.zoho_expense_id }}
- Amount: ${{ $json.expense.amount }}
- Merchant: {{ $json.expense.merchant_name }}
- Date: {{ $json.expense.expense_date }}
- Category: {{ $json.expense.category_name }}
- State Tag: {{ $json.expense.state_tag }}
- Paid Through: {{ $json.expense.paid_through }}
- Description: {{ $json.expense.description }}

### Receipt Image:
The receipt image is attached as binary data. Analyze it for:
- Amount validation
- Merchant name confirmation
- Date verification
- Location (if visible)

### Unmatched Bank Transactions (within ±3 days):
{{ JSON.stringify($json.reference_data.bank_transactions, null, 2) }}

### QBO Accounts (for expense account lookup):
{{ JSON.stringify($json.reference_data.qbo_accounts, null, 2) }}

### QBO Classes (for state ClassRef):
{{ JSON.stringify($json.reference_data.qbo_classes, null, 2) }}

### Monday Event (if COS expense):
{{ $json.monday_event ? JSON.stringify($json.monday_event, null, 2) : 'Not applicable (Non-COS expense)' }}

---

## YOUR DECISION PROCESS

### Step 1: Analyze Receipt

Extract from the receipt image:
- Amount shown
- Merchant name
- Date
- Location (if visible)

Compare receipt amount to claimed amount ({{ $json.expense.amount }}).

### Step 2: Find Bank Transaction Match

Search the provided bank_transactions for the BEST match where:
- Amount matches within $0.50
- Date within ±3 days of expense date ({{ $json.expense.expense_date }})
- Description contains similar vendor name

If multiple matches, pick the closest by:
1. Exact amount match first
2. Then closest date
3. Then best vendor name match

If NO match found, set `matched_bank_txn_id: null` and provide `flag_reason`.

### Step 3: Determine QBO Account

Look up the qbo_accounts array for a record where:
- `zoho_category_match` contains the expense's `category_name`

Example:
- If category_name = "Fuel - COS", find record with zoho_category_match = "Fuel - COS"
- Use that record's `qbo_id` value

### Step 4: Determine State and Class

For COS expenses (category contains "- COS"):
- Use `monday_event.state` if available
- Otherwise use `state_tag` from expense

For Non-COS expenses:
- Use `state_tag` from expense
- If "Other" → Use "NC" (North Carolina - admin state)

Look up the qbo_classes array for a record where:
- `state_code` matches the determined state

Use that record's `qbo_class_id` value.

### Step 5: Calculate Confidence (0-100)

Start at 100, subtract for issues:
- No bank transaction match: -40
- Receipt amount mismatch (>$1 difference): -30
- No receipt image or unreadable: -25
- COS expense with no Monday event: -20
- State unclear: -20
- Category not found in qbo_accounts: -15
- Merchant name very different: -10

### Step 6: Output Decision

Return a JSON object with:

```json
{
  "matched_bank_txn_id": "uuid or null",
  "match_confidence": 95,
  "qbo_account_id": "35",
  "qbo_class_id": "1000000004",
  "state_code": "CA",
  "flag_reason": "null or reason string",
  "receipt_amount_matches": true,
  "receipt_merchant_matches": true
}
```

**Confidence Rules:**
- >= 95%: Will be posted to QBO automatically
- < 95%: Will be flagged for human review

**Flag Reasons (if confidence < 95%):**
- "No bank match found"
- "Receipt amount mismatch: receipt shows $X, expense claims $Y"
- "Receipt unreadable"
- "COS expense without Monday event"
- "State unclear"
- "Category not found in QBO accounts"

---

## EXAMPLES

### Example 1: Perfect Match

Input:
- Expense: $52.96, "Shell Gas Station", 2024-12-06, "Fuel - COS", "California"
- Receipt: Shows $52.96, "Shell", "12/06/2024"
- Bank transactions: [{id: "abc-123", amount: 52.96, date: "2024-12-06", description: "SHELL GAS STATION CA"}]

Output:
```json
{
  "matched_bank_txn_id": "abc-123",
  "match_confidence": 100,
  "qbo_account_id": "35",
  "qbo_class_id": "1000000004",
  "state_code": "CA",
  "flag_reason": null,
  "receipt_amount_matches": true,
  "receipt_merchant_matches": true
}
```

### Example 2: No Bank Match

Input:
- Expense: $45.00, "Amazon", 2024-12-06, "Office Supplies", "Other"
- Receipt: Shows $45.00, "Amazon.com"
- Bank transactions: [] (empty - no matches in date range)

Output:
```json
{
  "matched_bank_txn_id": null,
  "match_confidence": 60,
  "qbo_account_id": "12",
  "qbo_class_id": "1000000012",
  "state_code": "NC",
  "flag_reason": "No bank match found - may be reimbursement",
  "receipt_amount_matches": true,
  "receipt_merchant_matches": true
}
```

---

## FINAL NOTES

- You do NOT call any tools
- Your output JSON will be used by subsequent n8n nodes
- Focus on accuracy - it's OK to flag for human review if uncertain
- ALWAYS provide a flag_reason if confidence < 95%
```

---

## Queue Recovery Procedures

### Stuck Expenses (status = 'processing' for >15 minutes)

**Symptoms:**
- Expenses stuck in 'processing' status
- No new expenses being picked up by queue controller
- n8n workflow failed/timed out without updating status

**Diagnosis:**
```sql
-- Find stuck expenses
SELECT
  id,
  zoho_expense_id,
  merchant_name,
  amount,
  processing_started_at,
  processing_attempts,
  EXTRACT(EPOCH FROM (NOW() - processing_started_at))/60 AS minutes_stuck
FROM zoho_expenses
WHERE status = 'processing'
  AND processing_started_at < NOW() - INTERVAL '15 minutes'
ORDER BY processing_started_at;
```

**Resolution:**
```sql
-- Reset stuck expenses to pending for reprocessing
UPDATE zoho_expenses
SET
  status = 'pending',
  last_error = 'Reset: stuck in processing after timeout',
  processing_attempts = processing_attempts + 1
WHERE status = 'processing'
  AND processing_started_at < NOW() - INTERVAL '15 minutes';

-- This UPDATE triggers queue controller to pick them up again
```

### Failed Expenses (status = 'error')

**Symptoms:**
- Expenses in 'error' status
- Teams notification received with error details

**Diagnosis:**
```sql
-- View failed expenses with error messages
SELECT
  id,
  zoho_expense_id,
  merchant_name,
  amount,
  status,
  last_error,
  processing_attempts,
  processed_at
FROM zoho_expenses
WHERE status = 'error'
ORDER BY processed_at DESC
LIMIT 20;
```

**Resolution:**

1. **Investigate error cause** (check last_error field)
2. **Fix root cause** (e.g., QBO auth expired, missing vendor_rules pattern)
3. **Reset for retry:**

```sql
-- Reset specific expense for retry
UPDATE zoho_expenses
SET
  status = 'pending',
  last_error = NULL
WHERE id = '550e8400-e29b-41d4-a716-446655440000';

-- Or reset ALL failed expenses (use cautiously)
UPDATE zoho_expenses
SET
  status = 'pending',
  last_error = 'Bulk reset after root cause fix'
WHERE status = 'error'
  AND processing_attempts < 3;  -- Prevent infinite retry loop
```

### Manual Queue Trigger

**Symptoms:**
- Queue seems stuck (no pending expenses being claimed)
- Trigger function not firing

**Resolution:**
```sql
-- Manually trigger queue processing
-- This forces the trigger function to run
SELECT process_expense_queue() FROM zoho_expenses LIMIT 1;

-- Or directly call via pg_net (simulates trigger)
SELECT net.http_post(
  url := 'https://as3driving.app.n8n.cloud/webhook/process-expense',
  headers := '{"Content-Type": "application/json"}',
  body := json_build_object('expense_id', id)::text
)
FROM zoho_expenses
WHERE status = 'pending'
LIMIT 1;
```

### Monitor Queue Health

**Create this monitoring query:**
```sql
-- Queue health dashboard
SELECT
  status,
  COUNT(*) as count,
  MIN(created_at) as oldest,
  MAX(created_at) as newest,
  AVG(processing_attempts) as avg_attempts
FROM zoho_expenses
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY status
ORDER BY
  CASE status
    WHEN 'processing' THEN 1
    WHEN 'pending' THEN 2
    WHEN 'error' THEN 3
    WHEN 'flagged' THEN 4
    WHEN 'posted' THEN 5
  END;
```

**Expected healthy state:**
- `processing`: 0-5 (active executions)
- `pending`: 0 (all processed)
- `error`: 0-2 (investigate if >2)
- `flagged`: varies (human review needed)
- `posted`: majority

---

## Error Handling

### Global Error Strategy

All nodes in the workflow should connect to a global error handler that:

1. **Updates expense status to 'error'**
2. **Logs error details to last_error field**
3. **Increments processing_attempts counter**
4. **Sends Teams notification** (if attempts >= 3)

### Error Handler Node

**Type:** `n8n-nodes-base.supabase` (on error trigger)

```json
{
  "operation": "update",
  "tableId": "zoho_expenses",
  "filterType": "id",
  "id": "={{ $json.expense_id }}",
  "fieldsUi": {
    "fieldValues": [
      { "fieldId": "status", "fieldValue": "error" },
      { "fieldId": "last_error", "fieldValue": "={{ $json.error.message }}" },
      { "fieldId": "processing_attempts", "fieldValue": "={{ $json.processing_attempts + 1 }}" },
      { "fieldId": "processed_at", "fieldValue": "={{ $now.toISO() }}" }
    ]
  }
}
```

### Retry Strategy

| Error Type | Retry? | Action |
|------------|--------|--------|
| Supabase connection timeout | Yes (automatic by queue) | Status reset to 'pending' after 5 min |
| QBO API rate limit (429) | Yes (automatic by queue) | Status reset after 1 min |
| QBO OAuth expired | No | Manual OAuth refresh required |
| Receipt not found in Storage | No | Flag for review (missing receipt) |
| AI iteration limit | No | Flag for review (too complex) |
| Invalid expense data | No | Mark as 'error' (fix data, reset manually) |

### Teams Notification

**Trigger:** When `processing_attempts >= 3` OR critical errors

**Webhook URL:** `https://as3drivertraining.webhook.office.com/webhookb2/...`

**Message Format:**
```json
{
  "@type": "MessageCard",
  "@context": "https://schema.org/extensions",
  "summary": "Expense Processing Failed",
  "themeColor": "FF0000",
  "title": "Expense Processing Error",
  "sections": [{
    "activityTitle": "Expense {{ $json.zoho_expense_id }} failed after 3 attempts",
    "facts": [
      { "name": "Merchant", "value": "{{ $json.merchant_name }}" },
      { "name": "Amount", "value": "${{ $json.amount }}" },
      { "name": "Date", "value": "{{ $json.expense_date }}" },
      { "name": "Error", "value": "{{ $json.last_error }}" },
      { "name": "Attempts", "value": "{{ $json.processing_attempts }}" }
    ],
    "markdown": true
  }],
  "potentialAction": [{
    "@type": "OpenUri",
    "name": "View in Dashboard",
    "targets": [{
      "os": "default",
      "uri": "https://expenses.as3drivertraining.com/queue"
    }]
  }]
}
```

---

## Testing Strategy

### Test Cases

| Test Case | Input | Expected Output |
|-----------|-------|-----------------|
| **Happy path - COS** | Valid COS expense with bank match | Status: 'posted', QBO Purchase created, receipt attached |
| **Happy path - Non-COS** | Valid admin expense with bank match | Status: 'posted', QBO Purchase created |
| **No bank match** | Expense without matching bank txn | Status: 'flagged', expense_queue entry created |
| **Low confidence** | Receipt amount mismatch | Status: 'flagged', confidence < 95% |
| **Duplicate processing** | Resubmit same expense_id | Exit early (status != 'processing') |
| **Missing receipt** | Receipt not in Storage | Continue with confidence penalty |
| **QBO error** | QBO API returns 500 | Status: 'error', last_error populated |
| **Large report** | 50 expenses in report | All 50 processed independently |

### Test Webhook Payload

**Endpoint:** `POST https://as3driving.app.n8n.cloud/webhook/process-expense`

**Payload:**
```json
{
  "expense_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Prerequisites:**
1. Expense must exist in `zoho_expenses` table with status='pending'
2. Receipt must be uploaded to Supabase Storage
3. Related bank transactions must exist (if testing match logic)

### Load Testing

**Scenario:** Process 100 expenses from a large report

1. Upload 100 expenses via Supabase Edge Function
2. Monitor queue progression:
   ```sql
   SELECT status, COUNT(*)
   FROM zoho_expenses
   WHERE created_at > NOW() - INTERVAL '1 hour'
   GROUP BY status;
   ```
3. Verify max 5 concurrent executions (check n8n execution list)
4. Confirm all expenses reach final state ('posted', 'error', or 'flagged')
5. Check average processing time per expense (target: <30 seconds)

### Validation Queries

```sql
-- Verify all expenses processed
SELECT
  COUNT(*) FILTER (WHERE status = 'posted') as posted,
  COUNT(*) FILTER (WHERE status = 'error') as errors,
  COUNT(*) FILTER (WHERE status = 'flagged') as flagged,
  COUNT(*) FILTER (WHERE status = 'pending') as pending,
  COUNT(*) FILTER (WHERE status = 'processing') as processing
FROM zoho_expenses
WHERE created_at > NOW() - INTERVAL '1 hour';

-- Verify bank transactions matched
SELECT
  bt.id,
  bt.description,
  bt.amount,
  bt.status,
  ze.zoho_expense_id
FROM bank_transactions bt
LEFT JOIN zoho_expenses ze ON ze.bank_transaction_id = bt.id
WHERE bt.transaction_date > NOW() - INTERVAL '1 week'
ORDER BY bt.transaction_date DESC;

-- Verify QBO Purchases created
SELECT
  ze.zoho_expense_id,
  ze.merchant_name,
  ze.amount,
  ze.qbo_purchase_id,
  bt.qbo_vendor_id
FROM zoho_expenses ze
JOIN bank_transactions bt ON bt.id = ze.bank_transaction_id
WHERE ze.status = 'posted'
  AND ze.qbo_posted_at > NOW() - INTERVAL '1 hour';
```

---

## Workflow Deployment

### Deployment Checklist

- [ ] Supabase Edge Function deployed (store_zoho_expenses)
- [ ] Database trigger created (process_expense_queue)
- [ ] `zoho_expenses` table created with correct schema
- [ ] `qbo_classes` table populated with 8 states
- [ ] n8n workflow rebuilt with queue-based architecture
- [ ] Webhook endpoint updated in Zoho (points to Edge Function)
- [ ] Test with single expense (manual trigger)
- [ ] Test with 5 expenses (verify concurrency limit)
- [ ] Test with 50+ expenses (load test)
- [ ] Monitor first production report
- [ ] Teams notification channel confirmed
- [ ] Error recovery procedures documented

### Rollback Plan

If queue-based architecture fails:

1. **Revert Zoho webhook** to old n8n endpoint (temporary)
2. **Disable queue trigger** in Supabase:
   ```sql
   DROP TRIGGER IF EXISTS process_expense_trigger ON zoho_expenses;
   ```
3. **Investigate errors** in `zoho_expenses.last_error`
4. **Fix and redeploy**
5. **Re-enable trigger**

---

## Monitoring & Metrics

### Key Metrics Dashboard

| Metric | Target | Alert Threshold | Query |
|--------|--------|-----------------|-------|
| Processing time per expense | <30s | >60s | Check n8n execution duration |
| Success rate | >95% | <90% | `COUNT(*) WHERE status='posted' / COUNT(*)` |
| Auto-match rate | >80% | <60% | `COUNT(*) WHERE match_confidence >= 95 / COUNT(*)` |
| Flagged rate | <15% | >25% | `COUNT(*) WHERE status='flagged' / COUNT(*)` |
| Error rate | <5% | >10% | `COUNT(*) WHERE status='error' / COUNT(*)` |
| Queue depth | <10 | >50 | `COUNT(*) WHERE status='pending'` |

### Monitoring Queries

```sql
-- Daily processing stats
SELECT
  DATE(created_at) as date,
  COUNT(*) as total_processed,
  SUM(CASE WHEN status = 'posted' THEN 1 ELSE 0 END) as posted,
  SUM(CASE WHEN status = 'flagged' THEN 1 ELSE 0 END) as flagged,
  SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as errors,
  ROUND(AVG(EXTRACT(EPOCH FROM (processed_at - created_at)))) as avg_seconds
FROM zoho_expenses
WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'
GROUP BY 1
ORDER BY 1 DESC;

-- Current queue state
SELECT
  status,
  COUNT(*),
  MIN(created_at) as oldest_created,
  MAX(processing_started_at) as latest_processing_start
FROM zoho_expenses
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY status;
```

---

*End of n8n Workflow Specification v3.0*
