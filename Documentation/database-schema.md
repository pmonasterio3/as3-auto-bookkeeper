# AS3 Expense Automation - Database Schema

**Version:** 1.0
**Last Updated:** December 6, 2025
**Database:** Supabase (PostgreSQL)

---

## Table of Contents

1. [Overview](#overview)
2. [Existing Tables](#existing-tables)
3. [New Tables](#new-tables)
4. [Indexes](#indexes)
5. [Row Level Security](#row-level-security)
6. [Triggers & Functions](#triggers--functions)
7. [Views](#views)
8. [Migration Script](#migration-script)

---

## Overview

The AS3 Expense Automation system uses Supabase (PostgreSQL) as its primary data store. This document describes:

- **Existing tables** that must be preserved (categorization_history, vendor_rules, flagged_expenses, qbo_accounts)
- **New tables** to be created (bank_transactions, expense_queue, monday_events)
- **Relationships** between tables
- **Security policies** for Row Level Security (RLS)

### Entity Relationship Diagram

```
┌─────────────────────┐       ┌─────────────────────┐
│  bank_transactions  │       │   expense_queue     │
├─────────────────────┤       ├─────────────────────┤
│ id (PK)             │───┐   │ id (PK)             │
│ source              │   │   │ zoho_expense_id     │
│ transaction_date    │   │   │ status              │
│ amount              │   │   │ vendor_name         │
│ description         │   └──>│ suggested_bank_txn_id│
│ status              │       │ confidence_score    │
│ matched_expense_id  │──────>│ corrections (JSONB) │
│ qbo_purchase_id     │       └─────────────────────┘
│ monday_subitem_id   │               │
└─────────────────────┘               │
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

### monday_events

**Purpose:** Local cache of Monday.com course events for fast lookup without API calls.

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

CREATE POLICY "Allow authenticated users" ON monday_events
    FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users" ON categorization_history
    FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users" ON vendor_rules
    FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users" ON qbo_accounts
    FOR ALL USING (auth.role() = 'authenticated');

-- Service role bypass for n8n webhooks
CREATE POLICY "Service role full access" ON bank_transactions
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access" ON expense_queue
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

-- 3. Create monday_events table
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

-- 4. Add bank_transaction_id to categorization_history
ALTER TABLE categorization_history
    ADD COLUMN IF NOT EXISTS bank_transaction_id UUID;

-- 5. Add tracking columns to vendor_rules
ALTER TABLE vendor_rules ADD COLUMN IF NOT EXISTS match_count INTEGER DEFAULT 0;
ALTER TABLE vendor_rules ADD COLUMN IF NOT EXISTS last_matched_at TIMESTAMPTZ;
ALTER TABLE vendor_rules ADD COLUMN IF NOT EXISTS created_by TEXT;

-- 6. Create indexes
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
CREATE INDEX IF NOT EXISTS idx_monday_events_dates ON monday_events(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_monday_events_state ON monday_events(state);
CREATE INDEX IF NOT EXISTS idx_cat_history_bank_txn ON categorization_history(bank_transaction_id);
CREATE INDEX IF NOT EXISTS idx_cat_history_zoho_id ON categorization_history(zoho_expense_id);

-- 7. Enable RLS
ALTER TABLE bank_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE monday_events ENABLE ROW LEVEL SECURITY;

-- 8. Create RLS policies
CREATE POLICY "Allow authenticated users" ON bank_transactions
    FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow authenticated users" ON expense_queue
    FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow authenticated users" ON monday_events
    FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Service role full access" ON bank_transactions
    FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON expense_queue
    FOR ALL USING (auth.role() = 'service_role');

-- 9. Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 10. Apply triggers
CREATE TRIGGER update_bank_transactions_updated_at
    BEFORE UPDATE ON bank_transactions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_expense_queue_updated_at
    BEFORE UPDATE ON expense_queue
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_monday_events_updated_at
    BEFORE UPDATE ON monday_events
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 11. Create dashboard stats view
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
