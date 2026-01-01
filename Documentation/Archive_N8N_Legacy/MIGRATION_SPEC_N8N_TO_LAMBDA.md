# AS3 Auto Bookkeeper: Migration Specification
## Complete n8n Replacement with AWS Lambda/Python

**Document Version:** 2.0
**Created:** December 30, 2025
**Purpose:** Complete system specification for replacing ALL n8n workflows with AWS Lambda/Python

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Why We're Completely Abandoning n8n](#2-why-were-completely-abandoning-n8n)
3. [System Goals](#3-system-goals)
4. [Current Architecture Overview](#4-current-architecture-overview)
5. [n8n Workflows to Replace](#5-n8n-workflows-to-replace)
6. [External System Integrations](#6-external-system-integrations)
7. [Database Schema Reference](#7-database-schema-reference)
8. [Business Rules Engine](#8-business-rules-engine)
9. [Edge Functions Inventory](#9-edge-functions-inventory)
10. [Recommended Lambda Architecture](#10-recommended-lambda-architecture)
11. [File References](#11-file-references)
12. [Migration Checklist](#12-migration-checklist)

---

## 1. Executive Summary

AS3 Driver Training operates a high-performance driver training business across 7 US states (CA, TX, CO, WA, NJ, FL, MT) with admin operations in NC. The expense automation system processes employee expenses from Zoho Expense, validates receipts using AI (Claude), matches to bank transactions, posts to QuickBooks Online, and tracks Cost-of-Sales expenses in Monday.com.

### Current Stack (Being Replaced)
| Component | Technology | Action |
|-----------|------------|--------|
| Workflow Orchestration | n8n Cloud | **REPLACE COMPLETELY** |
| Database | Supabase PostgreSQL | KEEP |
| AI Receipt Validation | Anthropic Claude (via n8n) | MOVE TO DIRECT SDK |
| Web App | React + Vite (AWS Amplify) | KEEP |
| Edge Functions | Supabase Edge Functions (Deno) | EVALUATE |

### Target Stack
| Component | Technology |
|-----------|------------|
| Workflow Orchestration | AWS Lambda (Python) |
| AI Receipt Validation | Anthropic Claude (direct Python SDK) |
| Trigger/Queue | Supabase pg_net triggers → AWS API Gateway → Lambda |
| Secrets | AWS Secrets Manager |
| Monitoring | AWS CloudWatch |

---

## 2. Why We're Completely Abandoning n8n

### Critical n8n Cloud Limitations (Documented and Confirmed)

| Issue | Impact | Source |
|-------|--------|--------|
| `$fromAI()` doesn't work with HTTP Request Tool | Cannot dynamically fetch receipts in AI workflow | GitHub Issue #14274 |
| Binary passthrough to AI causes memory errors | "n8n may have run out of memory" crashes | n8n Cloud logs |
| Base64 images cause token explosion | 200K+ tokens for single image exceeds limits | Claude API limits |
| Cannot configure memory on n8n Cloud | `N8N_DEFAULT_BINARY_DATA_MODE=filesystem` unavailable | n8n Cloud limitation |
| AI Agent architecture not designed for multimodal | Images must be pre-fetched, encoded - fundamentally broken | n8n community consensus |

### Community Consensus
The n8n community has acknowledged that reliable image analysis with Claude requires bypassing the AI Agent entirely. This defeats the purpose of using n8n for AI workflows.

### Decision
**Complete cancellation of n8n.** All workflow logic will be reimplemented in Python running on AWS Lambda with direct Anthropic SDK integration.

---

## 3. System Goals

### Primary Goals
1. **Automate expense categorization** - Target 95%+ auto-approval rate
2. **Ensure accurate state tracking** - Every expense assigned to correct state for tax purposes
3. **Match all expenses to bank transactions** - Bank transactions are the source of truth
4. **Post to QuickBooks Online** - Create Purchase transactions with proper AccountRef, ClassRef, EntityRef
5. **Track COS expenses in Monday.com** - Create subitems under course events for Cost-of-Sales expenses

### Processing Requirements
| Requirement | Specification |
|-------------|---------------|
| Confidence threshold | >= 95% auto-process, < 95% human review |
| Date tolerance for bank matching | ±15 days |
| Amount tolerance for bank matching | ±$0.50 |
| Amount tolerance before flagging | ±$1.00 |
| Max concurrent processing | 5 expenses |
| Processing timeout | 5 minutes |
| Max retry attempts | 3 |

### Three-Agent Architecture
| Agent | Trigger | Purpose | Current Status |
|-------|---------|---------|----------------|
| Agent 1 | Webhook per expense | Process Zoho expenses → bank match → QBO | IN n8n - TO REPLACE |
| Agent 2 | Daily schedule | Process orphan bank transactions (no Zoho match) | NOT YET BUILT |
| Agent 3 | Weekly schedule | Reconcile STRIPE income to WooCommerce | DEFERRED |

---

## 4. Current Architecture Overview

### Data Flow (What Lambda Must Replicate)

```
┌──────────────────────────────────────────────────────────────────────────┐
│                      ZOHO EXPENSE WEBHOOK                                 │
│           POST /functions/v1/receive-zoho-webhook                         │
│           (Supabase Edge Function - KEEP)                                 │
└─────────────────────────────────┬────────────────────────────────────────┘
                                  │
                                  ▼
                    ┌─────────────────────────────┐
                    │   zoho_expense_reports      │  Store report metadata
                    │   zoho_expenses             │  Store expenses + receipts
                    │   status = 'pending'        │
                    └─────────────┬───────────────┘
                                  │
                                  │ PostgreSQL Trigger fires
                                  ▼
                    ┌─────────────────────────────────────────────────────┐
                    │ process_expense_queue() trigger                      │
                    │ Currently: pg_net.http_post() → n8n webhook          │
                    │ NEW: pg_net.http_post() → AWS API Gateway → Lambda   │
                    └──────────────────────┬──────────────────────────────┘
                                           │
                                           ▼
                    ┌─────────────────────────────────────────────────────┐
                    │           LAMBDA FUNCTION (replaces n8n)             │
                    │  1. Fetch expense from Supabase                      │
                    │  2. Fetch receipt (signed URL from Storage)          │
                    │  3. AI validate receipt (direct Anthropic SDK)       │
                    │  4. Match to bank transaction                        │
                    │  5. Determine state (Zoho tag or Monday event)       │
                    │  6. Lookup/Create QBO Vendor                         │
                    │  7. Create QBO Purchase                              │
                    │  8. Upload receipt to QBO                            │
                    │  9. Create Monday.com subitem (if COS)               │
                    │ 10. Update database records                          │
                    └──────────────────────┬──────────────────────────────┘
                                           │
                       ┌───────────────────┼───────────────────┐
                       │                   │                   │
                       ▼                   ▼                   ▼
             ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
             │ bank_transactions│ │ QuickBooks      │ │ Monday.com      │
             │ status='matched' │ │ Purchase        │ │ Subitem         │
             └─────────────────┘ └─────────────────┘ └─────────────────┘
```

### Database Trigger Update Required

The `process_expense_queue()` PostgreSQL function currently calls n8n. This URL must be updated to call AWS Lambda instead.

**Current trigger target (n8n):**
```
https://as3driving.app.n8n.cloud/webhook/process-expense
```

**New trigger target (Lambda via API Gateway):**
```
https://{api-gateway-id}.execute-api.{region}.amazonaws.com/prod/process-expense
```

---

## 5. n8n Workflows to Replace

### 5.1 Workflow: Agent 1 - Queue Based v3.0

**Workflow ID:** `ZpsBzIO0oXaEnKIR`
**Status:** Active, Production
**Node Count:** 54 nodes
**Trigger:** Webhook at `/webhook/process-expense`

#### Purpose
Processes individual Zoho expenses triggered by the database queue controller. Validates receipts, matches to bank transactions, posts to QBO, and creates Monday.com subitems for COS expenses.

#### Processing Flow (Logic to Replicate)

| Step | Operation | Data Source | Output |
|------|-----------|-------------|--------|
| 1 | Receive webhook | pg_net trigger | `expense_id` |
| 2 | Fetch expense details | Supabase `zoho_expenses` table | Full expense record |
| 3 | Update status to 'processing' | Supabase | - |
| 4 | Calculate date range | Expense date ±15 days | `date_start`, `date_end` |
| 5 | Fetch bank transactions | Supabase `bank_transactions` filtered by date range and source | Array of candidates |
| 6 | Match bank transaction | Matching algorithm (see Section 8) | Best match or multiple candidates |
| 7 | Fetch receipt from storage | Supabase Storage signed URL | Receipt image URL |
| 8 | AI validate receipt | Claude API (DIRECT - not via n8n) | Extracted merchant, amount, date, confidence |
| 9 | Check if COS expense | Category ends with "- COS" | Boolean |
| 10 | IF COS: Query Monday.com | Monday.com GraphQL API | Course events in date range |
| 11 | IF COS: Filter Monday events | Match expense date to event dates, prefer state match | Matched event |
| 12 | Determine final state | Zoho tag → Monday event → fallback | State code (CA, TX, etc.) |
| 13 | Fetch QBO accounts | Supabase `qbo_accounts` table | Payment and expense account IDs |
| 14 | Fetch QBO class | Supabase `qbo_classes` by state code | QBO Class ID |
| 15 | Lookup QBO vendor | QBO Query API with fuzzy match | Vendor ID or null |
| 16 | IF no vendor: Create vendor | QBO Create Vendor API | New Vendor ID |
| 17 | IF confidence >= 95%: Create QBO Purchase | QBO Create Purchase API | Purchase ID |
| 18 | IF has receipt: Upload to QBO | QBO Attachable API (multipart) | Attachable ID |
| 19 | Update bank_transactions | Set status='matched', matched_expense_id, qbo_purchase_id | - |
| 20 | Update zoho_expenses | Set status='posted', qbo_purchase_id, processed_at | - |
| 21 | Insert categorization_history | Audit trail record | - |
| 22 | IF COS + has revenue item: Create Monday subitem | Monday.com GraphQL or Edge Function | Subitem ID |
| 23 | Update Monday IDs | Store monday_subitem_id in zoho_expenses | - |
| 24 | IF confidence < 95%: Flag expense | Set status='flagged', flag_reason | - |
| 25 | IF error: Log error | Insert into processing_errors, send Teams notification | - |

#### Key Decision Points

| Condition | Action |
|-----------|--------|
| Confidence >= 95% AND good bank match | Auto-approve, post to QBO |
| Confidence < 95% | Flag for human review |
| No bank match found | Flag with reason "no_match" |
| Multiple bank matches (ambiguous) | Flag with reason "multiple_matches_review" |
| Receipt amount differs by > $1 | Flag with reason "amount_mismatch" |
| Missing QBO account mapping | Flag with reason "missing_qbo_account_mapping" |
| COS expense but no Monday event found | Process anyway, but note missing event |

---

### 5.2 Workflow: Human Approved Processor V1.0

**Workflow ID:** `frdajPUqVg1XGydM`
**Status:** Active, Production
**Node Count:** 36 nodes
**Trigger:** Webhook at `/webhook/human-approved-processor`

#### Purpose
Processes expenses that have been manually reviewed and approved by humans via the web app. Bypasses AI validation since human already approved. Posts directly to QBO and creates Monday.com subitems.

#### Input Payload (from Web App)
The web app sends a POST request with this payload structure:
- `zoho_expense_id` - Zoho expense identifier
- `amount` - Expense amount
- `expense_date` - Transaction date
- `merchant_name` - Vendor name
- `category_name` - Zoho category
- `state` - State code (already determined by human)
- `state_tag` - Original Zoho tag
- `paid_through` - Payment account name
- `receipt_storage_path` - Path in Supabase Storage
- `receipt_content_type` - MIME type
- `bank_transaction_id` - Matched bank transaction (human selected)
- `vendor_clean` - Cleaned vendor name
- `monday_event_id` - Optional: matched Monday event
- `monday_event_name` - Optional: event name
- `monday_venue` - Optional: venue name
- `expense_id` - Supabase UUID (internal ID)

#### Processing Flow (Logic to Replicate)

| Step | Operation | Data Source | Output |
|------|-----------|-------------|--------|
| 1 | Receive webhook | Web app POST | Full expense payload |
| 2 | Extract/normalize fields | Input payload | Standardized fields |
| 3 | Lookup QBO accounts | Supabase `qbo_accounts` | Payment + expense account IDs |
| 4 | Determine payment type | paid_through field | "CreditCard" or "Check" |
| 5 | Check if COS expense | Category ends with "- COS" | Boolean |
| 6 | IF COS: Query Monday.com for events | Monday.com GraphQL | Events in date range |
| 7 | IF COS: Filter/match Monday events | Date overlap + state match bonus | Best matching event |
| 8 | Lookup QBO class | Supabase `qbo_classes` by state | QBO Class ID |
| 9 | Query QBO vendor | QBO Query API | Vendor ID or null |
| 10 | IF no vendor: Create vendor | QBO Create Vendor API | New Vendor ID |
| 11 | Validate QBO requirements | Check expense_account_id and payment_account_id exist | Pass/Fail |
| 12 | IF valid: Create QBO Purchase | QBO Create Purchase API | Purchase ID |
| 13 | IF success + has receipt: Fetch receipt | Supabase Storage | Binary image |
| 14 | IF has receipt: Prepare multipart upload | Create form data with metadata | Upload payload |
| 15 | Upload receipt to QBO | QBO Attachable API | Attachable ID |
| 16 | Update bank_transactions | Set status='matched', qbo_purchase_id, matched_by='human' | - |
| 17 | Update zoho_expenses | Set status='posted', qbo_purchase_id, qbo_posted_at | - |
| 18 | Delete old categorization_history | Remove any previous record for this expense | - |
| 19 | Insert categorization_history | New audit record with was_corrected=false | - |
| 20 | Query Revenue Tracker board | Monday.com board 18381611621 | Revenue items |
| 21 | Match revenue item | Find item linked to training calendar event | Revenue item ID |
| 22 | IF has revenue item: Build subitem request | Prepare payload | JSON for Edge Function |
| 23 | Create Monday subitem | POST to Edge Function | Subitem ID |
| 24 | Update Monday IDs | Store IDs in zoho_expenses | - |
| 25 | IF error at any step: Log error | Insert processing_errors, update status='error' | - |
| 26 | IF flagged: Send Teams notification | Microsoft Teams API | Message ID |

#### Key Differences from Agent 1

| Aspect | Agent 1 | Human Approved Processor |
|--------|---------|-------------------------|
| AI Validation | Yes (Claude) | No (human already approved) |
| Bank Matching | Algorithm-based | Pre-matched by human |
| Confidence Check | Yes (>= 95%) | No (always proceed) |
| State Determination | Waterfall logic | Pre-determined by human |
| Entry Point | pg_net queue trigger | Web app direct call |

---

## 6. External System Integrations

### 6.1 Zoho Expense

| Setting | Value |
|---------|-------|
| Base URL | `https://www.zohoapis.com/expense/v1` |
| Organization ID | `867260975` |
| Webhook URL | `https://fzwozzqwyzztadxgjryl.supabase.co/functions/v1/receive-zoho-webhook` |
| Authentication | OAuth 2.0 with auto-refresh |

**Key Data Points:**
- `expense_report.expenses[]` - Array of individual expenses
- `line_items[0].tags` - "Course Location" tag containing state (e.g., "California - CA")
- `receipts[]` - Receipt image URLs from Zoho
- `paid_through.name` - Payment account identifier ("AMEX", "Wells Fargo Debit")

**Date Format Warning:**
Zoho may send dates in DD/MM/YYYY format. The AI must extract the actual date from the receipt and compare to detect inversions.

### 6.2 QuickBooks Online

| Setting | Value |
|---------|-------|
| Base URL | `https://quickbooks.api.intuit.com/v3` |
| Company ID | `123146088634019` |
| Authentication | OAuth 2.0 (tokens expire in 60 minutes) |
| Minor Version | 65 |

**Required Operations:**

| Operation | Method | Endpoint |
|-----------|--------|----------|
| Query Vendor | GET | `/company/{id}/query?query=SELECT * FROM Vendor WHERE DisplayName LIKE '%{name}%'` |
| Create Vendor | POST | `/company/{id}/vendor` |
| Create Purchase | POST | `/company/{id}/purchase` |
| Upload Attachment | POST | `/company/{id}/upload` (multipart/form-data) |

**CRITICAL API LIMITATIONS:**

| What Does NOT Work | Required Workaround |
|-------------------|---------------------|
| QBO Tags via API | Use ClassRef for state tracking instead |
| Bank Feed "For Review" API | Create Purchase transactions directly |

**Payment Account IDs:**
| Account | QBO ID |
|---------|--------|
| AMEX | 99 |
| Wells Fargo | 49 |

**QBO Class IDs (State Tracking):**
| State | QBO Class ID |
|-------|--------------|
| CA | 1000000004 |
| TX | 1000000006 |
| CO | 1000000007 |
| WA | 1000000008 |
| NJ | 1000000009 |
| FL | 1000000010 |
| MT | 1000000011 |
| NC (Admin) | 1000000012 |

### 6.3 Monday.com

| Setting | Value |
|---------|-------|
| API URL | `https://api.monday.com/v2` |
| Authentication | Bearer Token |
| Training Calendar Board | 8294758830 |
| Course Revenue Tracker Board | 18381611621 |
| Subitems Board | 18381637294 |

**Board Structure:**
- Training Calendar (8294758830) contains course events with dates and venues
- Course Revenue Tracker (18381611621) links to Training Calendar via board relation
- Subitems are created under Course Revenue Tracker items to track expenses per event

**Subitem Column IDs:**
| Column ID | Purpose | Value Format |
|-----------|---------|--------------|
| `text_mkxs8ntt` | Concept/Category | String |
| `status` | Payment Status | `{"label": "Paid"}` |
| `date0` | Expense Date | `{"date": "2025-12-04"}` |
| `numeric_mkxs13eg` | Amount | String number (e.g., "52.96") |

**GraphQL Queries Needed:**
1. Query Training Calendar for events in date range (for COS state determination)
2. Query Revenue Tracker for items linked to calendar events
3. Create subitem mutation

### 6.4 Anthropic Claude

| Setting | Value |
|---------|-------|
| Model | `claude-sonnet-4-20250514` |
| Max Tokens | 1024 |
| Integration | Direct Python SDK (NOT via n8n) |

**Receipt Validation Task:**
1. Accept receipt image via signed URL from Supabase Storage
2. Extract: merchant name, amount, date, location
3. Compare extracted values to Zoho expense data
4. Detect date inversions (DD/MM vs MM/DD)
5. Return confidence score and extracted values

**AI Prompt Reference:** See `Documentation/Technical_Docs/AGENT1_AI_PROMPT.md`

---

## 7. Database Schema Reference

### Primary Tables

#### `zoho_expenses` (277 rows)
Central processing table with status state machine.

| Key Column | Type | Purpose |
|------------|------|---------|
| `id` | uuid | Primary key (Supabase internal) |
| `zoho_expense_id` | text | Zoho's expense ID (UNIQUE) |
| `zoho_report_id` | text | FK to zoho_expense_reports |
| `expense_date` | date | Transaction date |
| `amount` | numeric | Expense amount |
| `vendor_name` | text | Merchant name from Zoho |
| `category_name` | text | Zoho category |
| `state_tag` | text | "Course Location" tag value |
| `receipt_storage_path` | text | Path in Supabase Storage |
| `status` | text | pending/processing/posted/flagged/error |
| `bank_transaction_id` | uuid | FK to matched bank transaction |
| `match_confidence` | integer | 0-100 |
| `qbo_purchase_id` | text | Created QBO Purchase ID |
| `monday_subitem_id` | text | Created Monday subitem ID |
| `original_amount` | numeric | Before AI auto-correction |
| `original_expense_date` | date | Before AI auto-correction |

**Status State Machine:**
- `pending` → Initial state after webhook ingestion
- `processing` → Claimed by queue controller
- `posted` → Successfully posted to QBO
- `flagged` → Needs human review
- `error` → Processing failed (max retries exceeded)
- `duplicate` → Already processed

#### `bank_transactions` (882 rows)
Source of truth for all financial activity.

| Key Column | Type | Purpose |
|------------|------|---------|
| `id` | uuid | Primary key |
| `source` | text | Account key (amex_1234, wells_fargo, etc.) |
| `transaction_date` | date | Bank date |
| `amount` | numeric | Transaction amount |
| `description` | text | Raw bank description |
| `extracted_vendor` | text | Cleaned vendor name |
| `status` | text | unmatched/matched/excluded/orphan_processed |
| `matched_expense_id` | text | Zoho expense ID if matched |
| `matched_by` | text | 'agent' or 'human' |
| `qbo_purchase_id` | text | QBO Purchase ID |

**Unique Constraint:** `(source, transaction_date, amount, description_normalized)`

#### `categorization_history` (290 rows)
Audit trail for learning and compliance.

| Key Column | Type | Purpose |
|------------|------|---------|
| `zoho_expense_id` | text | UNIQUE - one record per expense |
| `predicted_category` | text | AI/system prediction |
| `predicted_state` | text | AI/system prediction |
| `predicted_confidence` | integer | Confidence score |
| `final_category` | text | Actual (may differ after correction) |
| `final_state` | text | Actual |
| `was_corrected` | boolean | Learning flag |
| `bank_transaction_id` | uuid | FK to matched bank transaction |

**CRITICAL:** Insert exactly ONE record per expense. Delete old record before inserting new.

#### `qbo_classes` (8 rows)
State code to QBO Class ID mapping.

| state_code | qbo_class_id |
|------------|--------------|
| CA | 1000000004 |
| TX | 1000000006 |
| CO | 1000000007 |
| WA | 1000000008 |
| NJ | 1000000009 |
| FL | 1000000010 |
| MT | 1000000011 |
| NC | 1000000012 |

#### `qbo_accounts` (78 rows)
QBO account mappings with category matching.

| Key Column | Type | Purpose |
|------------|------|---------|
| `qbo_id` | text | QBO Account ID |
| `name` | text | Account name |
| `zoho_category_match` | text | Maps to Zoho category_name |
| `is_payment_account` | boolean | True for AMEX, Wells Fargo |
| `is_cogs` | boolean | True for Cost of Sales accounts |

#### `vendor_rules` (56 rows)
Pattern matching for orphan processing (Agent 2 only).

| Key Column | Type | Purpose |
|------------|------|---------|
| `vendor_pattern` | text | Regex pattern |
| `vendor_name_clean` | text | Normalized name |
| `default_category` | text | Fallback category |
| `default_state` | text | Fallback state |
| `is_cogs` | boolean | Cost of Sales flag |

**Note:** Used ONLY by Agent 2 (orphan processor), NOT by Agent 1.

### Key Database Functions

#### `process_expense_queue()` - REQUIRES URL UPDATE
Queue controller trigger that dispatches expenses to processing.

**Current behavior:**
- Counts expenses with status='processing' (max 5 concurrent)
- Claims next 'pending' expense with FOR UPDATE SKIP LOCKED
- Sets status='processing', increments processing_attempts
- Calls n8n webhook via pg_net.http_post()

**Required change:** Update URL from n8n to Lambda endpoint.

#### `recover_stuck_expenses()`
Finds expenses stuck in 'processing' > 5 minutes.
- If attempts < 3: Reset to pending
- If attempts >= 3: Mark as error

#### `manual_reset_expense(expense_id, reset_attempts)`
Manual intervention to reset expense to pending state.

---

## 8. Business Rules Engine

### 8.1 Bank Transaction Matching

**Input:** Expense with amount, date, merchant_name
**Output:** Best matching bank transaction or flag for review

**Algorithm Steps:**

1. **Filter candidates** by source (paid_through) and date range (±15 days)

2. **For each candidate, calculate:**
   - Amount match: absolute difference ≤ $0.01
   - Date match: days difference ≤ 15
   - Merchant match: any word (4+ chars) from merchant_name found in bank description

3. **Score assignment:**
   | Condition | Score | Type |
   |-----------|-------|------|
   | Amount + Date + Merchant | 100 | exact |
   | Amount + Date | 90 | amount_date_match |
   | Amount + Merchant | 80 | amount_merchant_match |
   | Amount only | 70 | amount_only_match |
   | Restaurant with tip (18-25% over) + Date | 75 | restaurant_with_tip |

4. **Collect all matches with score >= 70**

5. **Sort by:** score descending, then days_diff ascending

6. **Decision:**
   - If 2+ matches: return `multiple_matches_review` flag
   - If 1 match: return best match
   - If 0 matches: return `no_match` flag

**Reference:** `Documentation/Technical_Docs/AGENT1_MATCH_BANK_TRANSACTION_CODE.md`

### 8.2 State Determination Waterfall

**Priority Order:**

1. **Zoho "Course Location" Tag** (highest priority)
   - Parse tag like "California - CA" → extract "CA"
   - Special case: "Other" → "NC" (admin/home office)

2. **Monday.com Event Venue** (for COS expenses)
   - Query events where expense_date falls within start_date to end_date (±2 days buffer)
   - Extract state from venue address
   - Prefer events matching expense's existing state hint

3. **Fallback**
   - If no state determined: flag for manual review

### 8.3 Confidence Scoring

**Base Score from Bank Match:**
| Match Type | Base Score |
|------------|------------|
| exact | 100 |
| pre_matched_manual | 100 |
| amount_date_match | 95 |
| amount_merchant_match | 90 |
| amount_only_match | 70 |
| no_match | 50 |

**Deductions:**
| Condition | Deduction |
|-----------|-----------|
| Receipt amount differs by > $1 | -20 |
| Receipt unreadable | -15 |
| No receipt attached | -10 |

**Final score capped at 0-100 range.**

### 8.4 Approval Decision

| Condition | Decision |
|-----------|----------|
| Confidence >= 85 AND match_type in [exact, pre_matched_manual, amount_date_match, amount_merchant_match] | APPROVED |
| All other cases | FLAGGED |

---

## 9. Edge Functions Inventory

### Functions to KEEP (Supabase)

| Function | Purpose | Called By |
|----------|---------|-----------|
| `receive-zoho-webhook` | Ingest Zoho webhooks, store expenses, download receipts | Zoho (external) |
| `fetch-receipt` | Serve receipt images from Storage | Lambda (for AI) |
| `create-monday-subitem` | Create Monday.com subitems (avoids GraphQL escaping issues) | Lambda |

### Functions to MOVE to Lambda

| Function | Purpose | Reason to Move |
|----------|---------|----------------|
| `validate-receipt` | AI receipt validation with Claude | Better Claude SDK integration in Python |

### Location References

| File | Purpose |
|------|---------|
| `supabase/functions/receive-zoho-webhook/index.ts` | Webhook intake, receipt download |
| `supabase/functions/fetch-receipt/index.ts` | Receipt serving from Storage |
| `supabase/functions/create-monday-subitem/index.ts` | Monday.com subitem creation |
| `supabase/functions/validate-receipt/index.ts` | Current AI validation (to move) |

---

## 10. Recommended Lambda Architecture

### Lambda Functions

| Function | Trigger | Purpose |
|----------|---------|---------|
| `process-expense` | API Gateway POST | Main expense processing (replaces Agent 1) |
| `human-approved` | API Gateway POST | Human-approved processing (replaces Human Approved Processor) |
| `validate-receipt` | Invoked by above | AI receipt validation with Claude |
| `recover-stuck` | CloudWatch Events (every 5 min) | Reset stuck expenses |
| `process-orphans` | CloudWatch Events (daily) | Agent 2 - orphan processing |

### Infrastructure Diagram

```
┌────────────────────────────────────────────────────────────────────┐
│                         AWS INFRASTRUCTURE                          │
├────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                     API GATEWAY                               │   │
│  │  POST /process-expense     ← Supabase pg_net trigger         │   │
│  │  POST /human-approved      ← Web app direct call             │   │
│  └──────────────────────┬──────────────────────────────────────┘   │
│                         │                                           │
│                         ▼                                           │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    LAMBDA FUNCTIONS                           │   │
│  │                                                               │   │
│  │  process-expense        human-approved       validate-receipt │   │
│  │  (main AI flow)         (no AI, direct)      (Claude SDK)     │   │
│  │                                                               │   │
│  │  recover-stuck          process-orphans                       │   │
│  │  (scheduled)            (scheduled - Agent 2)                 │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                         │                                           │
│  ┌──────────────────────┼──────────────────────────────────────┐   │
│  │               SECRETS MANAGER                                │   │
│  │  SUPABASE_URL, SUPABASE_SERVICE_KEY                          │   │
│  │  ANTHROPIC_API_KEY                                           │   │
│  │  QBO_CLIENT_ID, QBO_CLIENT_SECRET, QBO_REFRESH_TOKEN         │   │
│  │  MONDAY_API_KEY                                              │   │
│  │  N8N_WEBHOOK_SECRET (for Edge Function auth)                 │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                         │                                           │
│  ┌──────────────────────┼──────────────────────────────────────┐   │
│  │               CLOUDWATCH                                     │   │
│  │  Logs, Metrics, Alarms                                       │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              │ HTTPS
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    SUPABASE (EXTERNAL)                               │
│  PostgreSQL + Storage + Edge Functions                               │
│  (Database, receipts, webhook intake, Monday subitem creation)       │
└─────────────────────────────────────────────────────────────────────┘
```

### Python Dependencies

- `anthropic` - Claude API SDK
- `supabase` - Supabase Python client
- `httpx` - HTTP client for QBO and Monday.com APIs
- `python-dateutil` - Date parsing and manipulation
- `boto3` - AWS SDK (for Secrets Manager)

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Service role key (full database access) |
| `ANTHROPIC_API_KEY` | Claude API key |
| `QBO_CLIENT_ID` | QuickBooks OAuth client ID |
| `QBO_CLIENT_SECRET` | QuickBooks OAuth client secret |
| `QBO_REFRESH_TOKEN` | QBO refresh token (auto-refresh on use) |
| `QBO_COMPANY_ID` | `123146088634019` |
| `MONDAY_API_KEY` | Monday.com API token |
| `N8N_WEBHOOK_SECRET` | Used for Edge Function authentication |

---

## 11. File References

### Documentation Files

| File | Purpose |
|------|---------|
| `Documentation/GOALS.md` | Business objectives and success metrics |
| `Documentation/Technical_Docs/SYSTEM_BOUNDARIES.md` | Component responsibilities - READ FIRST |
| `Documentation/expense-automation-architecture.md` | System design overview |
| `Documentation/database-schema.md` | Table structures |
| `Documentation/api-integration-guide.md` | External API specifications |
| `Documentation/n8n-workflow-spec.md` | Workflow specifications |
| `Documentation/Technical_Docs/PROJECT_CHANGELOG.md` | Historical fixes and lessons learned |

### AI Prompt Reference

| File | Purpose |
|------|---------|
| `Documentation/Technical_Docs/AGENT1_AI_PROMPT.md` | Claude system prompt for receipt validation |
| `Documentation/Technical_Docs/AGENT1_MATCH_BANK_TRANSACTION_CODE.md` | Bank matching algorithm logic |
| `Documentation/Technical_Docs/AGENT1_COMPLETE_FIX_DEC29.md` | Recent fixes and workarounds |

### Edge Functions

| File | Purpose |
|------|---------|
| `supabase/functions/receive-zoho-webhook/index.ts` | Webhook intake |
| `supabase/functions/fetch-receipt/index.ts` | Receipt serving |
| `supabase/functions/create-monday-subitem/index.ts` | Monday.com integration |
| `supabase/functions/validate-receipt/index.ts` | Current AI validation (to migrate) |

### Web App (Context)

| File | Purpose |
|------|---------|
| `expense-dashboard/src/features/review/services/reviewActions.ts` | Calls Human Approved Processor webhook |
| `expense-dashboard/src/features/dashboard/ExceptionDashboard.tsx` | Main review queue UI |

---

## 12. Migration Checklist

### Phase 1: AWS Infrastructure Setup
- [ ] Create AWS account with appropriate IAM roles
- [ ] Set up API Gateway with two endpoints: `/process-expense` and `/human-approved`
- [ ] Configure API Gateway authentication (API key or IAM)
- [ ] Set up Secrets Manager with all API keys
- [ ] Create Lambda function shells with Python 3.11 runtime
- [ ] Configure CloudWatch log groups

### Phase 2: Core Lambda - process-expense
- [ ] Implement Supabase client initialization
- [ ] Implement expense fetching from database
- [ ] Implement date range calculation (±15 days)
- [ ] Implement bank transaction query with filters
- [ ] Implement bank matching algorithm
- [ ] Implement receipt URL generation (signed URL)
- [ ] Implement Claude API integration for receipt validation
- [ ] Implement state determination waterfall
- [ ] Implement confidence scoring
- [ ] Implement decision logic (approve/flag)

### Phase 3: QBO Integration
- [ ] Implement OAuth token refresh mechanism
- [ ] Implement vendor lookup with fuzzy matching
- [ ] Implement vendor creation
- [ ] Implement Purchase creation with all required fields
- [ ] Implement receipt upload (multipart form-data)
- [ ] Test full QBO flow with real credentials

### Phase 4: Monday.com Integration
- [ ] Implement GraphQL queries for Training Calendar
- [ ] Implement event filtering and matching
- [ ] Implement Revenue Tracker item lookup
- [ ] Test Edge Function call for subitem creation

### Phase 5: Human Approved Lambda
- [ ] Implement human-approved endpoint
- [ ] Implement simplified flow (no AI validation)
- [ ] Implement same QBO/Monday flows as process-expense
- [ ] Test with web app integration

### Phase 6: Database Trigger Update
- [ ] Update `process_expense_queue()` function URL
- [ ] Test single expense end-to-end
- [ ] Verify queue controller behavior
- [ ] Test concurrent processing (max 5)

### Phase 7: Scheduled Functions
- [ ] Implement `recover-stuck` Lambda
- [ ] Configure CloudWatch Events rule (every 5 minutes)
- [ ] Test stuck expense recovery

### Phase 8: Monitoring and Alerting
- [ ] Set up CloudWatch alarms for errors
- [ ] Configure Teams notifications for failures
- [ ] Create dashboard for monitoring

### Phase 9: Cutover
- [ ] Disable n8n workflows
- [ ] Verify all processing routes to Lambda
- [ ] Monitor for 24-48 hours
- [ ] Confirm n8n subscription cancellation

---

## Appendix: Known Issues and Gotchas

### From Historical Fixes

1. **Apostrophes in vendor names** - Must escape with double single-quote for QBO queries
2. **Date inversions** - AI must extract RECEIPT_DATE and compare to detect DD/MM vs MM/DD
3. **Duplicate categorization_history** - Delete old record before inserting new one
4. **QBO token expiry** - Tokens expire in 60 minutes, implement auto-refresh
5. **Monday.com column_values** - Must be stringified JSON in mutations
6. **Binary data** - Use signed URLs for Claude, never embed base64 in prompts
7. **Concurrent processing** - Max 5 enforced by queue controller, respect SKIP LOCKED

### From n8n Limitations (No Longer Relevant After Migration)

- `$fromAI()` expression issues - N/A
- Binary passthrough memory errors - N/A
- AI Agent iteration limits - N/A

---

**End of Migration Specification**

*This document provides the complete specification for replacing all n8n Cloud workflows with AWS Lambda/Python infrastructure. It contains no implementation code - only specifications, data flows, and business rules.*
