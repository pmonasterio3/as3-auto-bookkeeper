# AS3 Expense Automation System
## Architecture & Implementation Plan

**Version:** 3.1 - Queue-Based Architecture (COMPLETE ✅)
**Date:** December 16, 2025
**Completion Date:** December 16, 2025
**Author:** Pablo Ortiz-Monasterio / Claude  

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Business Context](#business-context)
3. [Current State: What We Built](#current-state-what-we-built)
4. [The Wall: Why It Failed](#the-wall-why-it-failed)
5. [Proposed Solution: Queue-Based Architecture](#proposed-solution-queue-based-architecture)
6. [System Architecture](#system-architecture)
7. [Data Model](#data-model)
8. [Component Specifications](#component-specifications)
9. [Integration Points](#integration-points)
10. [Implementation Phases](#implementation-phases)
11. [Success Criteria](#success-criteria)

---

## Executive Summary

AS3 Driver Training operates across seven U.S. states (CA, TX, CO, WA, NJ, FL, MT) and requires precise expense categorization by state for tax compliance. The company discovered significant California tax overpayment due to expenses being incorrectly attributed to California when they occurred in other states.

This document describes an automated expense processing system with **queue-based, memory-efficient architecture** that:
- **Supabase-First Ingestion**: Zoho webhooks go to Edge Functions (NOT n8n) to decouple ingestion from processing
- **Single-Expense Processing**: n8n processes ONE expense at a time with fresh memory per execution
- **Self-Healing Queue**: Database triggers automatically dispatch pending expenses, maintaining 5 concurrent executions max
- **Memory Isolation**: Eliminates n8n memory issues by avoiding loops and binary data duplication
- Imports bank transactions weekly as the source of truth
- Identifies reimbursements (Zoho expense with no bank match = personal card requiring receipt upload)
- Categorizes expenses by type (Course-related vs Admin) and state
- Posts validated expenses to QuickBooks Online
- Learns from human corrections to improve over time

**See Also:** `Documentation/GOALS.md` for authoritative system goals.

**Architecture Evolution:** Version 3.0 introduces queue-based processing to solve n8n Cloud memory limitations (188MB+ memory usage with 23-expense batches). Previous architecture attempted to process entire expense reports in a single execution, causing memory exhaustion and workflow failures.

---

## Business Context

### The Company

AS3 Driver Training LLC (part of AS3 International, Inc.) is a specialized high-performance driver training company serving security, law enforcement, and military markets. Training courses are delivered at various venues across the United States:

| State | Venues |
|-------|--------|
| California | Laguna Seca, Willow Springs, Sonoma, Crows Landing |
| Texas | Texas Motor Speedway |
| Colorado | Western Colorado Dragway |
| Washington | Evergreen Speedway, Pacific Raceways |
| New Jersey | New Jersey Motorsports Park |
| Florida | South Florida Fairgrounds |
| Montana | Gallatin County Fairgrounds |

### The Problem

1. **Tax Overpayment**: Expenses were being attributed to California by default, causing overpayment of California state taxes when expenses actually occurred in other states.

2. **Manual Categorization**: The bookkeeper and CPA manually categorize hundreds of expenses monthly, a time-consuming and error-prone process.

3. **No Course-Level Tracking**: Cannot determine profitability of individual training courses because expenses are not linked to specific events.

4. **Disconnected Systems**: Zoho Expense, QuickBooks Online, and Monday.com operate independently without data flow between them.

### Financial Systems in Use

| System | Purpose | Role in Solution |
|--------|---------|------------------|
| **Zoho Expense** | Expense submission by employees | Source of expense claims with receipts |
| **QuickBooks Online** | Accounting, tax reporting | Destination for categorized expenses |
| **Monday.com** | Course scheduling, CRM | Source of event/venue data, destination for course expenses |
| **American Express** | Primary corporate card | Bank feed in QBO, source of transactions |
| **Wells Fargo** | Secondary payment method | Bank feed in QBO, source of transactions |

---

## Current State: What We Built

### n8n Workflow Architecture

We built an n8n workflow with an AI Agent (Claude via Anthropic node) that processes expenses from Zoho webhooks.

**Workflow Components:**

```
Webhook (Zoho) 
    → Split Out (separate each expense in report)
    → Edit Fields (extract key fields)
    → HTTP Request (fetch receipt image)
    → Merge (combine expense + receipt)
    → AI Agent (Claude)
        ├── Tool: check_duplicate (Supabase)
        ├── Tool: vendor_rules (Supabase)
        ├── Tool: get_monday_events (Monday.com)
        ├── Tool: categorization_history (Supabase - insert)
        ├── Tool: flagged_expenses (Supabase - insert)
        ├── Tool: qbo_accounts (Supabase)
        ├── Tool: check_qbo_duplicate (QBO API)
        ├── Tool: post_to_qbo (QBO API)
        └── Tool: Teams notification (Microsoft Teams)
```

### Supabase Tables Created

**categorization_history**
- Logs every expense processed
- Tracks predicted vs final category/state
- Records confidence scores
- Links to Zoho expense ID, Monday event ID, QBO transaction ID

**vendor_rules**
- Known vendor patterns
- Default category and state assignments
- Enables consistent categorization of recurring vendors

**flagged_expenses**
- Queue of expenses requiring human review
- Stores reason for flagging
- Tracks resolution status

**qbo_accounts**
- Mirror of QuickBooks Chart of Accounts
- Maps Zoho categories to QBO account IDs
- Separates payment accounts from expense accounts
- Flags COS (Cost of Sales) vs Admin accounts

### System Prompt Logic

The AI Agent was instructed to:

1. **Check for duplicates** in Supabase before processing
2. **Determine expense type**: COS (Course-related) vs Non-COS (Admin)
3. **Check vendor rules** for known patterns
4. **Analyze receipt** to validate amount and extract merchant info
5. **Link to Monday event** (for COS expenses only)
6. **Determine state** from event venue (COS) or Zoho tag (Non-COS)
7. **Calculate confidence** based on validation results
8. **Log to categorization_history**
9. **Check QBO for duplicate** Purchase before posting
10. **Post to QBO** if confidence >= 95%, else flag for review
11. **Notify Teams** if flagged

### What Worked

- Zoho webhook successfully triggers workflow
- Receipt images are fetched and passed to AI
- AI can analyze receipts and extract amount/vendor/date
- Supabase tables store data correctly
- Monday.com API returns event data
- QBO API accepts Purchase creation requests
- Basic categorization logic is sound

---

## The Wall: Why It Failed

### Problem 1: Agent Iteration Limit

**Symptom**: `Max iterations (10) reached. The agent could not complete the task within the allowed number of iterations.`

**Cause**: The AI Agent has 9 tools attached. A single expense requires 8-9 tool calls minimum:
1. check_duplicate
2. vendor_rules
3. get_monday_events
4. categorization_history (insert)
5. qbo_accounts (payment lookup)
6. qbo_accounts (expense lookup)
7. check_qbo_duplicate
8. post_to_qbo
9. teams_notify (if flagging)

n8n's AI Agent has a default limit of 10 iterations. Even without errors, we're at the edge. Any retry or clarification pushes over the limit.

### Problem 2: QBO Bank Feed API Limitation

**Symptom**: Cannot query or categorize bank feed transactions via API.

**Cause**: QuickBooks Online deliberately does not expose bank feed ("For Review") transactions through their API. This is documented as a permanent limitation due to:
- Economic constraints (Plaid/Yodlee per-access costs)
- Security concerns about programmatic bank account access

**Impact**: Our original goal was to categorize bank feed transactions directly. This is impossible via API. The only programmatic option is to:
- Create Purchase records via API
- Hope QBO auto-suggests matching them to bank feed transactions
- Human clicks "Accept Match" in QBO UI

### Problem 3: Duplicate Records

**Symptom**: Same expense appears 3-4 times in categorization_history.

**Cause**: The duplicate check (Step 0) was either:
- Not being called first (agent skipped it)
- Agent ignored the results
- Supabase query returned before previous insert committed

**Evidence**:
```
zoho_expense_id: 5647323000000867498 (Aho LLC $52.96) - 4 records
zoho_expense_id: 5647323000000878003 (Hernandez Tire $50.00) - 3 records
```

### Problem 4: COS vs Non-COS Logic Confusion

**Symptom**: Non-COS expenses (e.g., "Fuel - Company Vehicle Non-Course Expense") were triggering Monday.com event lookups unnecessarily.

**Cause**: The system prompt had conflicting instructions:
- One section said "Skip Monday query for Non-COS"
- Another section said "Always find related event in Monday"

The agent followed whichever instruction it encountered first.

### Problem 5: Wrong Tag Extraction

**Symptom**: State was coming through as "Other" instead of "California".

**Cause**: Zoho expenses have two tag types:
- California track tag: `tag_name: "California"` → `tag_option_name: "Other"`
- Course Location tag: `tag_name: "Course Location"` → `tag_option_name: "California"`

The Edit Fields node was extracting the wrong one.

### Problem 6: Zoho-QBO Native Sync Conflict

**Symptom**: Expenses appearing in QBO twice.

**Cause**: Zoho Expense has a native QBO integration that was still enabled. Both Zoho AND our n8n workflow were creating QBO records.

**Resolution**: Zoho → QBO sync has been disabled. n8n now owns QBO posting.

### Problem 7: Report-Level Context Ignored

**Symptom**: Agent treating each expense independently, missing obvious patterns.

**Cause**: Zoho sends expense reports, not individual expenses. A report named "C24 - ACADS - CL - Aug 12-13" contains all the context needed:
- C24 = Course year code
- ACADS = Course type
- CL = Crows Landing (California)
- Aug 12-13 = Date range

But the agent was parsing each expense without this report-level context, then querying Monday.com individually for each expense to find the same event over and over.

### Problem 8: n8n Memory Exhaustion (v2.0 Architecture Failure) - SOLVED ✅

**Symptom**: Multi-expense reports (15-23 expenses) cause n8n workflow to stall or crash mid-execution.

**Cause**: n8n Cloud doesn't release memory between loop iterations:
- Binary data (receipts ~1-3MB each) duplicated at every Code node
- 23 expenses × ~8MB (binary + JSON per expense) = ~188MB+ memory footprint
- Exceeds n8n Cloud memory limits
- Loop architecture fundamentally incompatible with binary data at scale

**Evidence**: Single-expense reports process successfully, multi-expense reports fail consistently after processing 8-12 expenses.

**Impact**: Cannot process typical expense reports (average 15+ expenses per course).

**SOLUTION (December 16, 2025):** Queue-based architecture v3.0 with Supabase-first ingestion. Each expense processed independently with fresh memory. See "Queue-Based Architecture" section below.

---

## Proposed Solution: Queue-Based Architecture

### Core Philosophy Change

**v1.0 approach**: AI agent does everything, queries all data, makes all decisions.

**v2.0 approach**: Pre-fetch data, provide context, AI agent validates and decides, humans handle edge cases, system learns.

**v3.0 approach (This Document)**: Decouple ingestion from processing. Store expenses in database queue, process one at a time with fresh memory, use database triggers for automatic dispatch.

### Key Design Principles

1. **Bank transactions are source of truth** (Unchanged)
   - Import AMEX/Wells Fargo statements to Supabase
   - Every expense must match exactly one bank transaction
   - A bank transaction can only be matched once (prevents duplicates)
   - 45-day grace period before declaring transaction "orphan"

2. **Memory isolation through queue architecture** (NEW in v3.0)
   - Zoho webhook → Edge Function → Database storage (NOT n8n)
   - Receipts stored in Supabase Storage (not passed through n8n repeatedly)
   - n8n receives ONLY an `expense_id` (UUID), fetches data fresh per execution
   - Each expense processed independently with isolated memory
   - Maximum 5 concurrent n8n executions (database-enforced)

3. **Self-healing queue system** (NEW in v3.0)
   - PostgreSQL triggers automatically dispatch pending expenses
   - `FOR UPDATE SKIP LOCKED` prevents race conditions
   - Queue continues processing after failures (doesn't block other expenses)
   - Failed expenses remain in queue for retry or manual intervention
   - Observable state machine: pending → processing → posted/error/flagged

4. **Human in the loop for uncertainty** (Unchanged)
   - If AI confidence < 95%, queue for human review
   - Web dashboard shows pending items with receipt upload capability
   - Human corrections feed back into vendor_rules
   - ZELLE/VENMO payments ARE Zoho expenses (Wells Fargo Debit), require receipt upload

5. **Critical clarifications** (Unchanged)
   - "Other" state tag in Zoho = NC (admin/home office state)
   - Credits/refunds must match to original transaction, post to SAME QBO account
   - Employee reimbursements paid through QBO directly, not tracked here
   - Monday.com integration DEFERRED until QBO flows solid
   - Report-level context: Parse report name to determine COS/Non-COS, extract venue/dates

6. **State determination sources** (Unchanged)
   - Zoho expenses: Use "Course Location" tag (primary for Non-COS)
   - COS expenses: Use Monday.com event venue (query API directly, NOT database)
   - Orphans: vendor_rules.default_state → description parsing → course proximity → manual

---

## System Architecture

### High-Level Data Flow: Queue-Based Processing

**Architecture Overview:**

The v3.0 architecture decouples data ingestion from processing to eliminate n8n memory issues:

1. **Supabase Edge Function** receives Zoho webhooks and stores expenses
2. **Database triggers** automatically dispatch pending expenses to n8n
3. **n8n workflows** process ONE expense at a time with fresh memory
4. **Queue self-heals** by triggering the next expense when current one completes

```
┌────────────────────────────────────────────────────────────────────────────────┐
│                        QUEUE-BASED ARCHITECTURE                                │
│                        (Supabase-First Ingestion)                              │
└────────────────────────────────────────────────────────────────────────────────┘

    ┌─────────────┐         ┌──────────────────────┐
    │    ZOHO     │────────>│  Edge Function       │
    │   EXPENSE   │ webhook │  receive-zoho-webhook│
    │   APPROVED  │         └──────────┬───────────┘
    └─────────────┘                    │
                                       │ 1. Parse JSON
                                       │ 2. Download receipts → Supabase Storage
                                       │ 3. INSERT into zoho_expenses table
                                       ▼
    ┌──────────────────────────────────────────────────────────────────────────┐
    │                         SUPABASE                                          │
    │  ┌─────────────────┐    ┌─────────────────────────────────────────────┐  │
    │  │ zoho_expenses   │    │ process_expense_queue() TRIGGER             │  │
    │  ├─────────────────┤    │                                             │  │
    │  │ status:pending  │───>│ 1. Count currently processing < 5?          │  │
    │  │ status:processing│   │ 2. FOR UPDATE SKIP LOCKED (claim expense)   │  │
    │  │ status:posted   │<──│ 3. pg_net.http_post → n8n webhook           │  │
    │  └─────────────────┘    └─────────────────────────────────────────────┘  │
    │                                                                          │
    │  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────────┐  │
    │  │  Supabase       │    │ bank_transactions│    │ qbo_accounts        │  │
    │  │  Storage        │    │ (source of truth)│    │ vendor_rules        │  │
    │  │  (receipts)     │    │                 │    │ qbo_classes         │  │
    │  └─────────────────┘    └─────────────────┘    └─────────────────────┘  │
    └──────────────────────────────────────────────────────────────────────────┘
                                       │
                                       │ HTTP POST: { expense_id: UUID }
                                       ▼
    ┌──────────────────────────────────────────────────────────────────────────┐
    │                           n8n WORKFLOW                                    │
    │                     (Single Expense Processing)                           │
    │                                                                          │
    │   ┌───────────┐    ┌───────────┐    ┌───────────┐    ┌───────────────┐  │
    │   │  Webhook  │───>│  Fetch    │───>│  Fetch    │───>│  AI Agent     │  │
    │   │  Trigger  │    │  Expense  │    │  Receipt  │    │  Processing   │  │
    │   │(expense_id)    │  from DB  │    │  from     │    │               │  │
    │   └───────────┘    └───────────┘    │  Storage  │    └───────┬───────┘  │
    │                                     └───────────┘            │          │
    │                                                              ▼          │
    │   ┌───────────────────────────────────────────────────────────────────┐ │
    │   │  Match to Bank Transaction → QBO Posting → Update Status         │ │
    │   └───────────────────────────────────────────────────────────────────┘ │
    └──────────────────────────────────────────────────────────────────────────┘
                                       │
                                       │ UPDATE zoho_expenses SET status = 'posted'
                                       ▼
    ┌────────────────────────────────────────────────────────────────────────┐
    │              QUEUE SELF-HEALING                                        │
    │                                                                        │
    │   UPDATE triggers process_expense_queue() again                        │
    │   → Claims next pending expense                                        │
    │   → Continues until queue is empty                                     │
    └────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                    BANK TRANSACTIONS (SOURCE OF TRUTH)                  │
│                                                                         │
│   AMEX Statement ──────┐        Imported weekly by team member          │
│   (CSV from QBO)       │        (Sunday or Monday)                      │
│                        ├──→ Supabase: bank_transactions                 │
│   Wells Fargo ─────────┘    Status: 'unmatched' initially               │
│   (CSV from QBO)                                                        │
└─────────────────────────────────────────────────────────────────────────┘
```

### Key Benefits of Queue Architecture

1. **Memory Isolation**: Each n8n execution processes ONE expense with fresh memory (~8MB vs 188MB+)
2. **Self-Healing**: Failures don't block other expenses; queue continues processing
3. **Idempotent Ingestion**: ON CONFLICT ensures re-submitted reports don't duplicate
4. **Race-Condition Safe**: FOR UPDATE SKIP LOCKED prevents double-processing
5. **Observable**: All expense states visible in database (pending/processing/posted/error)
6. **Retryable**: Failed expenses can be reset to 'pending' for reprocessing
7. **Scalable**: Max concurrent limit (5) prevents n8n overload

### Transaction Matching Rules

| Scenario | What Happens | Outcome |
|----------|--------------|---------|
| Zoho expense matches bank txn | Normal flow | Auto-process or review queue |
| Zoho expense, no bank match | Reimbursement | Flag for review, mark as personal card |
| Bank txn, no Zoho expense | Orphan | Use vendor_rules, or flag for review |
| Bank txn already matched | Skip | Prevents duplicate processing |

### Component Overview

| Component | Technology | Purpose |
|-----------|------------|---------|
| Bank Transaction Import | Web App + Supabase | Upload CSV statements, parse, store |
| Expense Matcher | n8n + AI Agent | Match Zoho expenses to bank transactions |
| Review Dashboard | Web App (React) | Human review of flagged expenses |
| QBO Poster | n8n HTTP Request | Create Purchase records in QuickBooks |
| Monday Tracker | n8n Monday.com node | Add expenses as subitems to events |
| Learning Engine | Supabase triggers | Update vendor_rules from corrections |

---

## Data Model

### Supabase Schema

#### zoho_expenses (NEW in v3.0)
The queue table. All Zoho expenses are stored here immediately upon webhook receipt.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| zoho_expense_id | TEXT | Zoho expense identifier (unique) |
| zoho_report_id | TEXT | Zoho report identifier |
| zoho_report_name | TEXT | Report name (contains course context) |
| raw_payload | JSONB | Complete Zoho expense JSON |
| expense_date | DATE | Transaction date |
| amount | DECIMAL(10,2) | Expense amount |
| merchant_name | TEXT | Vendor/merchant name |
| category_name | TEXT | Zoho category |
| state_tag | TEXT | "Course Location" tag from Zoho |
| paid_through | TEXT | Payment account name |
| receipt_storage_path | TEXT | Path in Supabase Storage |
| receipt_content_type | TEXT | MIME type (image/jpeg, application/pdf) |
| status | TEXT | 'pending', 'processing', 'matched', 'posted', 'flagged', 'error' |
| processing_attempts | INT | Retry counter |
| processing_started_at | TIMESTAMPTZ | When n8n claimed this expense |
| last_error | TEXT | Error message if failed |
| bank_transaction_id | UUID | FK to bank_transactions (set by n8n) |
| match_confidence | INT | 0-100 confidence score |
| qbo_purchase_id | TEXT | QBO Purchase ID after posting |
| qbo_posted_at | TIMESTAMPTZ | When posted to QBO |
| created_at | TIMESTAMPTZ | When expense was received |
| processed_at | TIMESTAMPTZ | When processing completed |

**Indexes:**
- `idx_zoho_expenses_status` on (status)
- `idx_zoho_expenses_pending` on (status, created_at) WHERE status = 'pending'
- `idx_zoho_expenses_processing` on (status, processing_started_at) WHERE status = 'processing'

**Unique constraint**: zoho_expense_id (prevents duplicate ingestion)

**Status State Machine:**
- `pending` → Waiting to be processed
- `processing` → Currently being processed by n8n
- `matched` → Matched to bank transaction, awaiting QBO post
- `posted` → Successfully posted to QBO
- `flagged` → Needs human review (low confidence)
- `error` → Processing failed (see last_error)

#### bank_transactions
The anchor table. Every corporate card expense must match to exactly one record here.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| source | TEXT | 'amex' or 'wells_fargo' |
| transaction_date | DATE | When transaction occurred |
| post_date | DATE | When posted to account |
| description | TEXT | Raw bank description |
| amount | DECIMAL(10,2) | Transaction amount |
| card_last_four | TEXT | Last 4 of card number (from description) |
| extracted_state | TEXT | State parsed from description (CA, TX, etc.) |
| extracted_vendor | TEXT | Vendor name parsed from description |
| status | TEXT | 'unmatched', 'matched', 'excluded', 'orphan_processed' |
| matched_expense_id | TEXT | zoho_expense_id when matched |
| matched_at | TIMESTAMPTZ | When match occurred |
| matched_by | TEXT | 'agent' or 'human' |
| qbo_purchase_id | TEXT | QBO Purchase ID after posting |
| monday_subitem_id | TEXT | Monday subitem ID after posting |
| created_at | TIMESTAMPTZ | Import timestamp |

**Unique constraint**: (source, transaction_date, amount, description_normalized)

**Status Values:**
- `unmatched` - Waiting for Zoho expense to claim it
- `matched` - Linked to a Zoho expense
- `excluded` - Manually marked as not an expense (transfers, payments)
- `orphan_processed` - No Zoho expense, but processed via vendor_rules

#### expense_queue (extended for reimbursements)

| Column | Type | Description |
|--------|------|-------------|
| ... | ... | (existing columns) |
| is_reimbursement | BOOLEAN | True if no bank match (personal card) |
| reimbursement_method | TEXT | 'check', 'zelle', 'payroll', etc. |
| reimbursed_at | TIMESTAMPTZ | When reimbursement was processed |

#### expense_queue
Human review queue for uncertain matches.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| zoho_expense_id | TEXT | Zoho expense identifier |
| status | TEXT | 'pending', 'approved', 'corrected', 'rejected' |
| vendor_name | TEXT | Merchant name |
| amount | DECIMAL(10,2) | Claimed amount |
| expense_date | DATE | Transaction date |
| receipt_url | TEXT | URL to receipt image |
| category_suggested | TEXT | AI's category prediction |
| state_suggested | TEXT | AI's state prediction |
| confidence_score | INTEGER | 0-100 confidence |
| flag_reason | TEXT | Why flagged |
| suggested_bank_txn_id | UUID | Best-guess bank transaction match |
| reviewed_by | TEXT | Who reviewed |
| reviewed_at | TIMESTAMPTZ | When reviewed |
| corrections | JSONB | {category, state, event_id, bank_txn_id, notes} |
| created_at | TIMESTAMPTZ | When queued |

#### Existing Tables (Keep As-Is)

- **categorization_history**: Continue logging all processed expenses
- **vendor_rules**: Continue storing learned patterns
- **flagged_expenses**: Merge functionality into expense_queue
- **qbo_accounts**: Keep for account ID lookups

**IMPORTANT: monday_events table does NOT exist**
- Monday.com events are queried directly from Monday.com API when needed (GraphQL)
- n8n workflows query Monday.com API directly, NOT a local cache
- No local storage of Monday events
- See `SYSTEM_BOUNDARIES.md` for clarification

---

## Component Specifications

### 1. Web Application

**Purpose**: Human interface for bank import, expense review, and pattern management.

**Technology**: React (Vite), Tailwind CSS, Supabase client, hosted on AWS Amplify.

**Pages**:

| Page | Functionality |
|------|---------------|
| Dashboard | Unmatched bank txn count, pending reviews, orphans, recent activity |
| Import Transactions | CSV upload for AMEX/Wells Fargo, preview before import, duplicate detection |
| Review Queue | Zoho expenses flagged for review, approve/correct/reject actions |
| Orphan Queue | Bank transactions with no Zoho match, categorize or exclude |
| Reimbursement Queue | Zoho expenses with no bank match, mark as reimbursable |
| Match View | Side-by-side: bank transaction + Zoho expense + receipt |
| Vendor Rules | View/add/edit vendor patterns with default category/state |
| Reports | Expenses by state, category, course, month |

**Three Review Queues:**
1. **Review Queue** - Zoho expenses matched to bank but low confidence
2. **Orphan Queue** - Bank transactions needing categorization (no Zoho expense)
3. **Reimbursement Queue** - Zoho expenses to reimburse (no bank match = personal card)

**Authentication**: Supabase Auth with email/password. Initially just Pablo and Ashley.

### 2. Supabase Edge Function: receive-zoho-webhook (NEW in v3.0)

**Purpose**: Receive Zoho expense reports, download receipts, store in database queue.

**Endpoint**: `https://[project-ref].supabase.co/functions/v1/receive-zoho-webhook`

**Technology**: Deno/TypeScript deployed as Supabase Edge Function

**Process Flow**:
1. Receive Zoho webhook POST with full expense report JSON
2. Parse report metadata (report_id, report_name)
3. For each expense in report:
   - Extract key fields (expense_id, date, amount, merchant, category, state_tag)
   - Download receipt image from Zoho API
   - Upload receipt to Supabase Storage: `expense-receipts/{report_id}/{expense_id}.{ext}`
   - INSERT into `zoho_expenses` table with status='pending'
   - Use ON CONFLICT (zoho_expense_id) to prevent duplicates
4. Return success response to Zoho

**Triggers**: Database INSERT trigger fires `process_expense_queue()` automatically

**Error Handling**:
- Failed receipt downloads: Store expense without receipt, flag for review
- Duplicate expense_id: Skip silently (idempotent)
- Supabase errors: Return 500, Zoho will retry webhook

**Code Reference**: See `supabase/functions/receive-zoho-webhook/index.ts` (to be created)

### 3. Database Queue Controller (NEW in v3.0)

**Purpose**: Automatically dispatch pending expenses to n8n for processing.

**Technology**: PostgreSQL function + triggers + pg_net extension

**Function**: `process_expense_queue()`

**Logic**:
1. Count expenses WHERE status='processing' (max 5 concurrent)
2. If slots available:
   - SELECT next pending expense FOR UPDATE SKIP LOCKED
   - UPDATE status='processing', processing_started_at=NOW()
   - Call n8n webhook via `pg_net.http_post(url, body)`
3. Repeat until queue empty or max concurrent reached

**Triggers**:
- **After INSERT** on zoho_expenses → Call queue controller
- **After UPDATE** on zoho_expenses WHERE NEW.status IN ('posted', 'error', 'flagged') → Call queue controller

**Self-Healing**: When an expense completes, the UPDATE trigger automatically processes the next one.

**Race Condition Prevention**: `FOR UPDATE SKIP LOCKED` ensures no two concurrent calls claim the same expense.

**Code Reference**: See `database-schema.md` for SQL implementation

### 4. n8n Workflow: process-expense (REVISED for v3.0)

**Trigger**: Webhook receives `{ expense_id: UUID }`

**Goal**: Process ONE expense with fresh memory. No loops. No binary duplication.

```
Webhook (Receives expense_id)
    │
    ▼
Fetch Expense (Supabase Query)
    - SELECT * FROM zoho_expenses WHERE id = expense_id
    - Includes: amount, date, merchant, state_tag, category, receipt_storage_path
    │
    ▼
Fetch Receipt (Supabase Storage Download)
    - GET from Storage: receipt_storage_path
    - Binary data loaded fresh (not duplicated from previous iteration)
    │
    ▼
Fetch Reference Data (Supabase - parallel queries)
    - qbo_accounts (all)
    - qbo_classes (all state mappings)
    - bank_transactions WHERE status='unmatched' AND date BETWEEN expense_date-3 AND expense_date+3
    │
    ▼
AI Agent (4-5 tools max)
    │
    │  CONTEXT IN PROMPT:
    │  - Expense details (from database fetch)
    │  - Receipt image (from storage)
    │  - QBO account mappings
    │  - Potential bank matches
    │
    │  DECISION TREE:
    │  ├── Bank match found + Confidence >= 95%
    │  │       → Tool: lookup_or_create_vendor (QBO API)
    │  │       → Tool: post_to_qbo (QBO API with ClassRef)
    │  │       → Tool: attach_receipt_to_qbo (QBO Attachable API)
    │  │       → Tool: update_expense_status (Supabase: status='posted')
    │  │       → Tool: update_bank_transaction (Supabase: status='matched')
    │  │
    │  ├── Bank match found + Confidence < 95%
    │  │       → Tool: update_expense_status (Supabase: status='flagged')
    │  │       → Tool: insert_expense_queue (for human review)
    │  │
    │  └── No bank match found
    │          → Tool: update_expense_status (Supabase: status='flagged')
    │          → Tool: insert_expense_queue (reimbursement=true)
    │
    ▼
Log to categorization_history (Final Step)
    - Record outcome, confidence, decisions made
```

**Key Differences from v2.0**:
- NO Split Out / Loop Over Items
- Receipt loaded from Storage (not passed through multiple nodes)
- Single expense processing ensures memory isolation
- Queue controller handles iteration (not n8n workflow)

### 5. n8n Workflow: orphan-processor (Unchanged)

**Trigger**: Scheduled batch (daily) or manual

**Purpose**: Process bank transactions with no Zoho match after 45-day grace period.

```
Schedule Trigger (Daily) or Manual Trigger
    │
    ▼
Query Orphan Transactions (Supabase)
    - bank_transactions WHERE status='unmatched'
    - AND transaction_date < NOW() - 45 days
    │
    ▼
Fetch Reference Data (Supabase)
    - vendor_rules (all)
    - qbo_accounts (all)
    - qbo_classes (all)
    │
    ▼
For Each Orphan:
    │
    ▼
State Determination Waterfall (Code Node)
    │
    ├── 1. Check vendor_rules.default_state
    │       If vendor pattern matches → Use that state
    │
    ├── 2. Parse bank description
    │       Extract city/state from description text
    │       (e.g., "CHEVRON SANTA ROSA CA" → CA)
    │
    ├── 3. Date proximity to course
    │       If transaction_date is during a known course → Use course state
    │
    └── 4. Cannot determine
            → Insert to orphan_review queue in web app
    │
    ▼
If State Determined:
    │
    ├── Category from vendor_rules.default_category
    │   (or flag if unknown vendor)
    │
    ├── POST to QBO
    │
    ├── Update bank_transactions.status = 'orphan_processed'
    │
    └── Log to categorization_history
```

**Note**: This workflow continues to use loop architecture because orphan counts are typically low (< 10 per batch), so memory is not an issue.

### 6. AI Agent (Revised for v3.0)

**Context Delivery**: All context provided in the system prompt (no tool calls for reads).

**Tool Calls**: Only for writes (QBO API, database updates).

The agent receives all context in the prompt and only calls tools for writes.

**Core Logic**:

1. **Duplicate Check**: Compare zoho_expense_id to similar_records in context. Same ID = skip.

2. **Bank Transaction Match**: Find bank transaction in potential_matches where:
   - Amount matches exactly (within $0.50 for rounding)
   - Date matches (±3 days for posting delay)
   - If multiple matches, use vendor name similarity

3. **Category Validation**:
   - COS report → category should end in "- COS"
   - Non-COS report → category should NOT end in "- COS"
   - Check vendor_rules for known patterns

4. **State Assignment**:
   - COS: Use venue from monday_event in context
   - Non-COS: Use Course Location tag from Zoho

5. **Confidence Calculation**:
   - Start at 100
   - No bank match found: -40
   - Receipt amount mismatch: -30
   - No receipt: -25
   - COS without event: -40
   - State unclear: -20

6. **Decision**:
   - Confidence >= 95 AND bank match found → Post to QBO
   - Else → Queue for review

### 7. Monday.com Integration (DEFERRED)

**Board**: Course Revenue Tracker

**Subitem Structure**: Each course event can have expense subitems.

| Column | Type | Content |
|--------|------|---------|
| Name | TEXT | "[Vendor] - [Category]" |
| Amount | NUMBER | Expense amount |
| Date | DATE | Transaction date |
| State | STATUS | State code |
| Zoho ID | TEXT | Reference back to Zoho |
| QBO ID | TEXT | Reference to QBO Purchase |

**Trigger**: After successful QBO post, create subitem under matched event.

### 8. QBO Integration

**Goal:** Match the feature set of Zoho's native QBO integration while maintaining bank_transactions as source of truth.

**Implementation:** Multi-node n8n workflow with QBO API calls. See `Technical_Docs/QBO_LIVE_IMPLEMENTATION.md` for complete specification.

**Key Components:**

1. **Vendor Lookup/Create**
   - Query: `SELECT * FROM Vendor WHERE DisplayName = 'MerchantName'`
   - Create if not found: `POST /vendor` with DisplayName
   - Result: vendor_id to include in Purchase EntityRef

2. **State Tracking via Classes**
   - Lookup qbo_class_id from qbo_classes table by state_code
   - Include ClassRef.value in Purchase Line item
   - 8 Classes created in QBO: CA, TX, CO, WA, NJ, FL, MT, NC

3. **Purchase Creation**
   - Endpoint: `POST /v3/company/123146088634019/purchase?minorversion=65`
   - AccountRef: Payment account (AMEX=99, Wells Fargo=49)
   - PaymentType: "CreditCard" or "Check"
   - TxnDate: Transaction date
   - EntityRef: Vendor ID (improves bank feed matching)
   - Line[].AccountBasedExpenseLineDetail.AccountRef: Expense category account
   - Line[].AccountBasedExpenseLineDetail.ClassRef: State class ID
   - PrivateNote: "Zoho: [ID] | State: [code] | Vendor: [name] | Bank: [txn_id]"

4. **Receipt Attachment**
   - Endpoint: `POST /v3/company/123146088634019/upload?minorversion=65`
   - Format: multipart/form-data with 2 parts:
     - Part 1 (file_metadata_0): JSON with AttachableRef linking to Purchase
     - Part 2 (file_content_0): Binary receipt image
   - Result: Receipt viewable in QBO Purchase record

**Post-Processing**: After QBO returns Purchase ID, update:
- bank_transactions.qbo_purchase_id
- bank_transactions.qbo_vendor_id
- categorization_history.qbo_transaction_id

**Feature Parity with Zoho Native Integration:**

| Feature | Zoho Native | Our Integration |
|---------|-------------|-----------------|
| Vendor matching | ✅ | ✅ |
| Receipt attachment | ✅ | ✅ |
| State tracking | ✅ Classes | ✅ Classes |
| Payment account mapping | ✅ | ✅ |
| Expense account mapping | ✅ | ✅ |
| Bank feed matching hints | ✅ | ✅ (via EntityRef) |

---

## Integration Points

### Zoho Expense → Supabase Edge Function (NEW in v3.0)

**Trigger**: Webhook on expense report approval
**Endpoint**: `https://[project-ref].supabase.co/functions/v1/receive-zoho-webhook`
**Payload**: Full report JSON including all expenses and receipts
**Key Fields**:
- report_name
- report_id
- expenses[].expense_id
- expenses[].merchant_name
- expenses[].amount
- expenses[].date
- expenses[].category_name
- expenses[].paid_through_account_name
- expenses[].line_items[].tags[] (Course Location tag)
- expenses[].documents[0].download_url (receipt URL)

**Actions**:
- Parse JSON
- Download receipts from Zoho API
- Upload receipts to Supabase Storage
- INSERT into zoho_expenses table (status='pending')
- Return 200 OK to Zoho

### Supabase → n8n (NEW in v3.0)

**Trigger**: Database trigger calls `pg_net.http_post()`
**Endpoint**: `https://n8n.as3drivertraining.com/webhook/process-expense`
**Payload**: `{ expense_id: UUID }`
**Frequency**: Automatically dispatched when expense inserted or previous expense completes
**Concurrency**: Max 5 simultaneous n8n executions (database-enforced)

### n8n → Supabase

**Operations**:
- SELECT zoho_expenses (fetch expense to process)
- SELECT bank_transactions (find matches)
- SELECT qbo_accounts, qbo_classes (reference data)
- UPDATE zoho_expenses (status changes)
- UPDATE bank_transactions (mark matched)
- INSERT categorization_history (logging)
- INSERT expense_queue (flagged items)

### n8n → Supabase Storage

**Operations**:
- GET receipt image from `expense-receipts/{report_id}/{expense_id}.{ext}`
- Receipt binary passed to AI Agent for validation

### n8n → QBO

**Operations**:
- GET /vendor (lookup or create vendor)
- POST /purchase (create Purchase record)
- POST /upload (attach receipt via multipart/form-data)

### n8n → Monday.com (DEFERRED)

**Operations** (to be implemented later):
- GraphQL query for events by date range
- POST to create subitem under event

### Web App → Supabase

**Operations**:
- INSERT bank_transactions (CSV import)
- SELECT zoho_expenses (queue monitoring dashboard)
- SELECT/UPDATE expense_queue (review flow)
- INSERT/UPDATE vendor_rules (pattern management)
- SELECT for dashboards and reports

---

## Implementation Status (v3.0 Queue-Based) - COMPLETE ✅

### December 16, 2025: Production Deployment Complete

**System Status:** FULLY OPERATIONAL

**Production Metrics:**
- ✅ 9 expenses posted to QBO (Purchase IDs: 9215-9228)
- ✅ 14 expenses flagged for human review
- ✅ 100% match confidence for auto-processed expenses
- ✅ Queue self-healing confirmed (processes next expense after each completion)
- ✅ Receipt attachment working (visible in QBO Purchase records)
- ✅ State tracking via ClassRef working (expenses show correct state in QBO reports)
- ✅ Monday.com state matching working (prefers events matching expense state)

**Key Technical Fixes (Dec 16):**
1. **Bank Transaction Query:** HTTP Request with PostgREST syntax (±3 days filtering)
2. **Data Flow:** Explicit node references after Supabase updates (`$('NodeName').first().json`)
3. **State Matching:** Filter Monday node prefers events matching expense state (+10 bonus)
4. **Flag Reason:** Added column to track why expenses are flagged

---

## Implementation Phases (v3.0 Queue-Based) - COMPLETED

### Phase 1: Queue Infrastructure (Day 1-2) ✅ COMPLETE

**Objective**: Build Supabase-first ingestion pipeline with queue controller.

**Tasks**:

1. Create Supabase table: `zoho_expenses`
   - Schema with status state machine
   - Indexes for queue operations
   - Unique constraint on zoho_expense_id

2. Enable `pg_net` extension in Supabase
   - Required for database triggers to call n8n webhooks

3. Create `process_expense_queue()` function
   - Count processing expenses
   - Claim pending expenses with FOR UPDATE SKIP LOCKED
   - Call n8n via pg_net.http_post()

4. Create database triggers:
   - After INSERT on zoho_expenses → Call queue controller
   - After UPDATE on zoho_expenses (completion) → Call queue controller

5. Build Supabase Edge Function: `receive-zoho-webhook`
   - Parse Zoho webhook JSON
   - Download receipts from Zoho API
   - Upload to Supabase Storage
   - Insert into zoho_expenses

6. Test queue mechanics:
   - Manual INSERT into zoho_expenses
   - Verify trigger fires and calls n8n webhook
   - Verify concurrency limit (max 5)

**Deliverable**: Queue infrastructure operational, can ingest and dispatch expenses. ✅

### Phase 2: n8n Single-Expense Workflow (Day 3-4) ✅ COMPLETE

**Objective**: Build n8n workflow that processes ONE expense from queue.

**Tasks**:

1. Create new n8n webhook: `/process-expense`
   - Receives: `{ expense_id: UUID }`
   - No Split Out / Loop nodes

2. Fetch expense from database:
   - SELECT from zoho_expenses WHERE id = expense_id

3. Fetch receipt from Supabase Storage:
   - Download from `expense-receipts/{report_id}/{expense_id}.{ext}`

4. Fetch reference data:
   - qbo_accounts, qbo_classes, bank_transactions (potential matches)

5. AI Agent processing:
   - Context in prompt (no read tool calls)
   - Tools: lookup_vendor, post_to_qbo, attach_receipt, update_status

6. Update expense status:
   - On success: status='posted'
   - On flag: status='flagged'
   - On error: status='error', last_error=message

7. Test with single expense:
   - Manually trigger queue controller
   - Verify full processing pipeline
   - Check memory usage (should be ~8MB)

**Deliverable**: n8n workflow successfully processes single expenses from queue. ✅

### Phase 3: End-to-End Integration Test (Day 5) ✅ COMPLETE

**Objective**: Test full pipeline with real multi-expense Zoho webhook.

**Tasks**:

1. Configure Zoho webhook:
   - Point to Supabase Edge Function URL
   - Test with small report (2-3 expenses)

2. Monitor queue processing:
   - Check zoho_expenses table status updates
   - Verify 5 concurrent executions max
   - Confirm no memory errors in n8n

3. Test with large report:
   - Submit 20+ expense report
   - Verify all expenses process successfully
   - Check QBO for Purchase records
   - Verify receipts attached

4. Test error handling:
   - Simulate QBO API failure
   - Verify expense status='error'
   - Verify queue continues with next expense

5. Test idempotency:
   - Re-submit same report
   - Verify duplicate expenses skipped (ON CONFLICT)

**Deliverable**: Full pipeline handles multi-expense reports without memory issues. ✅

### Phase 4: Web App Queue Monitoring (Day 6) ✅ COMPLETE

**Objective**: Human interface for monitoring queue and reviewing flagged expenses.

**Tasks**:

1. Add Queue Monitor dashboard page:
   - Show expenses by status (pending, processing, posted, flagged, error)
   - Display processing_attempts, last_error
   - Button to reset failed expenses to 'pending'

2. Update Review Queue page:
   - Fetch from zoho_expenses WHERE status='flagged'
   - Display receipt from Supabase Storage
   - Approve/correct/reject actions
   - Update status after human review

3. Add Retry mechanism:
   - Button to reset expense to 'pending'
   - Manually trigger queue controller

4. Add metrics:
   - Average processing time
   - Success rate
   - Error types histogram

**Deliverable**: Web dashboard for queue monitoring and intervention. ✅

### Phase 5: Orphan Processor + Production Hardening (Day 7) - IN PROGRESS

**Objective**: Complete orphan workflow, production readiness.

**Tasks**:

1. Build orphan processor workflow (existing design):
   - Daily scheduled trigger
   - Process unmatched bank transactions after 45 days
   - Use vendor_rules for categorization

2. Production hardening:
   - Add Teams notifications for stuck expenses
   - Add dead-letter queue for max_attempts > 3
   - Add monitoring alerts for queue backlog > 50
   - Document runbook for common failures

3. Performance tuning:
   - Adjust max_concurrent if needed
   - Optimize Supabase queries with indexes
   - Test with 100+ expense batch

4. Documentation:
   - Update all docs with queue architecture
   - Create troubleshooting guide
   - Train team on queue monitoring

5. Cutover plan:
   - Disable old n8n workflow
   - Enable new webhook endpoint
   - Monitor first 24 hours closely

**Deliverable**: Production-ready queue-based system, fully documented.

---

## Success Criteria

### Functional Requirements

| Requirement | Metric |
|-------------|--------|
| Multi-expense reports process successfully | 20+ expense reports complete without memory errors |
| Queue ingestion is idempotent | Re-submitted reports don't create duplicates |
| Expenses match to bank transactions | 80%+ auto-match rate |
| Accurate state assignment | 95%+ correct state on matched expenses |
| QBO posting works | Purchase records created with correct accounts and ClassRef |
| Receipt attachment works | Receipts viewable in QBO Purchase records |
| Vendor lookup/create works | EntityRef set correctly for bank feed matching |
| Queue self-heals | Next expense auto-processes when previous completes |
| Failed expenses are retryable | Manual reset to 'pending' re-triggers processing |
| Human review works | Dashboard loads, shows queue status, actions execute |

### Performance Requirements (v3.0 Targets)

| Requirement | Metric |
|-------------|--------|
| Memory per expense | < 10MB per n8n execution |
| Processing time per expense | < 20 seconds average |
| Queue throughput | 5 concurrent expenses (limited by max_concurrent) |
| No memory exhaustion | 100+ expense batches process without failure |
| Dashboard load time | < 3 seconds |
| Queue backlog visibility | Real-time status counts by state |

### Business Requirements

| Requirement | Metric |
|-------------|--------|
| Reduce manual categorization | 80% reduction in manual work |
| Accurate state reporting | 100% accuracy for tax purposes (via ClassRef) |
| CPA efficiency | Only "Accept Match" needed in QBO |
| Observable processing | All expense states visible in database |
| Failure isolation | One failed expense doesn't block others |

---

## Appendix A: QBO Account Mappings

### Payment Accounts

| Account Name | QBO ID | Payment Type |
|--------------|--------|--------------|
| AMEX Business 61002 | 99 | CreditCard |
| Wells Fargo AS3 Driver Training (3170) | 49 | Check |

### COGS (Cost of Sales) Accounts

| Category | QBO ID |
|----------|--------|
| Cost of Labor - COS | 78 |
| Course Catering/Meals - COS | 82 |
| Fuel - COS | 76 |
| Supplies & Materials - COS | 77 |
| Track Rental - COS | 79 |
| Travel - Courses COS | 83 |
| Vehicle (Rent/Wash) - COS | 81 |
| Parking and Tolls - COS | 1150040006 |

### Admin Expense Accounts

| Category | QBO ID |
|----------|--------|
| Office Supplies & Software | 12 |
| Rent & Lease | 14 |
| Legal & Professional Services | 9 |
| Advertising & Marketing | 3 |
| Travel - General Business (Non-Course) | 1150040002 |
| Travel - Employee Meals | 60 |

---

## Appendix B: Venue to State Mapping

| Venue | Code | State |
|-------|------|-------|
| Laguna Seca | LS | CA |
| Willow Springs | WS | CA |
| Sonoma | SON | CA |
| Crows Landing | CL | CA |
| Texas Motor Speedway | TMS | TX |
| Western Colorado Dragway | WCD | CO |
| Evergreen Speedway | ES | WA |
| Pacific Raceways | PR | WA |
| New Jersey Motorsports Park | NJMP | NJ |
| South Florida Fairgrounds | SFF | FL |
| Gallatin County Fairgrounds | GCF | MT |

---

## Appendix C: Zoho Expense Report JSON Structure

Key paths for data extraction:

```
body.expense_report.report_name → Report name (contains course/venue info)
body.expense_report.report_id → Unique report identifier
body.expense_report.user_name → Employee who submitted
body.expense_report.start_date → Report date range start
body.expense_report.end_date → Report date range end
body.expense_report.expenses[] → Array of expenses

Each expense:
  .expense_id → Unique expense identifier
  .merchant_name → Vendor name
  .amount → Claimed amount
  .date → Transaction date
  .category_name → Zoho category
  .paid_through_account_name → Payment method (AMEX/Wells Fargo)
  .line_items[0].tags[] → Tags including Course Location
  .documents[0].document_id → Receipt document ID
```

To extract state from Course Location tag:
```javascript
expense.line_items[0].tags.find(t => t.tag_name === "Course Location")?.tag_option_name
```

---

## Appendix D: Current Supabase Table Schemas

### categorization_history (existing)

```sql
CREATE TABLE categorization_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT,
  transaction_date DATE,
  vendor_raw TEXT,
  vendor_clean TEXT,
  amount DECIMAL(10,2),
  description TEXT,
  predicted_category TEXT,
  predicted_state TEXT,
  predicted_confidence INTEGER,
  final_category TEXT,
  final_state TEXT,
  was_corrected BOOLEAN DEFAULT false,
  corrected_by TEXT,
  zoho_expense_id TEXT,
  qbo_transaction_id TEXT,
  receipt_validated BOOLEAN,
  receipt_amount DECIMAL(10,2),
  monday_event_id TEXT,
  monday_event_name TEXT,
  venue_name TEXT,
  venue_state TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### vendor_rules (existing)

```sql
CREATE TABLE vendor_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_pattern TEXT NOT NULL,
  default_category TEXT,
  default_state TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### qbo_accounts (existing)

```sql
CREATE TABLE qbo_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  qbo_id TEXT NOT NULL,
  name TEXT NOT NULL,
  account_type TEXT NOT NULL,
  is_payment_account BOOLEAN DEFAULT false,
  is_cogs BOOLEAN DEFAULT false,
  zoho_category_match TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Appendix E: Queue Infrastructure SQL (NEW in v3.0)

### Table: zoho_expenses

```sql
CREATE TABLE zoho_expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Zoho identifiers
    zoho_expense_id TEXT UNIQUE NOT NULL,
    zoho_report_id TEXT NOT NULL,
    zoho_report_name TEXT,

    -- Raw payload (for re-processing if needed)
    raw_payload JSONB NOT NULL,

    -- Extracted expense details
    expense_date DATE NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    merchant_name TEXT,
    category_name TEXT,
    state_tag TEXT,                    -- "Course Location" tag from Zoho
    paid_through TEXT,                 -- 'AMEX Business 61002' or 'Wells Fargo Debit'

    -- Receipt storage
    receipt_storage_path TEXT,         -- Path in Supabase Storage
    receipt_content_type TEXT,         -- 'image/jpeg', 'application/pdf', etc.

    -- Processing status (state machine)
    status TEXT DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'matched', 'posted', 'flagged', 'error')),
    processing_attempts INT DEFAULT 0,
    processing_started_at TIMESTAMPTZ,
    last_error TEXT,

    -- Matching results (set by n8n)
    bank_transaction_id UUID REFERENCES bank_transactions(id),
    match_confidence INT CHECK (match_confidence >= 0 AND match_confidence <= 100),

    -- QBO posting results (set by n8n)
    qbo_purchase_id TEXT,
    qbo_posted_at TIMESTAMPTZ,

    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    processed_at TIMESTAMPTZ
);

-- Indexes for queue operations
CREATE INDEX idx_zoho_expenses_status ON zoho_expenses(status);
CREATE INDEX idx_zoho_expenses_pending ON zoho_expenses(status, created_at)
    WHERE status = 'pending';
CREATE INDEX idx_zoho_expenses_processing ON zoho_expenses(status, processing_started_at)
    WHERE status = 'processing';
```

### Enable pg_net Extension

```sql
-- Required for database triggers to make HTTP calls to n8n
CREATE EXTENSION IF NOT EXISTS pg_net;
```

### Queue Controller Function

```sql
CREATE OR REPLACE FUNCTION process_expense_queue()
RETURNS TRIGGER AS $$
DECLARE
    processing_count INT;
    next_expense RECORD;
    slots_available INT;
    max_concurrent CONSTANT INT := 5;
BEGIN
    -- Only act on relevant events
    IF TG_OP = 'UPDATE' THEN
        -- Only trigger queue processing when an expense finishes
        IF NEW.status NOT IN ('posted', 'error', 'flagged') THEN
            RETURN NEW;
        END IF;
    END IF;

    -- Count currently processing expenses
    SELECT COUNT(*) INTO processing_count
    FROM zoho_expenses
    WHERE status = 'processing';

    slots_available := max_concurrent - processing_count;

    -- Process up to slots_available pending expenses
    WHILE slots_available > 0 LOOP
        -- Claim next pending expense (FOR UPDATE SKIP LOCKED prevents race conditions)
        UPDATE zoho_expenses
        SET
            status = 'processing',
            processing_started_at = NOW(),
            processing_attempts = processing_attempts + 1
        WHERE id = (
            SELECT id FROM zoho_expenses
            WHERE status = 'pending'
            ORDER BY created_at ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
        )
        RETURNING * INTO next_expense;

        -- Exit if no more pending expenses
        IF next_expense IS NULL THEN
            EXIT;
        END IF;

        -- Call n8n webhook to process this expense
        PERFORM net.http_post(
            url := 'https://n8n.as3drivertraining.com/webhook/process-expense',
            body := jsonb_build_object('expense_id', next_expense.id)::text,
            headers := jsonb_build_object(
                'Content-Type', 'application/json'
            )
        );

        slots_available := slots_available - 1;
    END LOOP;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

### Database Triggers

```sql
-- Trigger: After INSERT (new expense arrives)
CREATE TRIGGER trigger_queue_on_insert
    AFTER INSERT ON zoho_expenses
    FOR EACH ROW
    EXECUTE FUNCTION process_expense_queue();

-- Trigger: After UPDATE (expense finishes processing)
CREATE TRIGGER trigger_queue_on_completion
    AFTER UPDATE OF status ON zoho_expenses
    FOR EACH ROW
    WHEN (NEW.status IN ('posted', 'error', 'flagged'))
    EXECUTE FUNCTION process_expense_queue();
```

### Edge Function: receive-zoho-webhook

File: `supabase/functions/receive-zoho-webhook/index.ts`

```typescript
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const payload = await req.json()
  const report = payload.expense_report
  const expenses = report.expenses || []

  for (const expense of expenses) {
    // Extract state tag
    const stateTag = expense.line_items?.[0]?.tags
      ?.find((t: any) => t.tag_name === 'Course Location')
      ?.tag_option_name || null

    // Download and store receipt
    let receiptPath = null
    let receiptContentType = null
    if (expense.documents?.[0]?.download_url) {
      const receiptResponse = await fetch(expense.documents[0].download_url)
      const receiptBlob = await receiptResponse.blob()
      receiptContentType = receiptResponse.headers.get('content-type') || 'image/jpeg'

      const filename = `${expense.expense_id}.${receiptContentType.split('/')[1]}`
      receiptPath = `receipts/${report.report_id}/${filename}`

      await supabase.storage
        .from('expense-receipts')
        .upload(receiptPath, receiptBlob, { contentType: receiptContentType })
    }

    // Insert expense (ON CONFLICT for idempotency)
    await supabase.from('zoho_expenses').upsert({
      zoho_expense_id: expense.expense_id,
      zoho_report_id: report.report_id,
      zoho_report_name: report.report_name,
      raw_payload: expense,
      expense_date: expense.date,
      amount: expense.total,
      merchant_name: expense.merchant_name,
      category_name: expense.category_name,
      state_tag: stateTag,
      paid_through: expense.paid_through_account_name,
      receipt_storage_path: receiptPath,
      receipt_content_type: receiptContentType,
      status: 'pending'
    }, { onConflict: 'zoho_expense_id', ignoreDuplicates: true })
  }

  return new Response(JSON.stringify({ success: true, count: expenses.length }), {
    headers: { 'Content-Type': 'application/json' }
  })
})
```

---

*End of Document*
