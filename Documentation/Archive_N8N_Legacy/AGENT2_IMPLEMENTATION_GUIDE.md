# Agent 2: Orphan & Recurring Processor - Complete Implementation Guide

**Version:** 1.0
**Date:** December 10, 2025
**Status:** Ready for Single-Iteration Implementation
**Prerequisite:** Agent 1 working, vendor_rules seeded

---

## Executive Summary

This document provides everything needed to build Agent 2 in a **single iteration**. It incorporates all lessons learned from Agent 1's development, particularly around:

1. **Binary data preservation** (not applicable - orphans have no receipts)
2. **Correct data reference patterns** (`$input.first()` vs `$('NodeName').first()`)
3. **No $runIndex without a loop** (workflow uses Split Out, not Split In Batches)
4. **Pre-fetch all reference data** before AI Agent to minimize tool calls

---

## Current State Analysis

### Database Reality

| Metric | Value | Notes |
|--------|-------|-------|
| **Total Orphans** | 515 | Unmatched transactions > 45 days old |
| **Date Range** | Jan 13, 2025 - Oct 25, 2025 | ~10 months of backlog |
| **vendor_rules** | 0 rows | **MUST SEED BEFORE TESTING** |

### Orphan Transaction Types Observed

From the sample data, orphans fall into these categories:

| Type | Example | Handling |
|------|---------|----------|
| **Income/Deposits** | INTUIT deposits (-$28,000) | **EXCLUDE** - Agent 3 territory |
| **Wire Transfers** | WT 250723-159291 NATIONAL WESTMINSTER | Manual review (international) |
| **Standard Expenses** | BURGER JOINT San Francisco CA | Auto-process with vendor_rules |
| **Hotels** | SUBURBAN STUDIOS NJ, SONESTA SELECT | Lodging - COS |
| **Meals** | LONGHORN STEAK, SHANNONS SUB SHOP | Meals - COS |
| **Fuel** | ESSINGTON GAS RT 95 | Fuel - COS |
| **Car Services** | PINNACLE CAR WASH, TURO | Vehicle expenses |

### Critical Insight: Filter Out Income

Agent 2 should **ONLY process positive amounts** (expenses). Negative amounts (credits, deposits, refunds) should be:
- INTUIT deposits → Agent 3 (income reconciliation)
- Refunds → Match to original expense
- Credits → Manual review

---

## Complete n8n Workflow Design

### Workflow Metadata

```
Name: Agent 2 - Orphan Transaction Processor
ID: [NEW - To be created]
Trigger: Schedule (daily 6 AM) OR Manual webhook
```

### Visual Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        TRIGGER SECTION                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────┐         ┌──────────────────┐                         │
│  │   Schedule   │         │  Manual Webhook  │                         │
│  │   Trigger    │         │    (Testing)     │                         │
│  │  (6 AM Daily)│         │                  │                         │
│  └──────┬───────┘         └────────┬─────────┘                         │
│         │                          │                                    │
│         └──────────┬───────────────┘                                    │
│                    ▼                                                    │
│         ┌──────────────────┐                                            │
│         │  Query Orphans   │                                            │
│         │   (Supabase)     │                                            │
│         │  status=unmatched│                                            │
│         │  date < -45 days │                                            │
│         │  amount > 0 ONLY │  ◄── CRITICAL: Exclude income/credits     │
│         └────────┬─────────┘                                            │
│                  │                                                      │
└──────────────────┼──────────────────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    REFERENCE DATA FETCH (Parallel)                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌────────────────┐    ┌────────────────┐    ┌────────────────┐        │
│  │  Fetch Vendor  │    │   Fetch QBO    │    │ Process Orphan │        │
│  │     Rules      │    │   Accounts     │    │    Metadata    │        │
│  │   (Supabase)   │    │   (Supabase)   │    │   (Code Node)  │        │
│  └───────┬────────┘    └───────┬────────┘    └───────┬────────┘        │
│          │                     │                     │                  │
│          └─────────────────────┴─────────────────────┘                  │
│                                │                                        │
│                                ▼                                        │
│                    ┌───────────────────────┐                            │
│                    │  Merge Reference Data │                            │
│                    │    (Merge Node)       │                            │
│                    └───────────┬───────────┘                            │
│                                │                                        │
└────────────────────────────────┼────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      PER-ORPHAN PROCESSING                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────┐                                                    │
│  │    Split Out    │  ◄── Splits orphans array into individual items   │
│  │   (orphans)     │                                                    │
│  └────────┬────────┘                                                    │
│           │                                                             │
│           ▼                                                             │
│  ┌─────────────────┐                                                    │
│  │ Match Vendor &  │  ◄── Code node: finds matching vendor_rule,       │
│  │  Parse State    │      parses state from description                 │
│  │  (Code Node)    │                                                    │
│  └────────┬────────┘                                                    │
│           │                                                             │
│           ▼                                                             │
│  ┌─────────────────┐                                                    │
│  │   AI Agent 2    │  ◄── Claude with 3 tools                          │
│  │  (Anthropic)    │      Receives: orphan + vendor_rule + parsed_state│
│  │                 │      + qbo_accounts in prompt                      │
│  └────────┬────────┘                                                    │
│           │                                                             │
│           ▼                                                             │
│  ┌─────────────────┐                                                    │
│  │ Parse AI Output │  ◄── Extract: APPROVED/FLAGGED, category, state   │
│  │  (Code Node)    │                                                    │
│  └────────┬────────┘                                                    │
│           │                                                             │
│           ▼                                                             │
│  ┌─────────────────┐                                                    │
│  │  IF Approved    │                                                    │
│  │   (IF Node)     │                                                    │
│  └────────┬────────┘                                                    │
│           │                                                             │
│     ┌─────┴─────┐                                                       │
│     ▼           ▼                                                       │
│ [TRUE]      [FALSE]                                                     │
│     │           │                                                       │
│     ▼           ▼                                                       │
│ ┌────────┐  ┌────────────┐                                              │
│ │Mock QBO│  │Queue Review│                                              │
│ │ Post   │  │(Supabase)  │                                              │
│ └───┬────┘  └────────────┘                                              │
│     │                                                                   │
│     ▼                                                                   │
│ ┌───────────────────┐                                                   │
│ │ Update Bank Txn   │  ◄── status='orphan_processed'                   │
│ │ (Supabase Update) │      orphan_category, orphan_state set           │
│ └───────────────────┘                                                   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Node-by-Node Implementation

### Node 1: Schedule Trigger

**Type:** `n8n-nodes-base.scheduleTrigger`
**Purpose:** Run daily at 6 AM

```json
{
  "parameters": {
    "rule": {
      "interval": [
        {
          "field": "cronExpression",
          "expression": "0 6 * * *"
        }
      ]
    }
  },
  "name": "Schedule Trigger",
  "type": "n8n-nodes-base.scheduleTrigger",
  "position": [250, 300]
}
```

### Node 2: Manual Webhook (Testing)

**Type:** `n8n-nodes-base.webhook`
**Purpose:** Manual trigger for testing

```json
{
  "parameters": {
    "httpMethod": "POST",
    "path": "agent2-orphan-processor",
    "responseMode": "onReceived"
  },
  "name": "Manual Webhook",
  "type": "n8n-nodes-base.webhook",
  "position": [250, 450]
}
```

### Node 3: Query Orphans

**Type:** `@n8n/n8n-nodes-supabase.supabase`
**Purpose:** Fetch orphan transactions

**CRITICAL FILTERS:**
1. `status = 'unmatched'`
2. `transaction_date < CURRENT_DATE - 45 days`
3. `amount > 0` (EXCLUDE income/credits)

```json
{
  "parameters": {
    "operation": "getAll",
    "tableId": "bank_transactions",
    "returnAll": false,
    "limit": 50,
    "filters": {
      "conditions": [
        {
          "keyName": "status",
          "condition": "eq",
          "keyValue": "unmatched"
        },
        {
          "keyName": "amount",
          "condition": "gt",
          "keyValue": "0"
        }
      ]
    },
    "options": {
      "customFilterString": "transaction_date.lt.{{ $now.minus({days: 45}).toISODate() }}"
    }
  },
  "name": "Query Orphans",
  "type": "@n8n/n8n-nodes-supabase.supabase",
  "position": [450, 375]
}
```

**Alternative: Use raw SQL via Supabase Function or HTTP Request:**

```sql
SELECT * FROM bank_transactions
WHERE status = 'unmatched'
  AND transaction_date < CURRENT_DATE - INTERVAL '45 days'
  AND amount > 0
ORDER BY transaction_date ASC
LIMIT 50;
```

### Node 4a: Fetch Vendor Rules

**Type:** `@n8n/n8n-nodes-supabase.supabase`

```json
{
  "parameters": {
    "operation": "getAll",
    "tableId": "vendor_rules",
    "returnAll": true
  },
  "name": "Fetch Vendor Rules",
  "type": "@n8n/n8n-nodes-supabase.supabase",
  "position": [650, 275]
}
```

### Node 4b: Fetch QBO Accounts

**Type:** `@n8n/n8n-nodes-supabase.supabase`

```json
{
  "parameters": {
    "operation": "getAll",
    "tableId": "qbo_accounts",
    "returnAll": true
  },
  "name": "Fetch QBO Accounts",
  "type": "@n8n/n8n-nodes-supabase.supabase",
  "position": [650, 375]
}
```

### Node 4c: Process Orphan Metadata

**Type:** `n8n-nodes-base.code`
**Purpose:** Prepare orphans with date range info for batch context

```javascript
// Get orphans from Query Orphans node
const orphans = $('Query Orphans').all().map(item => item.json);

// Calculate stats for AI context
const totalOrphans = orphans.length;
const dateRange = {
  oldest: orphans.length > 0 ? orphans[0].transaction_date : null,
  newest: orphans.length > 0 ? orphans[orphans.length - 1].transaction_date : null
};

// Get unique sources
const sources = [...new Set(orphans.map(o => o.source))];

return [{
  json: {
    orphans: orphans,
    batch_metadata: {
      total_count: totalOrphans,
      date_range: dateRange,
      sources: sources,
      processed_at: new Date().toISOString()
    }
  }
}];
```

### Node 5: Merge Reference Data

**Type:** `n8n-nodes-base.merge`
**Mode:** Combine

```json
{
  "parameters": {
    "mode": "combine",
    "combinationMode": "mergeByPosition",
    "options": {}
  },
  "name": "Merge Reference Data",
  "type": "n8n-nodes-base.merge",
  "position": [850, 375]
}
```

**Output Structure:**
```javascript
{
  orphans: [...],
  batch_metadata: {...},
  vendor_rules: [...],
  qbo_accounts: [...]
}
```

### Node 6: Combine All Reference Data

**Type:** `n8n-nodes-base.code`
**Purpose:** Flatten merged data into clean structure

```javascript
// Get data from all three parallel branches
const orphanData = $('Process Orphan Metadata').first().json;
const vendorRules = $('Fetch Vendor Rules').all().map(item => item.json);
const qboAccounts = $('Fetch QBO Accounts').all().map(item => item.json);

return [{
  json: {
    orphans: orphanData.orphans,
    batch_metadata: orphanData.batch_metadata,
    reference_data: {
      vendor_rules: vendorRules,
      qbo_accounts: qboAccounts
    }
  }
}];
```

### Node 7: Split Out Orphans

**Type:** `n8n-nodes-base.splitOut`

```json
{
  "parameters": {
    "fieldToSplitOut": "orphans",
    "include": "allOtherFields"
  },
  "name": "Split Out Orphans",
  "type": "n8n-nodes-base.splitOut",
  "position": [1050, 375]
}
```

**Each item output:**
```javascript
{
  // Single orphan transaction
  id: "uuid",
  transaction_date: "2025-07-21",
  description: "BURGER JOINT San Francisco CA XXXX1044",
  amount: 6.86,
  source: "amex",
  extracted_vendor: "BURGER JOINT SAN",

  // Reference data carried through
  batch_metadata: {...},
  reference_data: {
    vendor_rules: [...],
    qbo_accounts: [...]
  }
}
```

### Node 8: Match Vendor & Parse State (CRITICAL CODE NODE)

**Type:** `n8n-nodes-base.code`
**Purpose:**
1. Find matching vendor_rule
2. Parse state from description
3. Prepare data for AI Agent

**LESSON FROM AGENT 1:** Use `$input.first()` for data from directly connected previous node.

```javascript
// Get current orphan from Split Out (directly connected)
const inputItem = $input.first();
const orphan = inputItem.json;
const vendorRules = inputItem.json.reference_data?.vendor_rules || [];
const qboAccounts = inputItem.json.reference_data?.qbo_accounts || [];

// === STEP 1: MATCH VENDOR RULES ===
const description = (orphan.description || '').toUpperCase();
const extractedVendor = (orphan.extracted_vendor || '').toUpperCase();

let matchedRule = null;
for (const rule of vendorRules) {
  const pattern = (rule.vendor_pattern || '').toUpperCase();
  if (pattern && (description.includes(pattern) || extractedVendor.includes(pattern))) {
    matchedRule = rule;
    break;
  }
}

// === STEP 2: PARSE STATE FROM DESCRIPTION ===
const statePatterns = [
  { code: 'CA', patterns: [' CA ', ' CA$', ',CA', 'CALIFORNIA'] },
  { code: 'TX', patterns: [' TX ', ' TX$', ',TX', 'TEXAS'] },
  { code: 'CO', patterns: [' CO ', ' CO$', ',CO', 'COLORADO'] },
  { code: 'WA', patterns: [' WA ', ' WA$', ',WA', 'WASHINGTON'] },
  { code: 'NJ', patterns: [' NJ ', ' NJ$', ',NJ', 'NEW JERSEY', 'MILLVILLE NJ', 'JERSEY'] },
  { code: 'FL', patterns: [' FL ', ' FL$', ',FL', 'FLORIDA'] },
  { code: 'MT', patterns: [' MT ', ' MT$', ',MT', 'MONTANA'] },
  { code: 'PA', patterns: [' PA ', ' PA$', ',PA', 'PENNSYLVANIA', 'PHILADELPHIA PA'] },
  { code: 'NY', patterns: [' NY ', ' NY$', ',NY', 'NEW YORK'] },
  { code: 'AZ', patterns: [' AZ ', ' AZ$', ',AZ', 'ARIZONA'] },
  { code: 'NV', patterns: [' NV ', ' NV$', ',NV', 'NEVADA'] },
  { code: 'OR', patterns: [' OR ', ' OR$', ',OR', 'OREGON'] },
  { code: 'NC', patterns: [' NC ', ' NC$', ',NC', 'NORTH CAROLINA'] }
];

let parsedState = null;
for (const state of statePatterns) {
  for (const pattern of state.patterns) {
    if (description.includes(pattern)) {
      parsedState = state.code;
      break;
    }
  }
  if (parsedState) break;
}

// === STEP 3: DETERMINE STATE (WATERFALL) ===
let determinedState = null;
let stateSource = null;

if (matchedRule && matchedRule.default_state) {
  determinedState = matchedRule.default_state;
  stateSource = 'vendor_rules';
} else if (parsedState) {
  determinedState = parsedState;
  stateSource = 'description_parsing';
} else {
  stateSource = 'unknown';
}

// === STEP 4: DETERMINE CATEGORY ===
let determinedCategory = null;
let categorySource = null;

if (matchedRule && matchedRule.default_category) {
  determinedCategory = matchedRule.default_category;
  categorySource = 'vendor_rules';
} else {
  categorySource = 'unknown';
}

// === STEP 5: CALCULATE INITIAL CONFIDENCE ===
let confidence = 100;
if (!matchedRule) confidence -= 30;                    // No vendor rule
if (stateSource === 'description_parsing') confidence -= 10;  // Parsed, not from rules
if (stateSource === 'unknown') confidence -= 40;       // State unknown
if (orphan.amount > 500) confidence -= 20;             // High value
if (orphan.amount < 0) confidence -= 25;               // Credit/refund (shouldn't happen with filter)

// === STEP 6: FIND QBO ACCOUNT ===
let qboExpenseAccount = null;
if (determinedCategory) {
  qboExpenseAccount = qboAccounts.find(acc =>
    acc.zoho_category_match &&
    acc.zoho_category_match.toLowerCase() === determinedCategory.toLowerCase()
  );
}

// Find payment account based on source
let qboPaymentAccount = null;
if (orphan.source === 'amex') {
  qboPaymentAccount = qboAccounts.find(acc => acc.name && acc.name.includes('AMEX'));
} else if (orphan.source === 'wells_fargo' || orphan.source === 'wf_as3dt' || orphan.source === 'wf_as3int') {
  qboPaymentAccount = qboAccounts.find(acc => acc.name && acc.name.includes('Wells Fargo'));
}

// === RETURN ENRICHED ORPHAN ===
return [{
  json: {
    // Original orphan data
    ...orphan,

    // Enrichment results
    vendor_rule_match: matchedRule,
    parsed_state: parsedState,
    determined_state: determinedState,
    state_source: stateSource,
    determined_category: determinedCategory,
    category_source: categorySource,
    initial_confidence: confidence,

    // QBO mapping
    qbo_expense_account: qboExpenseAccount,
    qbo_payment_account: qboPaymentAccount,

    // Keep reference data for AI context
    reference_data: inputItem.json.reference_data
  }
}];
```

### Node 9: AI Agent 2

**Type:** `@n8n/n8n-nodes-langchain.agent`
**Model:** Claude Sonnet 4.5

**Configuration:**
```json
{
  "parameters": {
    "promptType": "define",
    "text": "={{ $json.ai_prompt }}",
    "options": {
      "systemMessage": "={{ $json.system_prompt }}",
      "maxIterations": 6
    }
  }
}
```

**CRITICAL: System prompt and user prompt are built in a Code node BEFORE the AI Agent.**

### Node 8b: Build AI Prompts (Code Node before AI Agent)

**Type:** `n8n-nodes-base.code`
**Purpose:** Build system and user prompts with all context

```javascript
const inputItem = $input.first();
const orphan = inputItem.json;

// Build QBO accounts reference (compact format)
const qboAccounts = orphan.reference_data?.qbo_accounts || [];
const qboRef = qboAccounts.map(acc =>
  `${acc.name}: qbo_id=${acc.qbo_id}, is_cogs=${acc.is_cogs}, zoho_match="${acc.zoho_category_match || 'none'}"`
).join('\n');

// Build vendor rules reference (compact format)
const vendorRules = orphan.reference_data?.vendor_rules || [];
const rulesRef = vendorRules.length > 0
  ? vendorRules.map(r => `"${r.vendor_pattern}": category="${r.default_category}", state="${r.default_state || 'parse'}"`).join('\n')
  : '(No vendor rules configured yet)';

// === SYSTEM PROMPT ===
const systemPrompt = `You are Agent 2: Orphan Transaction Processor for AS3 Driver Training.

## Your Job
Categorize corporate card charges that have NO matching Zoho expense report. These are legitimate business expenses that employees forgot to submit or recurring charges.

## Decision Output Format
Your FIRST word must be: APPROVED or FLAGGED

Then provide:
- Category: [exact category name matching QBO]
- State: [2-letter state code]
- Confidence: [0-100]
- Reason: [brief explanation]

## When to APPROVE (auto-post to QBO)
- Confidence >= 90
- State is determined (not "unknown")
- Category matches a QBO account

## When to FLAG (queue for human review)
- Confidence < 90
- State cannot be determined
- Category unknown
- Amount > $500 (high value needs human eyes)
- Unusual vendor pattern

## State Determination Priority
1. vendor_rules.default_state (if matched)
2. Parse from description (e.g., "CHEVRON SANTA ROSA CA" → CA)
3. If cannot determine → FLAG for human review

## Category Determination
1. vendor_rules.default_category (if matched)
2. Common patterns:
   - Gas stations (CHEVRON, SHELL, PILOT) → "Fuel - COS"
   - Hotels (HAMPTON, MARRIOTT, HILTON, SONESTA, SUBURBAN STUDIOS) → "Lodging - COS"
   - Restaurants/Meals → "Course Catering/Meals - COS"
   - Car wash → "Vehicle (Rent/Wash) - COS"
   - Software subscriptions → "Office Supplies & Software"
3. If cannot determine → FLAG for human review

## State Codes Reference
CA=California, TX=Texas, CO=Colorado, WA=Washington, NJ=New Jersey,
FL=Florida, MT=Montana, PA=Pennsylvania, NY=New York, NC=North Carolina

## QBO Accounts Available
${qboRef}

## Vendor Rules Configured
${rulesRef}

## Tools Available
1. log_categorization - ALWAYS call to create audit trail
2. queue_for_review - Call when flagging for human review

## Important
- Do NOT guess. If uncertain, FLAG.
- "Admin" or "NC" state is for home office expenses
- COS categories are for course-related travel expenses`;

// === USER PROMPT ===
const userPrompt = `ORPHAN TRANSACTION TO PROCESS:

Transaction ID: ${orphan.id}
Date: ${orphan.transaction_date}
Amount: $${orphan.amount}
Source: ${orphan.source}
Description: ${orphan.description}
Extracted Vendor: ${orphan.extracted_vendor || 'Not parsed'}

PRE-ANALYSIS RESULTS:
- Vendor Rule Match: ${orphan.vendor_rule_match ? `YES - Pattern "${orphan.vendor_rule_match.vendor_pattern}", Category="${orphan.vendor_rule_match.default_category}", State="${orphan.vendor_rule_match.default_state || 'not set'}"` : 'NO MATCH'}
- Parsed State: ${orphan.parsed_state || 'Could not parse'}
- Determined State: ${orphan.determined_state || 'Unknown'} (source: ${orphan.state_source})
- Determined Category: ${orphan.determined_category || 'Unknown'} (source: ${orphan.category_source})
- Initial Confidence: ${orphan.initial_confidence}%
- QBO Expense Account: ${orphan.qbo_expense_account ? `${orphan.qbo_expense_account.name} (ID: ${orphan.qbo_expense_account.qbo_id})` : 'Not found'}
- QBO Payment Account: ${orphan.qbo_payment_account ? `${orphan.qbo_payment_account.name} (ID: ${orphan.qbo_payment_account.qbo_id})` : 'Not found'}

Based on this analysis, make your decision. Remember: First word must be APPROVED or FLAGGED.`;

return [{
  json: {
    ...orphan,
    system_prompt: systemPrompt,
    ai_prompt: userPrompt
  }
}];
```

### Node 9: AI Agent 2 - Tool Configuration

**Connected Tools (2-3 only):**

#### Tool 1: log_categorization (Supabase Insert)

```json
{
  "toolDescription": "Log orphan categorization to categorization_history. ALWAYS call this for audit trail.",
  "operation": "insert",
  "tableId": "categorization_history",
  "fieldsUi": {
    "fieldValues": [
      {"fieldId": "source", "fieldValue": "={{ $fromAI('source', 'Transaction source', 'string') }}"},
      {"fieldId": "transaction_date", "fieldValue": "={{ $fromAI('transaction_date', 'YYYY-MM-DD format', 'string') }}"},
      {"fieldId": "vendor_raw", "fieldValue": "={{ $fromAI('vendor_raw', 'Original description', 'string') }}"},
      {"fieldId": "vendor_clean", "fieldValue": "={{ $fromAI('vendor_clean', 'Cleaned vendor name', 'string') }}"},
      {"fieldId": "amount", "fieldValue": "={{ $fromAI('amount', 'number') }}"},
      {"fieldId": "predicted_category", "fieldValue": "={{ $fromAI('predicted_category', 'Category name', 'string') }}"},
      {"fieldId": "predicted_state", "fieldValue": "={{ $fromAI('predicted_state', '2-letter state code', 'string') }}"},
      {"fieldId": "predicted_confidence", "fieldValue": "={{ $fromAI('predicted_confidence', '0-100', 'number') }}"},
      {"fieldId": "bank_transaction_id", "fieldValue": "={{ $fromAI('bank_transaction_id', 'UUID of bank transaction', 'string') }}"}
    ]
  }
}
```

#### Tool 2: queue_for_review (Supabase Insert)

```json
{
  "toolDescription": "Queue orphan for human review when uncertain. Call when flagging.",
  "operation": "insert",
  "tableId": "expense_queue",
  "fieldsUi": {
    "fieldValues": [
      {"fieldId": "zoho_expense_id", "fieldValue": "={{ 'ORPHAN-' + $fromAI('bank_transaction_id') }}"},
      {"fieldId": "vendor_name", "fieldValue": "={{ $fromAI('vendor_name', 'Vendor name', 'string') }}"},
      {"fieldId": "amount", "fieldValue": "={{ $fromAI('amount', 'number') }}"},
      {"fieldId": "expense_date", "fieldValue": "={{ $fromAI('expense_date', 'YYYY-MM-DD', 'string') }}"},
      {"fieldId": "category_suggested", "fieldValue": "={{ $fromAI('category_suggested', 'Suggested category', 'string') }}"},
      {"fieldId": "state_suggested", "fieldValue": "={{ $fromAI('state_suggested', 'Suggested state', 'string') }}"},
      {"fieldId": "confidence_score", "fieldValue": "={{ $fromAI('confidence_score', 'number') }}"},
      {"fieldId": "flag_reason", "fieldValue": "={{ $fromAI('flag_reason', 'Why flagged for review', 'string') }}"},
      {"fieldId": "suggested_bank_txn_id", "fieldValue": "={{ $fromAI('bank_transaction_id', 'UUID', 'string') }}"},
      {"fieldId": "status", "fieldValue": "pending"}
    ]
  }
}
```

### Node 10: Parse AI Decision

**Type:** `n8n-nodes-base.code`
**Purpose:** Extract decision from AI output

```javascript
const inputItem = $input.first();
const aiOutput = inputItem.json.output || inputItem.json.text || '';
const orphanData = inputItem.json;

// Parse first word for decision
const firstWord = aiOutput.trim().split(/\s+/)[0].toUpperCase();
const isApproved = firstWord === 'APPROVED';

// Parse category from output
const categoryMatch = aiOutput.match(/Category:\s*([^\n]+)/i);
const category = categoryMatch ? categoryMatch[1].trim() : orphanData.determined_category;

// Parse state from output
const stateMatch = aiOutput.match(/State:\s*([A-Z]{2})/i);
const state = stateMatch ? stateMatch[1] : orphanData.determined_state;

// Parse confidence from output
const confidenceMatch = aiOutput.match(/Confidence:\s*(\d+)/i);
const confidence = confidenceMatch ? parseInt(confidenceMatch[1]) : orphanData.initial_confidence;

// Parse reason
const reasonMatch = aiOutput.match(/Reason:\s*([^\n]+)/i);
const reason = reasonMatch ? reasonMatch[1].trim() : 'No reason provided';

return [{
  json: {
    // Original orphan data
    id: orphanData.id,
    transaction_date: orphanData.transaction_date,
    description: orphanData.description,
    amount: orphanData.amount,
    source: orphanData.source,
    extracted_vendor: orphanData.extracted_vendor,

    // AI decision
    ai_decision: isApproved ? 'APPROVED' : 'FLAGGED',
    ai_output: aiOutput,

    // Final values (from AI or fallback to pre-analysis)
    final_category: category,
    final_state: state,
    final_confidence: confidence,
    decision_reason: reason,

    // QBO info (if approved)
    qbo_expense_account: orphanData.qbo_expense_account,
    qbo_payment_account: orphanData.qbo_payment_account,

    // Flags
    should_post: isApproved && confidence >= 90 && state && category
  }
}];
```

### Node 11: IF Approved

**Type:** `n8n-nodes-base.if`

```json
{
  "parameters": {
    "conditions": {
      "boolean": [
        {
          "value1": "={{ $json.should_post }}",
          "value2": true
        }
      ]
    }
  },
  "name": "IF Approved",
  "type": "n8n-nodes-base.if",
  "position": [1650, 375]
}
```

### Node 12: Mock QBO Post (TRUE branch)

**Type:** `n8n-nodes-base.code`
**Purpose:** Simulate QBO posting (replace with real HTTP request later)

```javascript
const inputItem = $input.first();
const orphan = inputItem.json;

// In production, this would be an HTTP Request to QBO API
// For now, generate a mock QBO Purchase ID
const mockQboPurchaseId = `MOCK-QBO-${Date.now()}`;

console.log(`[MOCK QBO POST] Would create Purchase:
  - PaymentAccount: ${orphan.qbo_payment_account?.qbo_id || 'unknown'}
  - ExpenseAccount: ${orphan.qbo_expense_account?.qbo_id || 'unknown'}
  - Amount: $${orphan.amount}
  - Memo: ${orphan.description}
  - TxnDate: ${orphan.transaction_date}
  - State: ${orphan.final_state}
`);

return [{
  json: {
    ...orphan,
    qbo_purchase_id: mockQboPurchaseId,
    posted_at: new Date().toISOString()
  }
}];
```

### Node 13: Update Bank Transaction

**Type:** `@n8n/n8n-nodes-supabase.supabase`
**Purpose:** Mark transaction as orphan_processed

```json
{
  "parameters": {
    "operation": "update",
    "tableId": "bank_transactions",
    "matchingColumns": ["id"],
    "fieldsUi": {
      "fieldValues": [
        {"fieldId": "id", "fieldValue": "={{ $json.id }}"},
        {"fieldId": "status", "fieldValue": "orphan_processed"},
        {"fieldId": "orphan_category", "fieldValue": "={{ $json.final_category }}"},
        {"fieldId": "orphan_state", "fieldValue": "={{ $json.final_state }}"},
        {"fieldId": "orphan_determination_method", "fieldValue": "agent_2"},
        {"fieldId": "orphan_processed_at", "fieldValue": "={{ $now.toISO() }}"},
        {"fieldId": "qbo_purchase_id", "fieldValue": "={{ $json.qbo_purchase_id }}"}
      ]
    }
  },
  "name": "Update Bank Transaction",
  "type": "@n8n/n8n-nodes-supabase.supabase",
  "position": [2050, 275]
}
```

---

## Vendor Rules Seed Data

**CRITICAL: Run this BEFORE testing Agent 2**

```sql
-- Seed vendor_rules for common AS3 expense patterns
INSERT INTO vendor_rules (vendor_pattern, default_category, default_state, is_cogs, notes) VALUES
-- Software/Subscriptions (Admin - NC)
('BILL.COM', 'Office Supplies & Software', 'NC', false, 'Accounting software'),
('MICROSOFT', 'Office Supplies & Software', 'NC', false, 'O365, Azure'),
('GOOGLE', 'Office Supplies & Software', 'NC', false, 'Workspace, Cloud'),
('DESCRIPT', 'Office Supplies & Software', 'NC', false, 'Video editing'),
('MEDIUM', 'Office Supplies & Software', 'NC', false, 'Publishing platform'),
('ZOOM', 'Office Supplies & Software', 'NC', false, 'Video conferencing'),
('SLACK', 'Office Supplies & Software', 'NC', false, 'Team messaging'),
('DROPBOX', 'Office Supplies & Software', 'NC', false, 'Cloud storage'),
('ADOBE', 'Office Supplies & Software', 'NC', false, 'Creative suite'),
('CANVA', 'Office Supplies & Software', 'NC', false, 'Design tool'),

-- Gas Stations (COS - state from location)
('CHEVRON', 'Fuel - COS', NULL, true, 'State from description'),
('SHELL', 'Fuel - COS', NULL, true, 'State from description'),
('PILOT', 'Fuel - COS', NULL, true, 'State from description'),
('EXXON', 'Fuel - COS', NULL, true, 'State from description'),
('MOBIL', 'Fuel - COS', NULL, true, 'State from description'),
('76', 'Fuel - COS', NULL, true, 'State from description'),
('ARCO', 'Fuel - COS', NULL, true, 'State from description'),
('COSTCO GAS', 'Fuel - COS', NULL, true, 'State from description'),
('CIRCLE K', 'Fuel - COS', NULL, true, 'State from description'),
('ESSINGTON GAS', 'Fuel - COS', NULL, true, 'State from description'),

-- Hotels (COS - state from location)
('HAMPTON', 'Lodging - COS', NULL, true, 'State from description'),
('MARRIOTT', 'Lodging - COS', NULL, true, 'State from description'),
('HILTON', 'Lodging - COS', NULL, true, 'State from description'),
('HYATT', 'Lodging - COS', NULL, true, 'State from description'),
('SONESTA', 'Lodging - COS', NULL, true, 'State from description'),
('SUBURBAN STUDIOS', 'Lodging - COS', NULL, true, 'State from description'),
('HI EXPRESS', 'Lodging - COS', NULL, true, 'Holiday Inn Express'),
('HOLIDAY INN', 'Lodging - COS', NULL, true, 'State from description'),
('LA QUINTA', 'Lodging - COS', NULL, true, 'State from description'),
('BEST WESTERN', 'Lodging - COS', NULL, true, 'State from description'),
('COMFORT INN', 'Lodging - COS', NULL, true, 'State from description'),
('RESIDENCE INN', 'Lodging - COS', NULL, true, 'State from description'),
('FAIRFIELD', 'Lodging - COS', NULL, true, 'Marriott Fairfield'),

-- Car Rental (COS - state from location)
('HERTZ', 'Vehicle (Rent/Wash) - COS', NULL, true, 'State from description'),
('AVIS', 'Vehicle (Rent/Wash) - COS', NULL, true, 'State from description'),
('ENTERPRISE', 'Vehicle (Rent/Wash) - COS', NULL, true, 'State from description'),
('BUDGET', 'Vehicle (Rent/Wash) - COS', NULL, true, 'State from description'),
('NATIONAL', 'Vehicle (Rent/Wash) - COS', NULL, true, 'State from description'),
('TURO', 'Vehicle (Rent/Wash) - COS', NULL, true, 'Peer car rental'),

-- Car Wash/Service
('CAR WASH', 'Vehicle (Rent/Wash) - COS', NULL, true, 'State from description'),
('PINNACLE CAR WASH', 'Vehicle (Rent/Wash) - COS', NULL, true, 'State from description'),

-- Restaurants/Meals (COS - state from location)
('CHIPOTLE', 'Course Catering/Meals - COS', NULL, true, 'State from description'),
('STARBUCKS', 'Course Catering/Meals - COS', NULL, true, 'State from description'),
('MCDONALDS', 'Course Catering/Meals - COS', NULL, true, 'State from description'),
('SUBWAY', 'Course Catering/Meals - COS', NULL, true, 'State from description'),
('PANERA', 'Course Catering/Meals - COS', NULL, true, 'State from description'),
('LONGHORN', 'Course Catering/Meals - COS', NULL, true, 'State from description'),
('BURGER', 'Course Catering/Meals - COS', NULL, true, 'Various burger joints'),
('SHANNONS SUB', 'Course Catering/Meals - COS', NULL, true, 'Local sub shop'),
('FRINGEBAR', 'Course Catering/Meals - COS', NULL, true, 'State from description'),

-- Airlines (COS - state based on destination, usually flag)
('SOUTHWEST', 'Travel - Courses COS', NULL, true, 'Check destination'),
('UNITED', 'Travel - Courses COS', NULL, true, 'Check destination'),
('DELTA', 'Travel - Courses COS', NULL, true, 'Check destination'),
('AMERICAN AIRLINES', 'Travel - Courses COS', NULL, true, 'Check destination'),
('JETBLUE', 'Travel - Courses COS', NULL, true, 'Check destination'),

-- PayPal/Online (usually flag for review)
('PAYPAL', NULL, NULL, false, 'Review - could be any category')

ON CONFLICT (vendor_pattern) DO NOTHING;

-- Verify insertion
SELECT COUNT(*) as rules_count FROM vendor_rules;
```

---

## Testing Strategy

### Phase 1: Single Orphan Test

1. Manually trigger workflow via webhook
2. Limit query to 1 orphan: `LIMIT 1`
3. Verify:
   - Vendor rule matching works
   - State parsing works
   - AI makes reasonable decision
   - categorization_history record created

### Phase 2: Small Batch Test

1. Increase limit to 5 orphans
2. Verify:
   - Different transaction types handled
   - NJ/PA transactions get correct state
   - Hotels categorized correctly

### Phase 3: Production Run

1. Schedule trigger enabled
2. Process 50 orphans per day
3. Monitor:
   - Success rate
   - Queue for review rate
   - Confidence distribution

---

## Success Criteria

| Metric | Target | Alert Threshold |
|--------|--------|-----------------|
| Auto-process rate | > 60% | < 40% |
| State determination | > 80% | < 60% |
| Category determination | > 70% | < 50% |
| AI iterations | < 4 | > 6 |
| Processing time | < 10s per orphan | > 30s |

---

## Differences from Agent 1 (Lessons Applied)

| Aspect | Agent 1 | Agent 2 | Why |
|--------|---------|---------|-----|
| **Binary data** | Must preserve receipt images | N/A - no receipts | Orphans have no Zoho attachments |
| **Data references** | Complex (had issues) | Simplified with $input.first() | All data flows through single path |
| **vendor_rules** | NOT used | REQUIRED | No Zoho context available |
| **Confidence threshold** | 95% | 90% | More conservative for unverified |
| **Tool count** | 3-4 | 2 | Simpler: just log and queue |
| **Monday.com** | Deferred | Deferred | Focus on QBO first |

---

## Rollback Plan

If Agent 2 causes issues:

1. **Disable Schedule Trigger** in n8n
2. Orphans remain `status='unmatched'` (safe)
3. Check `categorization_history` for any bad entries
4. Check `expense_queue` for incorrect flags
5. Fix issues and re-enable

**Safe because:** Agent 2 only changes orphans > 45 days old. Recent transactions are untouched.

---

## Next Steps After Implementation

1. **Seed vendor_rules** with SQL above
2. **Create workflow** node-by-node
3. **Test with 1 orphan** manually
4. **Enable schedule** when confident
5. **Monitor daily** for first week
6. **Add Teams notification** for flagged items

---

*End of Agent 2 Implementation Guide*
