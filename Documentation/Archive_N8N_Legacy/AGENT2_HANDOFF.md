# Agent 2: Orphan & Recurring Processor - Implementation Handoff

**Version:** 1.0
**Date:** December 10, 2025
**Status:** Ready for Implementation
**Prerequisite:** Agent 1 (Zoho Expense Processor) is complete and working

---

## Executive Summary

Agent 2 processes "orphan" bank transactions - corporate card charges that have no matching Zoho expense after a 45-day grace period. Unlike Agent 1, Agent 2 **USES vendor_rules** to determine category and state since there is no Zoho context available.

---

## Agent 2 vs Agent 1 Comparison

| Aspect | Agent 1 | Agent 2 |
|--------|---------|---------|
| **Trigger** | Zoho webhook (real-time) | Scheduled batch (daily) |
| **Input** | Zoho expense + bank transactions | Bank transactions only |
| **Uses vendor_rules** | NO (Zoho has category/state) | YES (no Zoho context) |
| **State Source** | Zoho "Course Location" tag | vendor_rules → parse description → manual |
| **Category Source** | Zoho category_name | vendor_rules → manual |
| **Grace Period** | N/A | 45 days before processing |
| **n8n Workflow** | ZZPC3jm6mXbLrp3u (exists) | NEW WORKFLOW NEEDED |

---

## What is an "Orphan" Transaction?

An orphan is a bank transaction (corporate card charge) that:
1. Has **status = 'unmatched'** (not matched by Agent 1)
2. Is **older than 45 days** (grace period expired)
3. Was never submitted as a Zoho expense

**Common causes:**
- Employee forgot to submit expense report
- Recurring subscription (automatically charged, no receipt)
- Small purchases employee deemed not worth reporting
- Company-wide expenses (software subscriptions, etc.)

---

## Database Query for Orphans

```sql
SELECT
  id,
  transaction_date,
  description,
  amount,
  source,
  extracted_vendor,
  description_normalized
FROM bank_transactions
WHERE status = 'unmatched'
  AND transaction_date < CURRENT_DATE - INTERVAL '45 days'
ORDER BY transaction_date ASC;
```

**Current orphan count (estimate):** Run this query to see how many exist.

---

## State Determination Waterfall

Agent 2 determines state using this priority order:

### Step 1: Check vendor_rules.default_state
```sql
SELECT default_state, default_category
FROM vendor_rules
WHERE LOWER(extracted_vendor) LIKE LOWER('%' || vendor_pattern || '%');
```

If match found AND default_state is not null → Use that state.

### Step 2: Parse State from Description
Many bank descriptions include state codes:
- `"CHEVRON DALLAS TX"` → TX
- `"PILOT PATTERSON CA"` → CA
- `"HAMPTON INN SAN JOSE CA"` → CA

Parse pattern: Last two uppercase letters before card suffix.

### Step 3: Date Proximity to Courses (Optional)
If transaction date falls within a course event window, use venue state:
- Query Monday.com API for events around that date
- Match venue to state (Laguna Seca → CA, Texas Motor Speedway → TX)

**NOTE:** This step may be deferred initially for simplicity.

### Step 4: Queue for Human Review
If state cannot be determined → Insert to expense_queue for manual review.

---

## Category Determination

### Step 1: Check vendor_rules.default_category
```sql
SELECT default_category
FROM vendor_rules
WHERE LOWER(extracted_vendor) LIKE LOWER('%' || vendor_pattern || '%');
```

### Step 2: Unknown Vendor
If no vendor_rules match → Queue for human review with suggestions.

**Common recurring expenses to pre-populate in vendor_rules:**
- BILL.COM → "Accounting Software"
- MICROSOFT → "Software Subscriptions"
- MEDIUM → "Software Subscriptions"
- GOOGLE → "Software Subscriptions"
- DESCRIPT → "Software Subscriptions"
- HERTZ/AVIS/ENTERPRISE → "Car Rental - COS" or "Car Rental"

---

## Confidence Scoring

Start at 100, subtract for issues:

| Issue | Deduction |
|-------|-----------|
| No vendor_rules match | -30 |
| State from parsing (not rules) | -10 |
| State could not be determined | -40 |
| Amount > $500 (high value needs review) | -20 |
| Negative amount (credit/refund) | -25 |

**Decision thresholds:**
- Confidence >= 90: Auto-post to QBO
- Confidence < 90: Queue for human review

---

## n8n Workflow Design

### Trigger
**Schedule Trigger** - Run daily at 6 AM (before business hours)

### Node Flow

```
Schedule Trigger
    → Query Orphan Transactions (Supabase)
    → Split Out (process one at a time)
    → Lookup Vendor Rules (Supabase)
    → Parse State from Description (Code node)
    → AI Agent (validate & decide)
    → Parse AI Decision (Code node)
    → IF Confident
        TRUE  → Post to QBO → Update Bank Transaction
        FALSE → Queue for Review
```

### Key Differences from Agent 1

1. **No receipt fetch** - Orphans don't have receipts
2. **No Zoho data** - Everything from bank transaction + vendor_rules
3. **Uses vendor_rules** - AI tool for lookup
4. **Batch processing** - Multiple transactions per run
5. **Lower auto-approval threshold** - More conservative (90% vs 95%)

---

## AI Agent Configuration

### AI Tools Connected (3 tools)

1. **vendor_rules (Get)** - Lookup category/state defaults
2. **categorization_history (Create)** - Audit trail (REQUIRED)
3. **flagged_expenses (Create)** - Queue uncertain items

### System Prompt (Draft)

```
## Identity
You are an orphan transaction processor for AS3 Driver Training. You categorize corporate card charges that have no matching Zoho expense report.

## Context
You are processing bank transactions older than 45 days that were never submitted as Zoho expenses. For each transaction, determine:
1. Category (from vendor_rules or common patterns)
2. State (from vendor_rules, description parsing, or flag for review)
3. Confidence level

## State Reference
Use vendor_rules.default_state if available. Otherwise parse from description:
- Two-letter state codes (CA, TX, CO, WA, NJ, FL, MT)
- City names that map to states (Dallas→TX, San Jose→CA)
- If cannot determine, flag for human review with suggested states

## Category Reference
Use vendor_rules.default_category if available. Common patterns:
- Gas stations (CHEVRON, SHELL, PILOT) → "Fuel - COS" or "Fuel - Company Vehicle"
- Hotels (HAMPTON, MARRIOTT, HILTON) → "Lodging - COS"
- Software (MICROSOFT, GOOGLE, BILL.COM) → "Software Subscriptions"
- Airlines (SOUTHWEST, UNITED) → "Airfare - COS"
- Car rental (HERTZ, AVIS, ENTERPRISE) → "Car Rental - COS"

## Confidence Scoring
Start at 100:
- No vendor_rules match: -30
- State parsed (not from rules): -10
- State unknown: -40
- Amount > $500: -20
- Credit/refund (negative): -25

## Decision
- confidence >= 90 AND state known → APPROVED (will post to QBO)
- confidence < 90 OR state unknown → FLAGGED (queue for review)

## Tools
1. vendor_rules - ALWAYS check first for category/state defaults
2. categorization_history - ALWAYS log for audit trail
3. flagged_expenses - Call when flagging uncertain items

## Output
First word: APPROVED or FLAGGED
Then: Vendor, category, state (or "unknown"), confidence, reason
```

### User Prompt Template

```
ORPHAN TRANSACTION:
- ID: {{ $json.id }}
- Date: {{ $json.transaction_date }}
- Amount: {{ $json.amount }}
- Description: {{ $json.description }}
- Vendor (extracted): {{ $json.extracted_vendor }}
- Source: {{ $json.source }}

VENDOR RULE MATCH: {{ $json.vendor_rule ? 'Found - Category: ' + $json.vendor_rule.default_category + ', State: ' + ($json.vendor_rule.default_state || 'Not set') : 'None' }}

PARSED STATE: {{ $json.parsed_state || 'Could not parse' }}

Categorize this orphan transaction.
```

---

## Database Updates for Agent 2

### After Successful Processing

```sql
UPDATE bank_transactions
SET
  status = 'orphan_processed',
  orphan_category = '<category>',
  orphan_state = '<state>',
  orphan_processed_at = NOW(),
  orphan_processed_by = 'agent_2',
  qbo_purchase_id = '<id from QBO>'
WHERE id = '<transaction_id>';
```

### When Flagged for Review

```sql
INSERT INTO expense_queue (
  source,
  transaction_date,
  vendor_raw,
  amount,
  description,
  predicted_category,
  predicted_state,
  predicted_confidence,
  flag_reason,
  bank_transaction_id,
  status
) VALUES (
  '<source>',
  '<date>',
  '<vendor>',
  <amount>,
  '<description>',
  '<category_guess>',
  '<state_guess>',
  <confidence>,
  '<reason>',
  '<bank_transaction_id>',
  'pending'
);
```

---

## Vendor Rules Seed Data

Pre-populate vendor_rules with common recurring expenses:

```sql
INSERT INTO vendor_rules (vendor_pattern, default_category, default_state, is_cogs, notes) VALUES
('BILL.COM', 'Accounting Software', 'NC', false, 'Monthly subscription'),
('MICROSOFT', 'Software Subscriptions', 'NC', false, 'O365, Azure, etc.'),
('GOOGLE', 'Software Subscriptions', 'NC', false, 'Workspace, Cloud'),
('DESCRIPT', 'Software Subscriptions', 'NC', false, 'Video editing'),
('MEDIUM', 'Software Subscriptions', 'NC', false, 'Publishing platform'),
('CHEVRON', 'Fuel - COS', NULL, true, 'State from location'),
('SHELL', 'Fuel - COS', NULL, true, 'State from location'),
('PILOT', 'Fuel - COS', NULL, true, 'State from location'),
('HAMPTON', 'Lodging - COS', NULL, true, 'State from location'),
('MARRIOTT', 'Lodging - COS', NULL, true, 'State from location'),
('HILTON', 'Lodging - COS', NULL, true, 'State from location'),
('HERTZ', 'Car Rental - COS', NULL, true, 'State from location'),
('AVIS', 'Car Rental - COS', NULL, true, 'State from location'),
('ENTERPRISE', 'Car Rental - COS', NULL, true, 'State from location'),
('SOUTHWEST', 'Airfare - COS', NULL, true, 'Check destination'),
('UNITED', 'Airfare - COS', NULL, true, 'Check destination'),
('DELTA', 'Airfare - COS', NULL, true, 'Check destination'),
('CHIPOTLE', 'Meals - COS', NULL, true, 'State from location'),
('STARBUCKS', 'Meals - COS', NULL, true, 'State from location')
ON CONFLICT (vendor_pattern) DO NOTHING;
```

---

## Implementation Checklist

### Phase 1: Setup
- [ ] Create new n8n workflow "Orphan Transaction Processor"
- [ ] Add Schedule Trigger (daily at 6 AM)
- [ ] Add Query Orphan Transactions node (Supabase, 45-day filter)
- [ ] Add Split Out node for batch processing

### Phase 2: Data Enrichment
- [ ] Add Lookup Vendor Rules node
- [ ] Add Parse State from Description (Code node)
- [ ] Add Lookup QBO Accounts node

### Phase 3: AI Agent
- [ ] Add AI Agent with system prompt above
- [ ] Connect 3 tools: vendor_rules, categorization_history, flagged_expenses
- [ ] Add Anthropic Chat Model (Claude Sonnet)

### Phase 4: Post-Processing
- [ ] Add Parse AI Decision (Code node)
- [ ] Add IF Confident routing
- [ ] Add Post to QBO (or Mock for testing)
- [ ] Add Update Bank Transaction (Supabase)
- [ ] Add Queue for Review fallback

### Phase 5: Testing
- [ ] Seed vendor_rules with common patterns
- [ ] Run with 5 orphan transactions
- [ ] Verify categorization_history logs
- [ ] Verify bank_transactions updates
- [ ] Check expense_queue for flagged items

### Phase 6: Production
- [ ] Enable real QBO posting (remove mock)
- [ ] Monitor first few days
- [ ] Add Teams notification for flagged items
- [ ] Review and adjust confidence thresholds

---

## Testing Strategy

### Test Case 1: Known Vendor
**Input:** CHEVRON transaction from CA
**Expected:** Category from vendor_rules, state parsed from description

### Test Case 2: Unknown Vendor
**Input:** Random vendor not in rules
**Expected:** Flagged for review with suggestions

### Test Case 3: Software Subscription
**Input:** MICROSOFT 365 subscription
**Expected:** Category "Software Subscriptions", state "NC" (admin)

### Test Case 4: High Value
**Input:** $800 HERTZ car rental
**Expected:** Flagged due to high value, suggested category

### Test Case 5: Credit/Refund
**Input:** Negative amount (credit)
**Expected:** Flagged, needs matching to original

---

## Success Criteria

1. **Orphans processed:** 45+ day old transactions categorized
2. **Vendor rules used:** Known vendors auto-categorized
3. **State accuracy:** States correctly determined or flagged
4. **Conservative threshold:** Only high-confidence items auto-posted
5. **Audit trail:** All decisions logged to categorization_history
6. **No data loss:** Uncertain items queued, not discarded

---

## Rollback Plan

If Agent 2 causes issues:
1. Disable Schedule Trigger in n8n
2. Orphans remain in 'unmatched' status (safe)
3. Manual processing via web app review queue
4. Fix issues and re-enable

---

## Questions for Human Before Starting

1. **Schedule time:** Is 6 AM daily appropriate, or different time?
2. **Batch size:** Process all orphans at once, or limit to 50/day?
3. **Auto-post threshold:** Is 90% confidence appropriate, or higher?
4. **Vendor rules:** Any additional common vendors to add?
5. **Notifications:** Teams message for flagged items, or just log?

---

*End of Agent 2 Handoff Document*
