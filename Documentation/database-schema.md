# AS3 Expense Automation - Database Schema

**Version:** 2.2
**Last Updated:** December 16, 2025
**Database:** Supabase (PostgreSQL)

---

## Table of Contents

1. [Overview](#overview)
2. [Existing Tables](#existing-tables)
3. [New Tables](#new-tables)
4. [pg_net Extension](#pg_net-extension)
5. [Queue Controller Function and Triggers](#queue-controller-function-and-triggers)
6. [Indexes](#indexes)
7. [Row Level Security](#row-level-security)
8. [Triggers & Functions](#triggers--functions)
9. [Views](#views)
10. [Migration Script](#migration-script)

---

## Overview

The AS3 Expense Automation system uses Supabase (PostgreSQL) as its primary data store. This document describes:

- **Existing tables** that must be preserved (categorization_history, vendor_rules, flagged_expenses, qbo_accounts)
- **New tables** to be created (bank_transactions, expense_queue, zoho_expenses)
- **Relationships** between tables
- **Security policies** for Row Level Security (RLS)
- **Queue controller** that manages concurrent expense processing

### Entity Relationship Diagram

```
┌─────────────────────┐       ┌─────────────────────┐
│  zoho_expenses      │       │  bank_transactions  │
├─────────────────────┤       ├─────────────────────┤
│ id (PK)             │       │ id (PK)             │
│ zoho_expense_id     │       │ source              │
│ status (queue)      │       │ transaction_date    │
│ expense_date        │       │ amount              │
│ amount              │       │ description         │
│ merchant_name       │       │ status              │
│ state_tag           │       │ matched_expense_id  │
│ bank_transaction_id │──────>│ qbo_purchase_id     │
│ qbo_purchase_id     │       │ monday_subitem_id   │
│ match_confidence    │       └─────────────────────┘
│ receipt_storage_path│               │
└─────────────────────┘               │
         │                            │
         │ (processed by              │
         │  n8n via queue)            │
         │                            v
         │               ┌─────────────────────────┐
         │               │   expense_queue         │
         │               ├─────────────────────────┤
         │               │ id (PK)                 │
         │               │ zoho_expense_id         │
         │               │ status                  │
         │               │ vendor_name             │
         │               │ suggested_bank_txn_id   │
         │               │ confidence_score        │
         │               │ corrections (JSONB)     │
         │               └─────────────────────────┘
         │                            │
         │                            v
         │               ┌─────────────────────────┐
         │               │ categorization_history  │
         └──────────────>├─────────────────────────┤
                         │ id (PK)                 │
                         │ zoho_expense_id         │
                         │ bank_transaction_id (FK)│
                         │ predicted_category      │
                         │ predicted_state         │
                         │ final_category          │
                         │ final_state             │
                         │ qbo_transaction_id      │
                         └─────────────────────────┘
                                      │
                                      v
                         ┌─────────────────────────┐
                         │    vendor_rules         │
                         ├─────────────────────────┤
                         │ id (PK)                 │
                         │ vendor_pattern          │
                         │ default_category        │
                         │ default_state           │
                         └─────────────────────────┘

┌─────────────────────┐       ┌─────────────────────┐
│   qbo_accounts      │       │   monday_events     │
├─────────────────────┤       ├─────────────────────┤
│ id (PK)             │       │ id (PK)             │
│ qbo_id              │       │ monday_item_id      │
│ name                │       │ event_name          │
│ account_type        │       │ venue               │
│ is_payment_account  │       │ state               │
│ is_cogs             │       │ start_date          │
│ zoho_category_match │       │ end_date            │
└─────────────────────┘       └─────────────────────┘
                              (NOT CURRENTLY USED -
                               n8n queries Monday API
                               directly via GraphQL)
```

---

## Existing Tables

### categorization_history

Logs every expense processed by the system. Provides audit trail and training data.

```sql
-- Current schema (preserve existing data)
CREATE TABLE IF NOT EXISTS categorization_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source TEXT,                          -- 'zoho', 'manual', 'import'
    transaction_date DATE,
    vendor_raw TEXT,                      -- Original merchant name
    vendor_clean TEXT,                    -- Cleaned/normalized name
    amount DECIMAL(10,2),
    description TEXT,
    predicted_category TEXT,              -- AI prediction
    predicted_state TEXT,                 -- AI prediction (CA, TX, etc.)
    predicted_confidence INTEGER,         -- 0-100 confidence score
    final_category TEXT,                  -- After human review
    final_state TEXT,                     -- After human review
    was_corrected BOOLEAN DEFAULT false,  -- Did human change AI prediction?
    corrected_by TEXT,                    -- Who made correction
    zoho_expense_id TEXT,                 -- Link to Zoho
    qbo_transaction_id TEXT,              -- Link to QuickBooks Purchase ID
    receipt_validated BOOLEAN,            -- Did receipt match claimed amount?
    receipt_amount DECIMAL(10,2),         -- Amount extracted from receipt
    monday_event_id TEXT,                 -- Link to Monday.com event
    monday_event_name TEXT,
    venue_name TEXT,
    venue_state TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),

    -- NEW COLUMN: Link to bank_transactions
    bank_transaction_id UUID              -- FK to bank_transactions.id
);
```

**Modification Required:**
```sql
-- Add foreign key to bank_transactions (run after creating bank_transactions)
ALTER TABLE categorization_history
    ADD COLUMN IF NOT EXISTS bank_transaction_id UUID;

ALTER TABLE categorization_history
    ADD CONSTRAINT fk_bank_transaction
    FOREIGN KEY (bank_transaction_id)
    REFERENCES bank_transactions(id)
    ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cat_history_bank_txn
    ON categorization_history(bank_transaction_id);

CREATE INDEX IF NOT EXISTS idx_cat_history_zoho_id
    ON categorization_history(zoho_expense_id);
```

---

### vendor_rules

Stores learned patterns for automatic vendor categorization.

```sql
CREATE TABLE IF NOT EXISTS vendor_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_pattern TEXT NOT NULL,         -- Regex or partial match pattern
    default_category TEXT,                -- Default category to assign
    default_state TEXT,                   -- Default state (if always same location)
    notes TEXT,                           -- Admin notes
    match_count INTEGER DEFAULT 0,        -- Times this rule was applied
    last_matched_at TIMESTAMPTZ,          -- When last used
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by TEXT,                      -- Who created rule

    CONSTRAINT vendor_pattern_unique UNIQUE (vendor_pattern)
);
```

**Modification Required:**
```sql
-- Add tracking columns if not present
ALTER TABLE vendor_rules
    ADD COLUMN IF NOT EXISTS match_count INTEGER DEFAULT 0;
ALTER TABLE vendor_rules
    ADD COLUMN IF NOT EXISTS last_matched_at TIMESTAMPTZ;
ALTER TABLE vendor_rules
    ADD COLUMN IF NOT EXISTS created_by TEXT;
```

---

### qbo_accounts

Mirror of QuickBooks Chart of Accounts for ID lookups.

```sql
CREATE TABLE IF NOT EXISTS qbo_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    qbo_id TEXT NOT NULL,                 -- QuickBooks Account ID
    name TEXT NOT NULL,                   -- Account name
    account_type TEXT NOT NULL,           -- Expense, Bank, CreditCard, etc.
    is_payment_account BOOLEAN DEFAULT false,  -- Used for payment (AMEX, Wells)
    is_cogs BOOLEAN DEFAULT false,        -- Is Cost of Goods Sold account
    zoho_category_match TEXT,             -- Matching Zoho category name
    created_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT qbo_id_unique UNIQUE (qbo_id)
);
```

**Current Data (Reference):**

| qbo_id | name | is_payment_account | is_cogs |
|--------|------|-------------------|---------|
| 99 | AMEX Business 61002 | true | false |
| 49 | Wells Fargo AS3 Driver Training (3170) | true | false |
| 78 | Cost of Labor - COS | false | true |
| 82 | Course Catering/Meals - COS | false | true |
| 76 | Fuel - COS | false | true |
| 77 | Supplies & Materials - COS | false | true |
| 79 | Track Rental - COS | false | true |
| 83 | Travel - Courses COS | false | true |
| 81 | Vehicle (Rent/Wash) - COS | false | true |
| 12 | Office Supplies & Software | false | false |
| 14 | Rent & Lease | false | false |
| 9 | Legal & Professional Services | false | false |
| 3 | Advertising & Marketing | false | false |

---

### flagged_expenses

**Note:** This table will be superseded by `expense_queue` but must be preserved for historical data.

```sql
CREATE TABLE IF NOT EXISTS flagged_expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source TEXT,
    transaction_date DATE,
    vendor_raw TEXT,
    description TEXT,
    amount DECIMAL(10,2),
    flag_reason TEXT,
    predicted_category TEXT,
    predicted_state TEXT,
    predicted_confidence INTEGER,
    status TEXT DEFAULT 'pending',        -- pending, resolved, dismissed
    zoho_expense_id TEXT,
    resolved_by TEXT,
    resolved_at TIMESTAMPTZ,
    resolution_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## New Tables

### bank_transactions

**Purpose:** Source of truth for all financial transactions. Every Zoho expense must match to exactly one record here.

```sql
CREATE TABLE bank_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Source identification
    source TEXT NOT NULL CHECK (source IN ('amex', 'wells_fargo')),
    card_last_four TEXT,                  -- Last 4 digits of card (parsed from description)
    reference_number TEXT,                -- Bank reference/confirmation number

    -- Transaction details
    transaction_date DATE NOT NULL,       -- When transaction occurred
    post_date DATE,                       -- When posted to account
    description TEXT NOT NULL,            -- Raw bank description
    amount DECIMAL(10,2) NOT NULL,        -- Transaction amount (positive)

    -- Parsed fields (extracted at import time)
    extracted_vendor TEXT,                -- Vendor name parsed from description
    extracted_state TEXT,                 -- State code parsed from description (CA, TX, etc.)
    description_normalized TEXT,          -- Uppercase, alphanumeric only (for dedup)

    -- Matching status
    status TEXT NOT NULL DEFAULT 'unmatched'
        CHECK (status IN ('unmatched', 'matched', 'excluded', 'orphan_processed', 'manual_entry')),
    matched_expense_id TEXT,              -- Zoho expense_id when matched
    matched_at TIMESTAMPTZ,               -- When match occurred
    matched_by TEXT CHECK (matched_by IN ('agent', 'human', NULL)),
    match_confidence INTEGER,             -- Confidence of match (0-100)

    -- Orphan processing (bank txn with no Zoho expense)
    orphan_category TEXT,                 -- Category assigned via vendor_rules or human
    orphan_state TEXT,                    -- State assigned via waterfall or human
    orphan_determination_method TEXT,     -- 'vendor_rules', 'description_parsing', 'course_proximity', 'human'
    orphan_processed_at TIMESTAMPTZ,      -- When orphan was processed

    -- Downstream system IDs
    qbo_purchase_id TEXT,                 -- QuickBooks Purchase ID after posting
    monday_subitem_id TEXT,               -- Monday.com subitem ID after posting

    -- Metadata
    import_batch_id UUID,                 -- Group transactions by import
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Prevent duplicate imports (using normalized description for comparison)
    UNIQUE (source, transaction_date, amount, description_normalized)
);

-- Indexes for common queries
CREATE INDEX idx_bank_txn_status ON bank_transactions(status);
CREATE INDEX idx_bank_txn_date ON bank_transactions(transaction_date);
CREATE INDEX idx_bank_txn_amount ON bank_transactions(amount);
CREATE INDEX idx_bank_txn_matching ON bank_transactions(status, transaction_date, amount);
CREATE INDEX idx_bank_txn_zoho ON bank_transactions(matched_expense_id);
CREATE INDEX idx_bank_txn_import ON bank_transactions(import_batch_id);
```

---

### expense_queue

**Purpose:** Queue for expenses requiring human review. Replaces and extends `flagged_expenses`.

```sql
CREATE TABLE expense_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Zoho reference
    zoho_expense_id TEXT NOT NULL UNIQUE,
    zoho_report_id TEXT,
    zoho_report_name TEXT,

    -- Review status
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'corrected', 'rejected', 'auto_processed')),

    -- Expense details
    vendor_name TEXT NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    expense_date DATE NOT NULL,
    category_name TEXT,                   -- Zoho category
    paid_through TEXT,                    -- Payment method (AMEX/Wells)
    receipt_url TEXT,                     -- URL to receipt image

    -- AI predictions
    category_suggested TEXT,              -- AI suggested category
    state_suggested TEXT,                 -- AI suggested state
    confidence_score INTEGER
        CHECK (confidence_score >= 0 AND confidence_score <= 100),
    flag_reason TEXT,                     -- Why flagged for review

    -- Bank transaction matching
    suggested_bank_txn_id UUID REFERENCES bank_transactions(id),
    alternate_bank_txn_ids UUID[],        -- Other possible matches

    -- Reimbursement tracking (no bank match = personal card)
    is_reimbursement BOOLEAN DEFAULT FALSE,  -- True if no bank match found
    reimbursement_method TEXT,            -- 'check', 'zelle', 'payroll', 'ach'
    reimbursement_reference TEXT,         -- Check number, Zelle confirmation, etc.
    reimbursed_at TIMESTAMPTZ,            -- When reimbursement was processed
    reimbursed_by TEXT,                   -- Who processed the reimbursement

    -- Review outcome
    reviewed_by TEXT,
    reviewed_at TIMESTAMPTZ,
    corrections JSONB DEFAULT '{}',       -- {category, state, bank_txn_id, notes}

    -- Original data for re-processing
    original_data JSONB,                  -- Full Zoho expense JSON

    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_expense_queue_status ON expense_queue(status);
CREATE INDEX idx_expense_queue_date ON expense_queue(created_at DESC);
CREATE INDEX idx_expense_queue_pending ON expense_queue(status) WHERE status = 'pending';
CREATE INDEX idx_expense_queue_reimbursement ON expense_queue(is_reimbursement) WHERE is_reimbursement = true;
```

**Corrections JSONB Structure:**
```json
{
    "category": "Travel - Courses COS",
    "state": "TX",
    "bank_txn_id": "uuid-here",
    "monday_event_id": "12345678",
    "notes": "Matched to TMS course August 15-16"
}
```

---

### zoho_expenses

**Purpose:** Queue-based expense ingestion table. Receives expenses directly from Zoho via Edge Function, processed one-by-one by n8n via queue controller.

```sql
-- Queue-based expense ingestion table
-- Receives expenses directly from Zoho via Edge Function
-- Processed one-by-one by n8n via queue controller
CREATE TABLE zoho_expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Zoho identifiers
    zoho_expense_id TEXT UNIQUE NOT NULL,  -- Unique expense ID from Zoho
    zoho_report_id TEXT NOT NULL,          -- Parent report ID
    zoho_report_name TEXT,                 -- Report name for reference

    -- Raw payload (for re-processing if needed)
    raw_payload JSONB NOT NULL,            -- Full expense JSON from Zoho

    -- Extracted expense details (denormalized for fast queries)
    expense_date DATE NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    merchant_name TEXT,
    category_name TEXT,                    -- Zoho category (maps to QBO account)
    state_tag TEXT,                        -- "Course Location" tag from Zoho
    paid_through TEXT,                     -- 'AMEX Business 61002' or 'Wells Fargo Debit'

    -- Receipt storage (Supabase Storage)
    receipt_storage_path TEXT,             -- Path in 'expense-receipts' bucket
    receipt_content_type TEXT,             -- 'image/jpeg', 'application/pdf', etc.

    -- Processing status (state machine)
    status TEXT DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'matched', 'posted', 'flagged', 'error')),
    processing_attempts INT DEFAULT 0,      -- Retry counter
    processing_started_at TIMESTAMPTZ,      -- When n8n started processing
    last_error TEXT,                        -- Error message if failed
    flag_reason TEXT,                       -- Why expense was flagged for review

    -- Matching results (set by n8n after processing)
    bank_transaction_id UUID REFERENCES bank_transactions(id),
    match_confidence INT CHECK (match_confidence >= 0 AND match_confidence <= 100),

    -- QBO posting results (set by n8n after QBO posting)
    qbo_purchase_id TEXT,                  -- QuickBooks Purchase ID
    qbo_posted_at TIMESTAMPTZ,             -- When posted to QBO

    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),  -- Updated by trigger on each modification
    processed_at TIMESTAMPTZ               -- When processing completed (success or failure)
);

-- Indexes for queue operations
CREATE INDEX idx_zoho_expenses_status ON zoho_expenses(status);
CREATE INDEX idx_zoho_expenses_pending ON zoho_expenses(status, created_at)
    WHERE status = 'pending';
CREATE INDEX idx_zoho_expenses_processing ON zoho_expenses(status, processing_started_at)
    WHERE status = 'processing';
CREATE INDEX idx_zoho_expenses_bank_txn ON zoho_expenses(bank_transaction_id);
CREATE INDEX idx_zoho_expenses_date ON zoho_expenses(expense_date);
```

**Status State Machine:**
```
pending → processing → posted (success)
                    → flagged (needs human review)
                    → error (failed, can retry)

Transitions:
- pending → processing: Queue controller claims expense
- processing → posted: n8n successfully matched + posted to QBO
- processing → flagged: Match confidence < 95% or needs human decision
- processing → error: API failure, can reset to pending to retry
- flagged → pending: User resubmits from Review Queue UI (with or without corrections)
```

**UI Integration (as of December 15, 2025):**

Flagged expenses (status='flagged') are displayed in the Review Queue UI with:
- Match confidence percentage with visual progress bar
- Processing attempts counter (if > 1)
- Receipt image from Supabase Storage (signed URLs)
- Available actions: Approve, Save & Resubmit, Resubmit, Reject, Create Vendor Rule

**Resubmit Flow:**
1. User corrects state_tag and/or category_name in UI
2. Clicks "Save & Resubmit" (or "Resubmit" without changes)
3. Updates row with corrections
4. Resets status='pending', clears processing_started_at and last_error
5. Queue controller picks up expense for reprocessing
6. n8n applies corrected values during next processing attempt

---

### monday_events

**Purpose:** Local cache of Monday.com course events for fast lookup without API calls.

**NOTE:** This table is NOT currently used in the system architecture. n8n queries Monday.com API directly via GraphQL. The table was created for potential future caching but is not part of the current implementation.

```sql
CREATE TABLE monday_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Monday.com reference
    monday_item_id TEXT NOT NULL UNIQUE,
    board_id TEXT NOT NULL,               -- Monday board ID (8294758830)
    group_id TEXT,                        -- Monday group within board

    -- Event details
    event_name TEXT NOT NULL,             -- Full event name
    venue TEXT,                           -- Venue name
    venue_code TEXT,                      -- Short code (LS, WS, CL, TMS, etc.)
    state TEXT CHECK (state IN ('CA', 'TX', 'CO', 'WA', 'NJ', 'FL', 'MT')),

    -- Dates
    start_date DATE NOT NULL,
    end_date DATE,

    -- Course metadata
    course_type TEXT,                     -- ACADS, EVOC, PSD, etc.
    client_name TEXT,
    is_open_enrollment BOOLEAN DEFAULT FALSE,

    -- Financial tracking
    total_expenses DECIMAL(10,2) DEFAULT 0,  -- Sum of linked expenses
    expense_count INTEGER DEFAULT 0,

    -- Sync metadata
    last_synced_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX idx_monday_events_dates ON monday_events(start_date, end_date);
CREATE INDEX idx_monday_events_state ON monday_events(state);
CREATE INDEX idx_monday_events_venue ON monday_events(venue_code);
CREATE INDEX idx_monday_events_sync ON monday_events(last_synced_at);
CREATE INDEX idx_monday_events_board ON monday_events(board_id);
```

**Venue Code Reference:**

| venue_code | venue | state |
|------------|-------|-------|
| LS | Laguna Seca | CA |
| WS | Willow Springs | CA |
| SON | Sonoma | CA |
| CL | Crows Landing | CA |
| TMS | Texas Motor Speedway | TX |
| WCD | Western Colorado Dragway | CO |
| ES | Evergreen Speedway | WA |
| PR | Pacific Raceways | WA |
| NJMP | New Jersey Motorsports Park | NJ |
| SFF | South Florida Fairgrounds | FL |
| GCF | Gallatin County Fairgrounds | MT |

---

## pg_net Extension

The queue controller requires the `pg_net` extension to make asynchronous HTTP calls from PostgreSQL triggers.

```sql
-- Enable pg_net extension for async HTTP calls from triggers
-- This extension is pre-installed on Supabase but needs to be enabled
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Note: pg_net allows PostgreSQL triggers to make HTTP calls
-- Used by queue controller to trigger n8n webhook
-- Calls are async (fire-and-forget) - ideal for queue pattern
```

**Key Features:**
- Pre-installed on Supabase (no additional setup required)
- Async HTTP calls (non-blocking)
- Fire-and-forget pattern (ideal for triggering n8n)
- Runs in `extensions` schema (isolated from application tables)

---

## Queue Controller Function and Triggers

The queue controller manages concurrent n8n expense processing with automatic load balancing.

### Main Queue Controller Function

```sql
-- =============================================================================
-- Queue Controller: Manages concurrent n8n expense processing
-- =============================================================================

-- Main queue controller function
CREATE OR REPLACE FUNCTION process_expense_queue()
RETURNS TRIGGER AS $$
DECLARE
    processing_count INT;
    next_expense RECORD;
    slots_available INT;
    max_concurrent CONSTANT INT := 5;  -- Maximum concurrent n8n executions
BEGIN
    -- Only act on relevant events
    IF TG_OP = 'UPDATE' THEN
        -- Only trigger when an expense finishes processing
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
        -- Claim next pending expense
        -- FOR UPDATE SKIP LOCKED prevents race conditions
        UPDATE zoho_expenses
        SET
            status = 'processing',
            processing_started_at = NOW(),
            processing_attempts = processing_attempts + 1
        WHERE id = (
            SELECT id FROM zoho_expenses
            WHERE status = 'pending'
            ORDER BY created_at ASC  -- FIFO order
            LIMIT 1
            FOR UPDATE SKIP LOCKED   -- Skip if another transaction has this row
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

### Queue Controller Triggers

```sql
-- Trigger: After INSERT (new expense arrives from Edge Function)
CREATE TRIGGER trigger_queue_on_insert
    AFTER INSERT ON zoho_expenses
    FOR EACH ROW
    EXECUTE FUNCTION process_expense_queue();

-- Trigger: After UPDATE (expense finishes processing)
-- Only fires when status changes to a completion state
CREATE TRIGGER trigger_queue_on_completion
    AFTER UPDATE OF status ON zoho_expenses
    FOR EACH ROW
    WHEN (NEW.status IN ('posted', 'error', 'flagged'))
    EXECUTE FUNCTION process_expense_queue();
```

**How It Works:**

1. **New Expense Arrives** → `trigger_queue_on_insert` fires
2. **Check Capacity** → Count expenses with `status = 'processing'`
3. **Claim Pending Expense** → Update status to 'processing' using `FOR UPDATE SKIP LOCKED`
4. **Call n8n** → Use `net.http_post()` to trigger processing webhook
5. **Expense Completes** → `trigger_queue_on_completion` fires, process next in queue

**Race Condition Protection:**
- `FOR UPDATE SKIP LOCKED` ensures only one trigger claims each expense
- Multiple concurrent inserts/completions are handled safely
- FIFO ordering (`ORDER BY created_at ASC`) ensures fairness

**Load Balancing:**
- Maximum 5 concurrent n8n executions (adjustable via `max_concurrent`)
- Automatic backpressure when n8n is at capacity
- New expenses queue until slots become available

---

## Indexes

All indexes are defined within table creation statements above. Summary:

| Table | Index | Columns | Purpose |
|-------|-------|---------|---------|
| bank_transactions | idx_bank_txn_status | status | Filter by status |
| bank_transactions | idx_bank_txn_matching | status, transaction_date, amount | Match queries |
| bank_transactions | idx_bank_txn_zoho | matched_expense_id | Lookup by Zoho ID |
| expense_queue | idx_expense_queue_status | status | Filter by status |
| expense_queue | idx_expense_queue_pending | status WHERE 'pending' | Dashboard count |
| monday_events | idx_monday_events_dates | start_date, end_date | Date range queries |
| categorization_history | idx_cat_history_bank_txn | bank_transaction_id | Join to bank transactions |

---

## Row Level Security

For initial deployment (single organization), use simple policies. Prepare for multi-tenant future.

```sql
-- Enable RLS on all tables
ALTER TABLE bank_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE zoho_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE monday_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE categorization_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE qbo_accounts ENABLE ROW LEVEL SECURITY;

-- Initial policy: Allow all authenticated users full access
-- (Replace with organization-scoped policies for SaaS)

CREATE POLICY "Allow authenticated users" ON bank_transactions
    FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users" ON expense_queue
    FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users" ON zoho_expenses
    FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users" ON monday_events
    FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users" ON categorization_history
    FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users" ON vendor_rules
    FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users" ON qbo_accounts
    FOR ALL USING (auth.role() = 'authenticated');

-- Service role bypass for n8n webhooks and Edge Functions
CREATE POLICY "Service role full access" ON bank_transactions
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access" ON expense_queue
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access" ON zoho_expenses
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access" ON categorization_history
    FOR ALL USING (auth.role() = 'service_role');
```

---

## Triggers & Functions

### Update timestamps

```sql
-- Generic updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to tables with updated_at
CREATE TRIGGER update_bank_transactions_updated_at
    BEFORE UPDATE ON bank_transactions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_expense_queue_updated_at
    BEFORE UPDATE ON expense_queue
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_monday_events_updated_at
    BEFORE UPDATE ON monday_events
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_vendor_rules_updated_at
    BEFORE UPDATE ON vendor_rules
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

### Vendor rules learning

```sql
-- Update vendor_rules when expense is corrected
CREATE OR REPLACE FUNCTION learn_vendor_pattern()
RETURNS TRIGGER AS $$
DECLARE
    vendor_pattern TEXT;
    existing_rule_id UUID;
BEGIN
    -- Only trigger on corrections
    IF NEW.status = 'corrected' AND NEW.corrections IS NOT NULL THEN
        -- Extract vendor pattern (first word of vendor name, lowercase)
        vendor_pattern := LOWER(SPLIT_PART(NEW.vendor_name, ' ', 1));

        -- Check if rule exists
        SELECT id INTO existing_rule_id
        FROM vendor_rules
        WHERE LOWER(vendor_pattern) = vendor_pattern
        LIMIT 1;

        IF existing_rule_id IS NOT NULL THEN
            -- Update existing rule
            UPDATE vendor_rules
            SET
                match_count = match_count + 1,
                last_matched_at = NOW(),
                updated_at = NOW()
            WHERE id = existing_rule_id;
        ELSE
            -- Create new rule if correction provides category
            IF NEW.corrections->>'category' IS NOT NULL THEN
                INSERT INTO vendor_rules (vendor_pattern, default_category, default_state, created_by)
                VALUES (
                    vendor_pattern,
                    NEW.corrections->>'category',
                    NEW.corrections->>'state',
                    NEW.reviewed_by
                );
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER learn_from_corrections
    AFTER UPDATE ON expense_queue
    FOR EACH ROW
    WHEN (OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION learn_vendor_pattern();
```

---

## Views

### Dashboard statistics

```sql
CREATE OR REPLACE VIEW dashboard_stats AS
SELECT
    -- Review queues
    (SELECT COUNT(*) FROM expense_queue WHERE status = 'pending' AND is_reimbursement = false) AS pending_reviews,
    (SELECT COUNT(*) FROM expense_queue WHERE status = 'pending' AND is_reimbursement = true) AS pending_reimbursements,

    -- Bank transaction status
    (SELECT COUNT(*) FROM bank_transactions WHERE status = 'unmatched') AS unmatched_bank_txns,
    (SELECT COUNT(*) FROM bank_transactions
        WHERE status = 'unmatched'
        AND transaction_date < CURRENT_DATE - INTERVAL '5 days') AS orphan_bank_txns,

    -- Processing stats
    (SELECT COUNT(*) FROM categorization_history WHERE DATE(created_at) = CURRENT_DATE) AS processed_today,
    (SELECT COALESCE(SUM(amount), 0) FROM categorization_history WHERE DATE(created_at) = CURRENT_DATE) AS amount_today,
    (SELECT COUNT(*) FROM categorization_history WHERE was_corrected = true AND DATE(created_at) >= CURRENT_DATE - INTERVAL '7 days') AS corrections_this_week,

    -- Weekly totals
    (SELECT COALESCE(SUM(amount), 0) FROM categorization_history WHERE DATE(created_at) >= CURRENT_DATE - INTERVAL '7 days') AS amount_this_week;
```

### Expenses by state

```sql
CREATE OR REPLACE VIEW expenses_by_state AS
SELECT
    COALESCE(final_state, predicted_state, 'Unknown') AS state,
    COUNT(*) AS expense_count,
    SUM(amount) AS total_amount,
    DATE_TRUNC('month', transaction_date) AS month
FROM categorization_history
WHERE transaction_date >= CURRENT_DATE - INTERVAL '12 months'
GROUP BY 1, 4
ORDER BY 4 DESC, 3 DESC;
```

---

## Migration Script

Complete migration script to run in Supabase SQL Editor:

```sql
-- ============================================
-- AS3 Expense Automation - Database Migration
-- Run this script in Supabase SQL Editor
-- ============================================

-- 1. Create bank_transactions table
CREATE TABLE IF NOT EXISTS bank_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source TEXT NOT NULL CHECK (source IN ('amex', 'wells_fargo')),
    card_last_four TEXT,
    reference_number TEXT,
    transaction_date DATE NOT NULL,
    post_date DATE,
    description TEXT NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    extracted_vendor TEXT,
    extracted_state TEXT,
    description_normalized TEXT,
    status TEXT NOT NULL DEFAULT 'unmatched'
        CHECK (status IN ('unmatched', 'matched', 'excluded', 'orphan_processed', 'manual_entry')),
    matched_expense_id TEXT,
    matched_at TIMESTAMPTZ,
    matched_by TEXT CHECK (matched_by IN ('agent', 'human', NULL)),
    match_confidence INTEGER,
    orphan_category TEXT,
    orphan_state TEXT,
    orphan_determination_method TEXT,
    orphan_processed_at TIMESTAMPTZ,
    qbo_purchase_id TEXT,
    monday_subitem_id TEXT,
    import_batch_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (source, transaction_date, amount, description_normalized)
);

-- 2. Create expense_queue table
CREATE TABLE IF NOT EXISTS expense_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    zoho_expense_id TEXT NOT NULL UNIQUE,
    zoho_report_id TEXT,
    zoho_report_name TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'corrected', 'rejected', 'auto_processed')),
    vendor_name TEXT NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    expense_date DATE NOT NULL,
    category_name TEXT,
    paid_through TEXT,
    receipt_url TEXT,
    category_suggested TEXT,
    state_suggested TEXT,
    confidence_score INTEGER CHECK (confidence_score >= 0 AND confidence_score <= 100),
    flag_reason TEXT,
    suggested_bank_txn_id UUID REFERENCES bank_transactions(id),
    alternate_bank_txn_ids UUID[],
    is_reimbursement BOOLEAN DEFAULT FALSE,
    reimbursement_method TEXT,
    reimbursement_reference TEXT,
    reimbursed_at TIMESTAMPTZ,
    reimbursed_by TEXT,
    reviewed_by TEXT,
    reviewed_at TIMESTAMPTZ,
    corrections JSONB DEFAULT '{}',
    original_data JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Create zoho_expenses table (queue-based processing)
CREATE TABLE IF NOT EXISTS zoho_expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    zoho_expense_id TEXT UNIQUE NOT NULL,
    zoho_report_id TEXT NOT NULL,
    zoho_report_name TEXT,
    raw_payload JSONB NOT NULL,
    expense_date DATE NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    merchant_name TEXT,
    category_name TEXT,
    state_tag TEXT,
    paid_through TEXT,
    receipt_storage_path TEXT,
    receipt_content_type TEXT,
    status TEXT DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'matched', 'posted', 'flagged', 'error')),
    processing_attempts INT DEFAULT 0,
    processing_started_at TIMESTAMPTZ,
    last_error TEXT,
    flag_reason TEXT,
    bank_transaction_id UUID REFERENCES bank_transactions(id),
    match_confidence INT CHECK (match_confidence >= 0 AND match_confidence <= 100),
    qbo_purchase_id TEXT,
    qbo_posted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    processed_at TIMESTAMPTZ
);

-- 4. Create monday_events table (currently not used - n8n queries API directly)
CREATE TABLE IF NOT EXISTS monday_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    monday_item_id TEXT NOT NULL UNIQUE,
    board_id TEXT NOT NULL,
    group_id TEXT,
    event_name TEXT NOT NULL,
    venue TEXT,
    venue_code TEXT,
    state TEXT CHECK (state IN ('CA', 'TX', 'CO', 'WA', 'NJ', 'FL', 'MT')),
    start_date DATE NOT NULL,
    end_date DATE,
    course_type TEXT,
    client_name TEXT,
    is_open_enrollment BOOLEAN DEFAULT FALSE,
    total_expenses DECIMAL(10,2) DEFAULT 0,
    expense_count INTEGER DEFAULT 0,
    last_synced_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Enable pg_net extension for queue controller
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- 6. Add bank_transaction_id to categorization_history
ALTER TABLE categorization_history
    ADD COLUMN IF NOT EXISTS bank_transaction_id UUID;

-- 7. Add tracking columns to vendor_rules
ALTER TABLE vendor_rules ADD COLUMN IF NOT EXISTS match_count INTEGER DEFAULT 0;
ALTER TABLE vendor_rules ADD COLUMN IF NOT EXISTS last_matched_at TIMESTAMPTZ;
ALTER TABLE vendor_rules ADD COLUMN IF NOT EXISTS created_by TEXT;

-- 8. Create indexes
CREATE INDEX IF NOT EXISTS idx_bank_txn_status ON bank_transactions(status);
CREATE INDEX IF NOT EXISTS idx_bank_txn_date ON bank_transactions(transaction_date);
CREATE INDEX IF NOT EXISTS idx_bank_txn_amount ON bank_transactions(amount);
CREATE INDEX IF NOT EXISTS idx_bank_txn_matching ON bank_transactions(status, transaction_date, amount);
CREATE INDEX IF NOT EXISTS idx_bank_txn_zoho ON bank_transactions(matched_expense_id);
CREATE INDEX IF NOT EXISTS idx_bank_txn_orphans ON bank_transactions(status, transaction_date)
    WHERE status = 'unmatched';
CREATE INDEX IF NOT EXISTS idx_expense_queue_status ON expense_queue(status);
CREATE INDEX IF NOT EXISTS idx_expense_queue_date ON expense_queue(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_expense_queue_reimbursement ON expense_queue(is_reimbursement)
    WHERE is_reimbursement = true;
CREATE INDEX IF NOT EXISTS idx_zoho_expenses_status ON zoho_expenses(status);
CREATE INDEX IF NOT EXISTS idx_zoho_expenses_pending ON zoho_expenses(status, created_at)
    WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_zoho_expenses_processing ON zoho_expenses(status, processing_started_at)
    WHERE status = 'processing';
CREATE INDEX IF NOT EXISTS idx_zoho_expenses_bank_txn ON zoho_expenses(bank_transaction_id);
CREATE INDEX IF NOT EXISTS idx_zoho_expenses_date ON zoho_expenses(expense_date);
CREATE INDEX IF NOT EXISTS idx_monday_events_dates ON monday_events(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_monday_events_state ON monday_events(state);
CREATE INDEX IF NOT EXISTS idx_cat_history_bank_txn ON categorization_history(bank_transaction_id);
CREATE INDEX IF NOT EXISTS idx_cat_history_zoho_id ON categorization_history(zoho_expense_id);

-- 9. Enable RLS
ALTER TABLE bank_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE zoho_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE monday_events ENABLE ROW LEVEL SECURITY;

-- 10. Create RLS policies
CREATE POLICY "Allow authenticated users" ON bank_transactions
    FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow authenticated users" ON expense_queue
    FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow authenticated users" ON zoho_expenses
    FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow authenticated users" ON monday_events
    FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Service role full access" ON bank_transactions
    FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON expense_queue
    FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON zoho_expenses
    FOR ALL USING (auth.role() = 'service_role');

-- 11. Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 12. Apply triggers for updated_at
CREATE TRIGGER update_bank_transactions_updated_at
    BEFORE UPDATE ON bank_transactions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_expense_queue_updated_at
    BEFORE UPDATE ON expense_queue
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_monday_events_updated_at
    BEFORE UPDATE ON monday_events
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 13. Create queue controller function
CREATE OR REPLACE FUNCTION process_expense_queue()
RETURNS TRIGGER AS $$
DECLARE
    processing_count INT;
    next_expense RECORD;
    slots_available INT;
    max_concurrent CONSTANT INT := 5;  -- Maximum concurrent n8n executions
BEGIN
    -- Only act on relevant events
    IF TG_OP = 'UPDATE' THEN
        -- Only trigger when an expense finishes processing
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
        -- Claim next pending expense
        -- FOR UPDATE SKIP LOCKED prevents race conditions
        UPDATE zoho_expenses
        SET
            status = 'processing',
            processing_started_at = NOW(),
            processing_attempts = processing_attempts + 1
        WHERE id = (
            SELECT id FROM zoho_expenses
            WHERE status = 'pending'
            ORDER BY created_at ASC  -- FIFO order
            LIMIT 1
            FOR UPDATE SKIP LOCKED   -- Skip if another transaction has this row
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

-- 14. Create queue controller triggers
CREATE TRIGGER trigger_queue_on_insert
    AFTER INSERT ON zoho_expenses
    FOR EACH ROW
    EXECUTE FUNCTION process_expense_queue();

CREATE TRIGGER trigger_queue_on_completion
    AFTER UPDATE OF status ON zoho_expenses
    FOR EACH ROW
    WHEN (NEW.status IN ('posted', 'error', 'flagged'))
    EXECUTE FUNCTION process_expense_queue();

-- 15. Create dashboard stats view
CREATE OR REPLACE VIEW dashboard_stats AS
SELECT
    -- Review queues
    (SELECT COUNT(*) FROM expense_queue WHERE status = 'pending' AND is_reimbursement = false) AS pending_reviews,
    (SELECT COUNT(*) FROM expense_queue WHERE status = 'pending' AND is_reimbursement = true) AS pending_reimbursements,

    -- Bank transaction status
    (SELECT COUNT(*) FROM bank_transactions WHERE status = 'unmatched') AS unmatched_bank_txns,
    (SELECT COUNT(*) FROM bank_transactions
        WHERE status = 'unmatched'
        AND transaction_date < CURRENT_DATE - INTERVAL '5 days') AS orphan_bank_txns,

    -- Processing stats
    (SELECT COUNT(*) FROM categorization_history WHERE DATE(created_at) = CURRENT_DATE) AS processed_today,
    (SELECT COALESCE(SUM(amount), 0) FROM categorization_history WHERE DATE(created_at) = CURRENT_DATE) AS amount_today,
    (SELECT COUNT(*) FROM categorization_history WHERE was_corrected = true AND DATE(created_at) >= CURRENT_DATE - INTERVAL '7 days') AS corrections_this_week,

    -- Weekly totals
    (SELECT COALESCE(SUM(amount), 0) FROM categorization_history WHERE DATE(created_at) >= CURRENT_DATE - INTERVAL '7 days') AS amount_this_week;

-- Done!
SELECT 'Migration completed successfully' AS status;
```

---

## Future Considerations (SaaS)

When pivoting to multi-tenant SaaS:

1. Add `organization_id` to all tables
2. Update RLS policies to filter by organization
3. Add `organizations` and `organization_members` tables
4. Implement organization-scoped API keys for n8n

---

*End of Database Schema Document*
