# AS3 Expense Automation System
## Architecture & Implementation Plan

**Version:** 1.0  
**Date:** December 6, 2025  
**Target Completion:** December 13, 2025  
**Author:** Pablo Ortiz-Monasterio / Claude  

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Business Context](#business-context)
3. [Current State: What We Built](#current-state-what-we-built)
4. [The Wall: Why It Failed](#the-wall-why-it-failed)
5. [Proposed Solution](#proposed-solution)
6. [System Architecture](#system-architecture)
7. [Data Model](#data-model)
8. [Component Specifications](#component-specifications)
9. [Integration Points](#integration-points)
10. [Implementation Phases](#implementation-phases)
11. [Success Criteria](#success-criteria)

---

## Executive Summary

AS3 Driver Training operates across seven U.S. states (CA, TX, CO, WA, NJ, FL, MT) and requires precise expense categorization by state for tax compliance. The company discovered significant California tax overpayment due to expenses being incorrectly attributed to California when they occurred in other states.

This document describes an automated expense processing system that:
- Imports bank transactions weekly as the source of truth
- Matches incoming Zoho Expense submissions TO existing bank transactions
- Handles orphan bank transactions (no Zoho expense) via vendor rules
- Identifies reimbursements (Zoho expense with no bank match = personal card)
- Categorizes expenses by type (Course-related vs Admin) and state
- Posts validated expenses to QuickBooks Online
- Tracks course-level profitability in Monday.com
- Learns from human corrections to improve over time

**See Also:** `Documentation/GOALS.md` for authoritative system goals.

The previous implementation attempt hit technical limitations. This document outlines a revised architecture that works within those constraints while providing a sustainable, learnable system.

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

---

## Proposed Solution

### Core Philosophy Change

**Old approach**: AI agent does everything, queries all data, makes all decisions.

**New approach**: Pre-fetch data, provide context, AI agent validates and decides, humans handle edge cases, system learns.

### Key Design Principles

1. **Bank transactions are source of truth**
   - Import AMEX/Wells Fargo statements to Supabase
   - Every expense must match exactly one bank transaction
   - A bank transaction can only be matched once (prevents duplicates)

2. **Human in the loop for uncertainty**
   - If AI confidence < 95%, queue for human review
   - Web dashboard shows pending items
   - Human corrections feed back into vendor_rules

3. **Pre-fetch, don't query**
   - Fetch all reference data before invoking AI agent
   - Pass context in prompt, not via tool calls
   - Reduce agent tool calls to 3-4 maximum

4. **Report-level context first**
   - Parse report name to determine COS/Non-COS
   - Extract venue/dates from report name
   - Query Monday.com once per report, not per expense

5. **Monday.com as financial tracker**
   - Add matched expenses as subitems under course events
   - Enable per-course P&L reporting
   - Real-time expense visibility for course managers

---

## System Architecture

### High-Level Data Flow

**Two Distinct Flows:**
1. **Zoho Flow:** Employee submits expense → Match to existing bank transaction
2. **Orphan Flow:** Bank transaction with no Zoho expense → Use vendor rules

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    STEP 1: BANK TRANSACTIONS (SOURCE OF TRUTH)          │
│                                                                         │
│   AMEX Statement ──────┐        Imported weekly by team member          │
│   (CSV from QBO)       │        (Sunday or Monday)                      │
│                        ├──→ Supabase: bank_transactions                 │
│   Wells Fargo ─────────┘    Status: 'unmatched' initially               │
│   (CSV from QBO)                                                        │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
         ┌──────────────────────────┴──────────────────────────┐
         │                                                      │
         ▼                                                      ▼
┌─────────────────────────────────┐    ┌────────────────────────────────────┐
│     FLOW A: ZOHO EXPENSES       │    │   FLOW B: ORPHAN BANK TXNS         │
│                                 │    │                                    │
│   Zoho Expense Report approved  │    │   Bank txn with no Zoho match      │
│            │                    │    │   (after X days grace period)      │
│            ▼                    │    │            │                       │
│   n8n Webhook triggers          │    │            ▼                       │
│            │                    │    │   Web App: Orphan Queue            │
│            ▼                    │    │            │                       │
│   Search bank_transactions      │    │            ▼                       │
│   for matching amount/date      │    │   State Waterfall:                 │
│            │                    │    │   1. vendor_rules.default_state    │
│            ▼                    │    │   2. Parse description for city/ST │
│   ┌─────────────────────┐       │    │   3. Date proximity to course      │
│   │  Match Found?       │       │    │   4. Flag for human review         │
│   └─────────┬───────────┘       │    │            │                       │
│        Yes  │   No              │    │            ▼                       │
│             │    │              │    │   Categorize and POST to QBO       │
│             ▼    ▼              │    │   (no Zoho expense needed)         │
│      [Process] [Reimbursement]  │    │                                    │
│                 Flag for        │    │                                    │
│                 human review    │    │                                    │
└─────────────────────────────────┘    └────────────────────────────────────┘
                    │                                     │
                    └──────────────┬──────────────────────┘
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         DESTINATIONS                                     │
│                                                                         │
│   ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────┐ │
│   │ Web App         │  │ QBO             │  │ Monday.com              │ │
│   │                 │  │                 │  │                         │ │
│   │ - Review queue  │  │ - Purchase      │  │ - Expense as subitem    │ │
│   │ - Orphan queue  │  │   created       │  │   under course event    │ │
│   │ - Approve/fix   │  │ - Matches to    │  │ - Course P&L visible    │ │
│   │ - Learn rules   │  │   bank feed     │  │                         │ │
│   └─────────────────┘  └─────────────────┘  └─────────────────────────┘ │
│                                                                         │
│   CPA only needs to click "Accept Match" in QBO Banking tab             │
└─────────────────────────────────────────────────────────────────────────┘
```

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

#### monday_events (cache)
Local cache of Monday.com course events for fast lookup.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| monday_item_id | TEXT | Monday.com item ID |
| event_name | TEXT | Full event name |
| venue | TEXT | Venue name |
| state | TEXT | State code (CA, TX, etc.) |
| start_date | DATE | Event start |
| end_date | DATE | Event end |
| course_type | TEXT | ACADS, EVOC, PSD, etc. |
| board_id | TEXT | Monday board ID |
| last_synced_at | TIMESTAMPTZ | Last sync time |

#### Existing Tables (Keep As-Is)

- **categorization_history**: Continue logging all processed expenses
- **vendor_rules**: Continue storing learned patterns
- **flagged_expenses**: Merge functionality into expense_queue
- **qbo_accounts**: Keep for account ID lookups

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

### 2. n8n Workflows

**Goal**: Reduce agent tool calls from 9 to 3-4. Two separate workflows handle different scenarios.

#### Flow A: Zoho Expense Processing (Webhook-Triggered)

```
Webhook (Zoho Report Approved)
    │
    ▼
Parse Report Context (Code Node)
    - Extract report name
    - Determine COS vs Non-COS
    - Extract venue code and dates
    │
    ▼
Fetch Reference Data (Supabase - parallel queries)
    - qbo_accounts (all)
    - vendor_rules (all)
    - monday_events (filtered by date range, if COS)
    │
    ▼
Fetch Potential Bank Matches (Supabase)
    - Query bank_transactions WHERE status='unmatched'
    - Filter by date range (expense_date ±3 days)
    - Filter by amount (±$1 tolerance)
    │
    ▼
Split Expenses (Split Out)
    - One iteration per expense
    │
    ▼
For Each Expense:
    │
    ├──→ Fetch Receipt (HTTP Request)
    │
    ├──→ Merge All Context
    │
    └──→ AI Agent (3-4 tools max)
            │
            │  CONTEXT IN PROMPT (no tool calls):
            │  - qbo_accounts, vendor_rules, monday_event
            │  - potential bank matches
            │
            │  DECISION TREE:
            │  ├── Bank match found + Confidence >= 95%
            │  │       → Tool: post_to_qbo
            │  │       → Tool: update_bank_transaction (mark matched)
            │  │       → Tool: create_monday_subitem (if COS)
            │  │
            │  ├── Bank match found + Confidence < 95%
            │  │       → Tool: insert_expense_queue (flagged)
            │  │
            │  └── No bank match found
            │          → Tool: insert_expense_queue (reimbursement)
            │          → Set is_reimbursement = true
            │
            ▼
         Log to categorization_history
```

#### Flow B: Orphan Bank Transaction Processing (Scheduled/Manual)

Runs daily or on-demand to process bank transactions that have no matching Zoho expense after a grace period (e.g., 5 days).

```
Schedule Trigger (Daily) or Manual Trigger
    │
    ▼
Query Orphan Transactions (Supabase)
    - bank_transactions WHERE status='unmatched'
    - AND transaction_date < NOW() - 5 days
    │
    ▼
Fetch Reference Data (Supabase)
    - vendor_rules (all)
    - qbo_accounts (all)
    - monday_events (by date range)
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
    └── Create Monday subitem (if COS category)
```

### 3. AI Agent (Revised Prompt)

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

### 4. Monday.com Integration

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

### 5. QBO Integration

**Method**: HTTP Request to Purchase API (unchanged from current implementation).

**Endpoint**: `POST https://quickbooks.api.intuit.com/v3/company/123146088634019/purchase`

**Key Fields**:
- AccountRef: Payment account (AMEX=99, Wells Fargo=49)
- PaymentType: "CreditCard" or "Check"
- TxnDate: Transaction date
- Line[].AccountBasedExpenseLineDetail.AccountRef: Expense category account
- Line[].Description: "[Vendor] - [Category] - [State]"
- PrivateNote: "Zoho: [ID] | Event: [name] | Bank: [txn_id]"

**Post-Processing**: After QBO returns Purchase ID, update:
- bank_transactions.qbo_purchase_id
- categorization_history.qbo_transaction_id

---

## Integration Points

### Zoho Expense → n8n

**Trigger**: Webhook on expense report approval
**Payload**: Full report JSON including all expenses and receipts
**Key Fields**:
- report_name
- expenses[].expense_id
- expenses[].merchant_name
- expenses[].amount
- expenses[].date
- expenses[].category_name
- expenses[].paid_through_account_name
- expenses[].line_items[].tags[] (Course Location tag)
- expenses[].documents[].document_id (receipt)

### n8n → Supabase

**Operations**:
- INSERT to categorization_history (every expense)
- INSERT to expense_queue (if flagged)
- UPDATE bank_transactions (when matched)
- SELECT from all reference tables

### n8n → QBO

**Operations**:
- GET query for duplicate check
- POST to create Purchase

### n8n → Monday.com

**Operations**:
- GET events by date range (via cached monday_events)
- POST to create subitem under event

### Web App → Supabase

**Operations**:
- INSERT bank_transactions (CSV import)
- SELECT/UPDATE expense_queue (review flow)
- INSERT/UPDATE vendor_rules (pattern management)
- SELECT for dashboards and reports

---

## Implementation Phases

### Phase 1: Foundation (Day 1-2)

**Objective**: Get bank transactions into Supabase, simplify n8n workflow.

**Tasks**:

1. Create new Supabase tables:
   - bank_transactions
   - expense_queue
   - monday_events

2. Build bank import functionality:
   - Simple web form for CSV upload
   - Parse AMEX CSV format
   - Parse Wells Fargo CSV format
   - Dedupe on import

3. Simplify n8n workflow:
   - Add "Parse Report Context" code node
   - Add "Fetch Reference Data" Supabase node
   - Add "Fetch Potential Bank Matches" Supabase node
   - Reduce AI agent tools to 4

4. Import historical bank transactions:
   - AMEX: Last 3 months
   - Wells Fargo: Last 3 months

**Deliverable**: Bank transactions in Supabase, simplified n8n workflow running without iteration errors.

### Phase 2: Matching Engine (Day 3)

**Objective**: AI agent matches expenses to bank transactions.

**Tasks**:

1. Update AI agent system prompt with new logic
2. Implement bank transaction matching in agent
3. Update categorization_history logging
4. Test with real Zoho expense reports
5. Verify matches are accurate

**Deliverable**: Expenses automatically matching to bank transactions.

### Phase 3: Review Dashboard (Day 4)

**Objective**: Human interface for reviewing flagged expenses.

**Tasks**:

1. Build React app shell with routing
2. Implement review queue page
3. Implement match view (side-by-side comparison)
4. Build approve/correct/reject actions
5. Connect to Supabase

**Deliverable**: Web dashboard for human review of uncertain expenses.

### Phase 4: QBO + Monday (Day 5)

**Objective**: Matched expenses flow to QBO and Monday.

**Tasks**:

1. Update n8n to post to QBO on approval
2. Update bank_transactions with QBO ID
3. Add Monday subitem creation
4. Test end-to-end flow
5. Verify QBO bank feed shows match suggestions

**Deliverable**: Complete flow from Zoho → Match → QBO + Monday.

### Phase 5: Learning Loop (Day 6-7)

**Objective**: System improves from corrections.

**Tasks**:

1. Implement vendor_rules update from corrections
2. Build vendor rules management UI
3. Add reporting dashboards
4. Documentation and training
5. Buffer for bug fixes

**Deliverable**: Self-improving system, documentation complete.

---

## Success Criteria

### Functional Requirements

| Requirement | Metric |
|-------------|--------|
| Bank transactions importable | CSV import works for AMEX and Wells Fargo |
| Expenses match to bank transactions | 80%+ auto-match rate |
| Accurate state assignment | 95%+ correct state on matched expenses |
| QBO posting works | Purchase records created with correct accounts |
| Monday tracking works | Expenses appear as subitems under events |
| Human review works | Dashboard loads, actions execute |
| Learning works | Vendor rules update from corrections |

### Performance Requirements

| Requirement | Metric |
|-------------|--------|
| Agent iteration limit | Never exceeds 10 iterations |
| Processing time | < 30 seconds per expense |
| Dashboard load time | < 3 seconds |

### Business Requirements

| Requirement | Metric |
|-------------|--------|
| Reduce manual categorization | 80% reduction in manual work |
| Accurate state reporting | 100% accuracy for tax purposes |
| Course P&L visibility | Expenses visible per course in Monday |
| CPA efficiency | Only "Accept Match" needed in QBO |

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

*End of Document*
