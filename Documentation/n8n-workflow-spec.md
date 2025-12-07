# AS3 Expense Automation - n8n Workflow Specification

**Version:** 2.0
**Last Updated:** December 6, 2025
**Workflow ID:** ZZPC3jm6mXbLrp3u
**Instance:** as3driving.app.n8n.cloud

---

## Table of Contents

1. [Overview](#overview)
2. [Current Workflow Analysis](#current-workflow-analysis)
3. [Revised Workflow Design](#revised-workflow-design)
4. [Node Specifications](#node-specifications)
5. [AI Agent Configuration](#ai-agent-configuration)
6. [Error Handling](#error-handling)
7. [Testing Strategy](#testing-strategy)

---

## Overview

### Problem Statement

The current n8n workflow hits the **10-iteration limit** because the AI Agent has 9 tools attached, requiring 8-9 tool calls per expense. This causes the workflow to fail with:

```
Max iterations (10) reached. The agent could not complete the task within the allowed number of iterations.
```

### Solution

**Pre-fetch pattern:** Move all reference data lookups BEFORE the AI Agent, passing context in the prompt instead of via tool calls. Reduce agent tools from 9 to 3-4.

| Before | After |
|--------|-------|
| 9 tools attached to agent | 3-4 tools attached |
| Agent queries for each lookup | Context provided in prompt |
| 8-9 iterations minimum | 3-4 iterations maximum |
| Frequently hits limit | Never hits limit |

### Two Workflows Required

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| **Flow A: Zoho Expense Processing** | Webhook (Zoho report approved) | Match Zoho expenses to existing bank transactions |
| **Flow B: Orphan Bank Transaction Processing** | Schedule (daily) or Manual | Process bank transactions with no Zoho match |

**Key Insight:** Bank transactions are imported FIRST as source of truth. Zoho expenses come in LATER and get matched TO existing bank transactions.

---

## Current Workflow Analysis

### Current Node Structure

```
[Webhook] → [Split Out] → [Edit Fields] → [HTTP Request] → [Merge] → [AI Agent]
                                                                         │
                                          ┌──────────────────────────────┤
                                          │ 9 TOOLS:                     │
                                          │ 1. check_duplicate           │
                                          │ 2. vendor_rules (Get)        │
                                          │ 3. get_monday_events         │
                                          │ 4. categorization_history    │
                                          │ 5. flagged_expenses          │
                                          │ 6. qbo_accounts              │
                                          │ 7. check_qbo_duplicate       │
                                          │ 8. post_to_qbo               │
                                          │ 9. teams_notify              │
                                          └──────────────────────────────┘
```

### Why It Fails

For a single expense, the agent must call:
1. `check_duplicate` - Verify not already processed
2. `vendor_rules` - Check for known patterns
3. `get_monday_events` - Find related course (for COS)
4. `qbo_accounts` (2x) - Get payment account + expense account
5. `check_qbo_duplicate` - Verify not in QBO
6. `categorization_history` - Log the result
7. `post_to_qbo` OR `flagged_expenses` - Final action
8. `teams_notify` - If flagging

**Total: 8-9 iterations minimum.** Any retry or error pushes over 10.

---

## Revised Workflow Design

### New Node Structure

```
[Webhook: Zoho]
        │
        ▼
[Code: Parse Report Context]
        │
        ▼
[Supabase: Fetch Reference Data] ────────────────────────────────┐
        │                                                         │
        │ Parallel queries:                                       │
        │ ├── qbo_accounts (all)                                  │
        │ ├── vendor_rules (all)                                  │
        │ ├── monday_events (date filtered)                       │
        │ └── bank_transactions (unmatched, date filtered)        │
        │                                                         │
        ▼                                                         │
[Merge: Combine Reference Data] ◄─────────────────────────────────┘
        │
        ▼
[Split Out: expenses array]
        │
        ▼
[For Each Expense:]
        │
        ├──► [HTTP: Fetch Receipt Image]
        │
        ├──► [Supabase: Check Duplicate]
        │           │
        │           ▼
        │    [IF: Already Exists?]
        │           │
        │    [Yes]──┴──[No]
        │     │          │
        │   [Skip]       ▼
        │           [Merge: Combine All Context]
        │                    │
        │                    ▼
        │           [AI Agent (Lean)]
        │                    │
        │           TOOLS (max 4):
        │           ├── log_categorization
        │           ├── match_bank_transaction
        │           └── post_to_qbo OR queue_for_review
        │
        ▼
[End Loop]
```

### Data Flow Summary

| Stage | Input | Output | Tool Calls |
|-------|-------|--------|------------|
| Parse Report | Zoho webhook JSON | Report context (COS/Non-COS, venue, dates) | 0 |
| Fetch Reference | Report dates | qbo_accounts, vendor_rules, events, bank_txns | 0 (Supabase nodes) |
| Per Expense | Expense + receipt | Categorization decision | 3-4 agent calls |

---

## Node Specifications

### Node 1: Webhook (Zoho)

**Type:** n8n-nodes-base.webhook
**Purpose:** Receive expense reports from Zoho when approved

**Configuration:**
```json
{
    "httpMethod": "POST",
    "path": "491d3c57-4d67-4689-995d-e0070cb726a9",
    "responseMode": "onReceived",
    "options": {}
}
```

**Output Structure:**
```json
{
    "body": {
        "expense_report": {
            "report_id": "5647323000000867001",
            "report_name": "C24 - ACADS - CL - Aug 12-13",
            "user_name": "Pablo Ortiz-Monasterio",
            "start_date": "2024-08-12",
            "end_date": "2024-08-13",
            "expenses": [...]
        }
    }
}
```

---

### Node 2: Parse Report Context (Code)

**Type:** n8n-nodes-base.code
**Purpose:** Extract report-level context to determine COS vs Non-COS and venue

**JavaScript Code:**
```javascript
const report = $json.body.expense_report;
const reportName = report.report_name || '';

// Parse report name for context
// Format: "C24 - ACADS - CL - Aug 12-13" or "Admin - Office Supplies - Nov 2024"

const isCOS = reportName.match(/^C\d{2}\s*-/) !== null;

// Extract venue code (for COS reports)
const venueCodeMap = {
    'LS': { venue: 'Laguna Seca', state: 'CA' },
    'WS': { venue: 'Willow Springs', state: 'CA' },
    'SON': { venue: 'Sonoma', state: 'CA' },
    'CL': { venue: 'Crows Landing', state: 'CA' },
    'TMS': { venue: 'Texas Motor Speedway', state: 'TX' },
    'WCD': { venue: 'Western Colorado Dragway', state: 'CO' },
    'ES': { venue: 'Evergreen Speedway', state: 'WA' },
    'PR': { venue: 'Pacific Raceways', state: 'WA' },
    'NJMP': { venue: 'New Jersey Motorsports Park', state: 'NJ' },
    'SFF': { venue: 'South Florida Fairgrounds', state: 'FL' },
    'GCF': { venue: 'Gallatin County Fairgrounds', state: 'MT' }
};

let venueCode = null;
let venueInfo = null;

for (const code of Object.keys(venueCodeMap)) {
    if (reportName.includes(code)) {
        venueCode = code;
        venueInfo = venueCodeMap[code];
        break;
    }
}

// Extract date range
const startDate = report.start_date;
const endDate = report.end_date;

// Calculate query date range (±7 days for bank transaction matching)
const queryStartDate = new Date(startDate);
queryStartDate.setDate(queryStartDate.getDate() - 7);
const queryEndDate = new Date(endDate);
queryEndDate.setDate(queryEndDate.getDate() + 7);

return {
    json: {
        original: $json,
        report_context: {
            report_id: report.report_id,
            report_name: reportName,
            is_cos: isCOS,
            venue_code: venueCode,
            venue_name: venueInfo?.venue || null,
            venue_state: venueInfo?.state || null,
            start_date: startDate,
            end_date: endDate,
            query_start_date: queryStartDate.toISOString().split('T')[0],
            query_end_date: queryEndDate.toISOString().split('T')[0],
            submitter: report.user_name,
            expense_count: report.expenses?.length || 0
        },
        expenses: report.expenses || []
    }
};
```

---

### Node 3: Fetch Reference Data (Supabase - Parallel)

**Structure:** 4 parallel Supabase nodes merged together

#### Node 3a: Fetch QBO Accounts
```json
{
    "operation": "getAll",
    "tableId": "qbo_accounts",
    "returnAll": true
}
```

#### Node 3b: Fetch Vendor Rules
```json
{
    "operation": "getAll",
    "tableId": "vendor_rules",
    "returnAll": true
}
```

#### Node 3c: Fetch Monday Events (Filtered)
```json
{
    "operation": "getAll",
    "tableId": "monday_events",
    "filters": {
        "conditions": [
            {
                "keyName": "start_date",
                "condition": "gte",
                "keyValue": "={{ $json.report_context.query_start_date }}"
            },
            {
                "keyName": "start_date",
                "condition": "lte",
                "keyValue": "={{ $json.report_context.query_end_date }}"
            }
        ]
    }
}
```

#### Node 3d: Fetch Bank Transactions (Unmatched)
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
                "keyValue": "={{ $json.report_context.query_start_date }}"
            },
            {
                "keyName": "transaction_date",
                "condition": "lte",
                "keyValue": "={{ $json.report_context.query_end_date }}"
            }
        ]
    }
}
```

---

### Node 4: Merge Reference Data

**Type:** n8n-nodes-base.merge
**Mode:** Combine by position

Combines outputs from all 4 reference data queries into a single object:

```json
{
    "report_context": { ... },
    "expenses": [ ... ],
    "reference_data": {
        "qbo_accounts": [ ... ],
        "vendor_rules": [ ... ],
        "monday_events": [ ... ],
        "bank_transactions": [ ... ]
    }
}
```

---

### Node 5: Split Out Expenses

**Type:** n8n-nodes-base.splitOut
**Configuration:**
```json
{
    "fieldToSplitOut": "expenses",
    "options": {
        "include": ["report_context", "reference_data"]
    }
}
```

Each iteration receives:
- One expense object
- Full report_context
- All reference_data

---

### Node 6: Fetch Receipt Image

**Type:** n8n-nodes-base.httpRequest
**Configuration:**
```json
{
    "url": "https://www.zohoapis.com/expense/v1/expenses/{{ $json.expense_id }}/receipt",
    "authentication": "oAuth2Api",
    "sendHeaders": true,
    "headerParameters": {
        "parameters": [
            {
                "name": "X-com-zoho-expense-organizationid",
                "value": "867260975"
            }
        ]
    }
}
```

---

### Node 7: Check Duplicate

**Type:** n8n-nodes-base.supabase
**Purpose:** Skip already-processed expenses (before invoking AI)

```json
{
    "operation": "getAll",
    "tableId": "categorization_history",
    "filters": {
        "conditions": [
            {
                "keyName": "zoho_expense_id",
                "condition": "eq",
                "keyValue": "={{ $json.expense_id }}"
            }
        ]
    }
}
```

**Logic:** If result.length > 0, skip to next expense.

---

### Node 8: Merge All Context

**Type:** n8n-nodes-base.merge
**Purpose:** Combine expense, receipt, report_context, and reference_data for AI

Output structure for AI Agent:
```json
{
    "expense": {
        "expense_id": "5647323000000867498",
        "amount": 52.96,
        "merchant_name": "Aho LLC",
        "date": "2024-08-12",
        "category_name": "Fuel - COS",
        "description": "Fuel for course vehicle",
        "state_tag": "California"
    },
    "receipt_image": "<binary data>",
    "report_context": {
        "is_cos": true,
        "venue_code": "CL",
        "venue_name": "Crows Landing",
        "venue_state": "CA"
    },
    "reference_data": {
        "qbo_accounts": [...],
        "vendor_rules": [...],
        "monday_events": [...],
        "bank_transactions": [...]
    }
}
```

---

### Node 9: AI Agent (Lean)

**Type:** @n8n/n8n-nodes-langchain.agent
**Model:** Claude Sonnet 4.5 (claude-sonnet-4-5-20250929)

**Configuration:**
```json
{
    "promptType": "define",
    "options": {
        "systemMessage": "<see AI Agent System Prompt below>",
        "passthroughBinaryImages": true,
        "maxIterations": 6
    }
}
```

**Tools (3-4 only):**

#### Tool 1: log_categorization (Supabase Insert)
```json
{
    "toolDescription": "Log expense categorization to categorization_history. ALWAYS call this.",
    "operation": "insert",
    "tableId": "categorization_history",
    "fieldsUi": {
        "fieldValues": [
            {"fieldId": "source", "fieldValue": "={{ $fromAI('source', 'Always zoho', 'string', 'zoho') }}"},
            {"fieldId": "transaction_date", "fieldValue": "={{ $fromAI('transaction_date') }}"},
            {"fieldId": "vendor_raw", "fieldValue": "={{ $fromAI('vendor_raw') }}"},
            {"fieldId": "vendor_clean", "fieldValue": "={{ $fromAI('vendor_clean') }}"},
            {"fieldId": "amount", "fieldValue": "={{ $fromAI('amount', 'number') }}"},
            {"fieldId": "predicted_category", "fieldValue": "={{ $fromAI('predicted_category') }}"},
            {"fieldId": "predicted_state", "fieldValue": "={{ $fromAI('predicted_state') }}"},
            {"fieldId": "predicted_confidence", "fieldValue": "={{ $fromAI('predicted_confidence', 'number') }}"},
            {"fieldId": "zoho_expense_id", "fieldValue": "={{ $fromAI('zoho_expense_id') }}"},
            {"fieldId": "receipt_validated", "fieldValue": "={{ $fromAI('receipt_validated', 'boolean') }}"},
            {"fieldId": "receipt_amount", "fieldValue": "={{ $fromAI('receipt_amount', 'number') }}"},
            {"fieldId": "bank_transaction_id", "fieldValue": "={{ $fromAI('bank_transaction_id') }}"},
            {"fieldId": "monday_event_id", "fieldValue": "={{ $fromAI('monday_event_id') }}"},
            {"fieldId": "venue_name", "fieldValue": "={{ $fromAI('venue_name') }}"},
            {"fieldId": "venue_state", "fieldValue": "={{ $fromAI('venue_state') }}"}
        ]
    }
}
```

#### Tool 2: match_bank_transaction (Supabase Update)
```json
{
    "toolDescription": "Mark a bank transaction as matched. Call when you find a matching transaction.",
    "operation": "update",
    "tableId": "bank_transactions",
    "matchingColumns": ["id"],
    "fieldsUi": {
        "fieldValues": [
            {"fieldId": "id", "fieldValue": "={{ $fromAI('bank_txn_id', 'UUID of the bank transaction') }}"},
            {"fieldId": "status", "fieldValue": "matched"},
            {"fieldId": "matched_expense_id", "fieldValue": "={{ $fromAI('zoho_expense_id') }}"},
            {"fieldId": "matched_at", "fieldValue": "={{ new Date().toISOString() }}"},
            {"fieldId": "matched_by", "fieldValue": "agent"},
            {"fieldId": "match_confidence", "fieldValue": "={{ $fromAI('match_confidence', 'number') }}"}
        ]
    }
}
```

#### Tool 3: post_to_qbo (HTTP Request)
```json
{
    "toolDescription": "Post approved expense to QuickBooks. Only use when confidence >= 95 AND bank match found.",
    "method": "POST",
    "url": "https://quickbooks.api.intuit.com/v3/company/123146088634019/purchase?minorversion=65",
    "authentication": "quickBooksOAuth2Api",
    "sendBody": true,
    "specifyBody": "json",
    "jsonBody": "={{ JSON.stringify({ ... }) }}"
}
```

#### Tool 4: queue_for_review (Supabase Insert)
```json
{
    "toolDescription": "Queue expense for human review. Use when confidence < 95 OR no bank match.",
    "operation": "insert",
    "tableId": "expense_queue",
    "fieldsUi": {
        "fieldValues": [
            {"fieldId": "zoho_expense_id", "fieldValue": "={{ $fromAI('zoho_expense_id') }}"},
            {"fieldId": "zoho_report_name", "fieldValue": "={{ $fromAI('report_name') }}"},
            {"fieldId": "vendor_name", "fieldValue": "={{ $fromAI('vendor_name') }}"},
            {"fieldId": "amount", "fieldValue": "={{ $fromAI('amount', 'number') }}"},
            {"fieldId": "expense_date", "fieldValue": "={{ $fromAI('expense_date') }}"},
            {"fieldId": "category_suggested", "fieldValue": "={{ $fromAI('category_suggested') }}"},
            {"fieldId": "state_suggested", "fieldValue": "={{ $fromAI('state_suggested') }}"},
            {"fieldId": "confidence_score", "fieldValue": "={{ $fromAI('confidence_score', 'number') }}"},
            {"fieldId": "flag_reason", "fieldValue": "={{ $fromAI('flag_reason') }}"},
            {"fieldId": "suggested_bank_txn_id", "fieldValue": "={{ $fromAI('suggested_bank_txn_id') }}"},
            {"fieldId": "receipt_url", "fieldValue": "={{ $fromAI('receipt_url') }}"},
            {"fieldId": "original_data", "fieldValue": "={{ $fromAI('original_data') }}"}
        ]
    }
}
```

---

## AI Agent Configuration

### System Prompt

```
You are an expense categorization agent for AS3 Driver Training. You process expenses from Zoho and match them to bank transactions.

## IMPORTANT: All reference data is provided below. DO NOT query for this data.

### QBO Accounts (use these qbo_id values):
{{ JSON.stringify($json.reference_data.qbo_accounts) }}

### Vendor Rules (known patterns):
{{ JSON.stringify($json.reference_data.vendor_rules) }}

### Monday Events (nearby courses):
{{ JSON.stringify($json.reference_data.monday_events) }}

### Unmatched Bank Transactions:
{{ JSON.stringify($json.reference_data.bank_transactions) }}

## REPORT CONTEXT
- Report Name: {{ $json.report_context.report_name }}
- Is COS (Course-Related): {{ $json.report_context.is_cos }}
- Venue: {{ $json.report_context.venue_name }} ({{ $json.report_context.venue_state }})
- Date Range: {{ $json.report_context.start_date }} to {{ $json.report_context.end_date }}

## CURRENT EXPENSE
- Expense ID: {{ $json.expense.expense_id }}
- Amount: ${{ $json.expense.amount }}
- Merchant: {{ $json.expense.merchant_name }}
- Date: {{ $json.expense.date }}
- Category: {{ $json.expense.category_name }}
- State Tag: {{ $json.expense.state_tag }}
- Description: {{ $json.expense.description }}

The receipt image is attached.

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
Search the provided bank_transactions for a match where:
- Amount matches within $0.50
- Date within 5 days of expense date
- Description contains similar vendor name

If multiple matches, pick the closest by date and amount.
If no match found, note this for flagging.

### Step 3: Validate Category
Check if category_name matches report type:
- COS report (is_cos=true) should have categories ending in "- COS"
- Non-COS report should NOT have "- COS" categories

Check vendor_rules for known patterns that override category.

### Step 4: Determine State
For COS expenses:
- Use venue_state from report_context: {{ $json.report_context.venue_state }}

For Non-COS expenses:
- Use state_tag from Zoho: {{ $json.expense.state_tag }}
- If unclear, use "Admin"

### Step 5: Calculate Confidence (0-100)
Start at 100, subtract for issues:
- No bank transaction match: -40
- Receipt amount mismatch (>$1 difference): -30
- No receipt image or unreadable: -25
- COS expense with no Monday event: -40
- State unclear or mismatch: -20
- Category mismatch with report type: -15
- Vendor not in rules: -5

### Step 6: Make Decision

**IF confidence >= 95 AND bank_transaction match found:**
1. Call log_categorization (REQUIRED)
2. Call match_bank_transaction to mark the bank txn as matched
3. Call post_to_qbo to create Purchase record

**ELSE (confidence < 95 OR no bank match):**
1. Call log_categorization (REQUIRED)
2. Call queue_for_review to flag for human review

---

## TOOL USAGE RULES

1. ALWAYS call log_categorization first
2. Call match_bank_transaction BEFORE post_to_qbo if you found a match
3. Call EITHER post_to_qbo OR queue_for_review, never both
4. Maximum 4 tool calls per expense

---

## QBO ACCOUNT LOOKUP

When posting to QBO, look up these IDs from qbo_accounts:

Payment Account (AccountRef.value):
- paid_through contains "AMEX" → qbo_id: "99", PaymentType: "CreditCard"
- paid_through contains "Wells Fargo" → qbo_id: "49", PaymentType: "Check"

Expense Account (Line[0].AccountBasedExpenseLineDetail.AccountRef.value):
- Match category_name to zoho_category_match in qbo_accounts
- Use the corresponding qbo_id

---

## FINAL RESPONSE FORMAT

After completing tool calls, respond with:

```
Expense: [merchant] - $[amount]
Bank Match: [Yes/No] - [bank_txn_id or "Not found"]
Category: [category]
State: [state_code]
Confidence: [score]%
Result: [Posted to QBO (ID: xxx)] or [Queued for review: reason]
```
```

---

## Flow B: Orphan Bank Transaction Processing

### Overview

This workflow handles bank transactions that have no corresponding Zoho expense after a grace period. These are legitimate business expenses paid by corporate card but not submitted through Zoho.

**Triggers:**
- Scheduled: Run daily at 6 AM
- Manual: Button in web app to process orphans on demand

**Grace Period:** 5 days from transaction_date (allows time for employee to submit expense)

### Workflow Structure

```
[Schedule Trigger: Daily 6 AM] or [Webhook: Manual Trigger]
        │
        ▼
[Supabase: Query Orphan Transactions]
    - WHERE status = 'unmatched'
    - AND transaction_date < NOW() - 5 days
    - AND source IN ('amex', 'wells_fargo')
        │
        ▼
[Supabase: Fetch Reference Data - Parallel]
    ├── vendor_rules (all)
    ├── qbo_accounts (all)
    └── monday_events (date range from orphan batch)
        │
        ▼
[Split: For Each Orphan Transaction]
        │
        ▼
[Code: State Determination Waterfall]
    1. Check vendor_rules for matching pattern
       → Use vendor_rules.default_state
    2. Parse description for city/state
       → Extract state code from bank description
    3. Check date proximity to courses
       → If within ±2 days of a course, use course state
    4. Cannot determine
       → Set needs_review = true
        │
        ▼
[IF: State Determined?]
    │
    ├── [YES] ─────────────────────────────────────────────┐
    │       │                                               │
    │       ▼                                               │
    │   [Code: Determine Category]                          │
    │       - Check vendor_rules.default_category           │
    │       - Fall back to parsing description              │
    │       - Unknown = flag for review                     │
    │       │                                               │
    │       ▼                                               │
    │   [IF: Category Determined?]                          │
    │       │                                               │
    │       ├── [YES] → [POST to QBO]                       │
    │       │              │                                │
    │       │              ▼                                │
    │       │          [Update bank_transactions]           │
    │       │              - status = 'orphan_processed'    │
    │       │              - qbo_purchase_id = [returned]   │
    │       │              │                                │
    │       │              ▼                                │
    │       │          [IF: is_cos_category?]               │
    │       │              │                                │
    │       │              ├── [YES] → [Create Monday subitem]
    │       │              └── [NO]  → [Done]               │
    │       │                                               │
    │       └── [NO] → [Queue for Orphan Review]            │
    │                                                       │
    └── [NO] ──────────────────────────────────────────────┘
            │
            ▼
    [Insert to orphan_queue in web app]
        - bank_transaction_id
        - suggested_state (if partial match)
        - suggested_category (if partial match)
        - needs_state = true/false
        - needs_category = true/false
```

### Node Specifications for Flow B

#### Node B1: Schedule Trigger
```json
{
    "type": "n8n-nodes-base.scheduleTrigger",
    "parameters": {
        "rule": {
            "interval": [
                {
                    "field": "hours",
                    "hoursInterval": 24,
                    "triggerAtHour": 6
                }
            ]
        }
    }
}
```

#### Node B2: Query Orphan Transactions
```json
{
    "type": "n8n-nodes-base.supabase",
    "parameters": {
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
                    "condition": "lt",
                    "keyValue": "={{ DateTime.now().minus({days: 5}).toISODate() }}"
                }
            ]
        }
    }
}
```

#### Node B3: State Determination Waterfall (Code Node)

```javascript
const transaction = $json;
const vendorRules = $('Fetch Vendor Rules').all().map(item => item.json);
const mondayEvents = $('Fetch Monday Events').all().map(item => item.json);

// Parse common vendor patterns from description
const description = transaction.description.toUpperCase();

// Step 1: Check vendor_rules for matching pattern
let matchedRule = null;
for (const rule of vendorRules) {
    const pattern = rule.vendor_pattern.toUpperCase();
    if (description.includes(pattern)) {
        matchedRule = rule;
        break;
    }
}

if (matchedRule && matchedRule.default_state) {
    return {
        json: {
            ...transaction,
            determined_state: matchedRule.default_state,
            determined_category: matchedRule.default_category,
            determination_method: 'vendor_rules',
            matched_vendor_rule_id: matchedRule.id,
            needs_review: false
        }
    };
}

// Step 2: Parse description for city/state patterns
// Common patterns: "CITY STATE", "CITY, STATE", "CITY ST"
const statePatterns = [
    { code: 'CA', patterns: ['CALIFORNIA', ' CA ', ' CA$', ',CA'] },
    { code: 'TX', patterns: ['TEXAS', ' TX ', ' TX$', ',TX'] },
    { code: 'CO', patterns: ['COLORADO', ' CO ', ' CO$', ',CO'] },
    { code: 'WA', patterns: ['WASHINGTON', ' WA ', ' WA$', ',WA'] },
    { code: 'NJ', patterns: ['NEW JERSEY', ' NJ ', ' NJ$', ',NJ'] },
    { code: 'FL', patterns: ['FLORIDA', ' FL ', ' FL$', ',FL'] },
    { code: 'MT', patterns: ['MONTANA', ' MT ', ' MT$', ',MT'] },
    { code: 'PA', patterns: ['PENNSYLVANIA', ' PA ', ' PA$', ',PA'] },
    { code: 'NY', patterns: ['NEW YORK', ' NY ', ' NY$', ',NY'] },
    { code: 'AZ', patterns: ['ARIZONA', ' AZ ', ' AZ$', ',AZ'] },
    { code: 'NV', patterns: ['NEVADA', ' NV ', ' NV$', ',NV'] },
    { code: 'OR', patterns: ['OREGON', ' OR ', ' OR$', ',OR'] }
];

let parsedState = null;
for (const state of statePatterns) {
    for (const pattern of state.patterns) {
        if (description.includes(pattern) || description.match(new RegExp(pattern))) {
            parsedState = state.code;
            break;
        }
    }
    if (parsedState) break;
}

if (parsedState) {
    return {
        json: {
            ...transaction,
            determined_state: parsedState,
            determined_category: matchedRule?.default_category || null,
            determination_method: 'description_parsing',
            needs_review: matchedRule?.default_category ? false : true
        }
    };
}

// Step 3: Date proximity to course
const txnDate = new Date(transaction.transaction_date);
for (const event of mondayEvents) {
    const eventStart = new Date(event.start_date);
    const eventEnd = new Date(event.end_date || event.start_date);

    // Expand window by 2 days on each side
    eventStart.setDate(eventStart.getDate() - 2);
    eventEnd.setDate(eventEnd.getDate() + 2);

    if (txnDate >= eventStart && txnDate <= eventEnd) {
        return {
            json: {
                ...transaction,
                determined_state: event.state,
                determined_category: null, // Still need category
                determination_method: 'course_proximity',
                matched_monday_event_id: event.monday_item_id,
                matched_event_name: event.event_name,
                needs_review: true // Need human to confirm category
            }
        };
    }
}

// Step 4: Cannot determine - queue for review
return {
    json: {
        ...transaction,
        determined_state: null,
        determined_category: null,
        determination_method: 'none',
        needs_review: true
    }
};
```

### Reimbursement Handling in Flow A

When Flow A (Zoho Expense Processing) finds NO matching bank transaction:

```javascript
// In AI Agent decision logic
if (!bankMatchFound) {
    // This is a reimbursement - employee used personal card
    queue_for_review({
        zoho_expense_id: expense.expense_id,
        is_reimbursement: true,
        flag_reason: 'No bank match - appears to be reimbursable expense',
        // ... other fields
    });
}
```

The expense_queue entry will have:
- `is_reimbursement: true`
- `flag_reason: "No bank match - reimbursable expense"`
- `suggested_bank_txn_id: null`

Human reviewer will:
1. Confirm it's a valid expense
2. Approve for posting to QBO (without bank match)
3. Mark reimbursement method (check, zelle, payroll deduction)

---

## Error Handling

### Retry Strategy

| Error Type | Retry? | Action |
|------------|--------|--------|
| Supabase connection | Yes, 3x | Exponential backoff (1s, 2s, 4s) |
| QBO API rate limit | Yes, 3x | Wait 30 seconds between retries |
| QBO OAuth expired | No | Trigger OAuth refresh, retry once |
| Receipt fetch failed | No | Continue without receipt, reduce confidence |
| AI iteration limit | No | Log error, queue all remaining for manual review |

### Error Logging

Create an `error_log` table or use n8n's built-in error workflow:

```sql
CREATE TABLE IF NOT EXISTS workflow_errors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id TEXT,
    execution_id TEXT,
    node_name TEXT,
    error_type TEXT,
    error_message TEXT,
    expense_id TEXT,
    input_data JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Testing Strategy

### Test Cases

| Test Case | Input | Expected Output |
|-----------|-------|-----------------|
| Happy path - COS expense | COS report, matching bank txn | Posted to QBO |
| Happy path - Non-COS | Admin report, matching bank txn | Posted to QBO |
| No bank match | Expense without matching bank txn | Queued for review |
| Receipt mismatch | Receipt shows different amount | Queued for review |
| Duplicate expense | Same zoho_expense_id twice | Skip second attempt |
| Category mismatch | COS report with Non-COS category | Flagged with warning |

### Test Webhook Payload

Use this sample to test the workflow:

```json
{
    "body": {
        "expense_report": {
            "report_id": "TEST-001",
            "report_name": "C24 - ACADS - CL - Dec 06-07",
            "user_name": "Test User",
            "start_date": "2024-12-06",
            "end_date": "2024-12-07",
            "expenses": [
                {
                    "expense_id": "TEST-EXP-001",
                    "amount": 52.96,
                    "merchant_name": "Test Gas Station",
                    "date": "2024-12-06",
                    "category_name": "Fuel - COS",
                    "description": "Fuel for course vehicle",
                    "paid_through_account_name": "AMEX Business 61002",
                    "line_items": [{
                        "tags": [{
                            "tag_name": "Course Location",
                            "tag_option_name": "California"
                        }]
                    }],
                    "documents": [{
                        "document_id": "DOC-001"
                    }]
                }
            ]
        }
    }
}
```

---

## Workflow Backup & Deployment

### Export Current Workflow

1. Open n8n Cloud (as3driving.app.n8n.cloud)
2. Navigate to workflow ZZPC3jm6mXbLrp3u
3. Click menu → Download
4. Save as `zoho-expense-processing-v1-backup.json`

### Deployment Steps

1. Create new version of workflow (don't modify active)
2. Implement changes node by node
3. Test with webhook-test endpoint
4. Verify with sample payloads
5. Activate new version
6. Monitor first 10 real executions

---

## Monitoring

### Key Metrics

| Metric | Target | Alert Threshold |
|--------|--------|-----------------|
| Iteration count | ≤ 4 | > 6 |
| Execution time | < 30s | > 60s |
| Success rate | > 95% | < 90% |
| Auto-match rate | > 80% | < 60% |

### Dashboard Queries

```sql
-- Daily processing stats
SELECT
    DATE(created_at) as date,
    COUNT(*) as total_processed,
    SUM(CASE WHEN predicted_confidence >= 95 THEN 1 ELSE 0 END) as auto_approved,
    SUM(CASE WHEN was_corrected THEN 1 ELSE 0 END) as corrections,
    AVG(predicted_confidence) as avg_confidence
FROM categorization_history
WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'
GROUP BY 1
ORDER BY 1 DESC;
```

---

*End of n8n Workflow Specification*
