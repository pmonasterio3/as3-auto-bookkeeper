# AS3 Auto Bookkeeper - Business Rules & Truth Source

**Version:** 2.0
**Last Updated:** December 8, 2025
**Purpose:** Single source of truth for all business rules, data authority, and system behavior

---

## Section 1: System Architecture

### 1.1 Three-Agent Architecture

| Agent | Trigger | Purpose | Uses vendor_rules? |
|-------|---------|---------|-------------------|
| **Agent 1: Zoho Expense Processor** | Webhook (Zoho report approved) | Match Zoho expenses to bank transactions, verify, post to QBO | **NO** |
| **Agent 2: Orphan & Recurring Processor** | Schedule (daily) | Process unmatched bank txns after 45 days | **YES** |
| **Agent 3: Income Reconciler** | Schedule (weekly) | Match STRIPE deposits to WooCommerce orders | **NO** |

### 1.2 Component Responsibilities

| Component | Does | Does NOT Do |
|-----------|------|-------------|
| **Web App** | Import CSVs, display data, human review UI | Match expenses, determine state, post to QBO |
| **n8n Agents** | Match expenses, determine state/category, verify, request QBO posting | Store raw data, modify QBO Chart of Accounts |
| **Supabase** | Store data, enforce constraints, RLS | Business logic, external API calls |
| **QBO** | Store purchases, track accounts | Be modified by this system (accounts are READ-ONLY) |

### 1.3 Critical Constraints

1. **Web App NEVER posts directly to QBO** - All QBO operations go through n8n agents
2. **QBO Chart of Accounts is READ-ONLY** - We read accounts, never create/modify them
3. **Agents verify before posting** - Even high-confidence matches are verified by agent before QBO post
4. **Bank transactions are immutable** - Core fields (date, description, amount) never change after import

---

## Section 2: Transaction Classification

### 2.1 Transaction Types

| Amount Sign | Contains STRIPE? | Classification | Routed To |
|-------------|------------------|----------------|-----------|
| Positive | N/A | EXPENSE | Agent 1 (if Zoho match) or Agent 2 (orphan) |
| Negative | Yes | INCOME_DEPOSIT | Agent 3 |
| Negative | No | REFUND_CREDIT | Match to original expense, same QBO account |

### 2.2 Transaction Status Flow

```
IMPORT → 'unmatched'
    │
    ├─→ Zoho match found → 'matched' (Agent 1)
    │
    ├─→ 45 days pass, no match → 'orphan_processed' (Agent 2)
    │
    ├─→ Manual exclusion → 'excluded'
    │
    └─→ Manual entry → 'manual_entry'
```

---

## Section 3: State Determination Rules

### 3.1 State Sources (in priority order)

| Priority | Source | Used By | Reliability |
|----------|--------|---------|-------------|
| 1 | Zoho "Course Location" tag | Agent 1 | HIGH |
| 2 | Monday.com event venue | Agent 1 (COS expenses) | VERY HIGH |
| 3 | vendor_rules.default_state | Agent 2 | MEDIUM |
| 4 | Bank description parsing | Agent 2 | LOW |
| 5 | Course date proximity | Agent 2 | MEDIUM |
| 6 | Human review | All | HIGHEST |

### 3.2 Special State Mappings

| Zoho Tag Value | Maps To | Notes |
|----------------|---------|-------|
| "California" | CA | |
| "Texas" | TX | |
| "Colorado" | CO | |
| "Washington" | WA | |
| "New Jersey" | NJ | |
| "Florida" | FL | |
| "Montana" | MT | |
| **"Other"** | **NC** | Admin/home office state |

### 3.3 COS vs Non-COS State Logic

```
IF category ends with "- COS":
    state = Monday.com event venue (primary)
    fallback = Zoho tag (secondary)
ELSE (Non-COS):
    state = Zoho "Course Location" tag (primary)
    fallback = "NC" (admin state)
```

---

## Section 4: Category Rules

### 4.1 Category Source Priority

| Priority | Source | Context |
|----------|--------|---------|
| 1 | Zoho expense category_name | Agent 1 |
| 2 | vendor_rules.default_category | Agent 2 |
| 3 | Human review | Both |

### 4.2 COS Category Validation

- COS reports (name starts with "C##") should have categories ending in "- COS"
- Non-COS reports should NOT have "- COS" categories
- Mismatch = flag for review, reduce confidence by 15%

---

## Section 5: Matching Rules

### 5.1 Bank Transaction Matching (Agent 1)

| Field | Match Criteria |
|-------|---------------|
| Amount | Within $0.50 tolerance |
| Date | Within 5 days of expense date |
| Vendor | Description contains similar vendor name |

### 5.2 Credit/Refund Matching

| Criteria | Action |
|----------|--------|
| Full refund (amounts match within $0.50) | Auto-process, same QBO account as original |
| Partial refund | Flag for human review |
| No original transaction found | Flag for human review |
| Match window | 60 days prior to refund date |

### 5.3 Grace Periods

| Scenario | Grace Period |
|----------|--------------|
| Zoho expense matching | 5 days (bank posting lag) |
| Orphan declaration | **45 days** from transaction_date |
| Credit matching | 60 days lookback |

---

## Section 6: Confidence Scoring

### 6.1 Starting Score: 100

### 6.2 Deductions

| Issue | Deduction |
|-------|-----------|
| No bank transaction match | -40 |
| Receipt amount mismatch (>$1) | -30 |
| No receipt attached | -25 |
| COS expense without Monday event | -40 |
| State unclear/mismatch | -20 |
| Category mismatch with report type | -15 |
| Unknown vendor (no rule) | -5 |

### 6.3 Decision Thresholds

| Confidence | Action |
|------------|--------|
| >= 95% | Auto-process (agent verifies, then posts to QBO) |
| < 95% | Queue for human review |

---

## Section 7: Human Review Requirements

### 7.1 When Flagged

1. AI confidence < 95%
2. No receipt attached to Zoho expense
3. Partial refund
4. Unknown vendor (no vendor rule match)
5. Ambiguous state determination
6. Amount mismatch between receipt and claim

### 7.2 Human Review Interface Must Support

1. View transaction details and receipt
2. Upload receipt (if missing)
3. Assign/correct category
4. Assign/correct state
5. Trigger re-processing through agent
6. Mark as reviewed

### 7.3 Post-Review Flow

```
Human approves/corrects in UI
    ↓
Update expense_queue.corrections JSONB
    ↓
Trigger n8n webhook for re-processing
    ↓
Agent verifies and posts to QBO
    ↓
Update bank_transaction status
```

---

## Section 8: ZELLE/VENMO Handling

**CRITICAL CLARIFICATION:** ZELLE/VENMO payments ARE Zoho expenses

| Aspect | Rule |
|--------|------|
| Payment method in Zoho | "Wells Fargo Debit" |
| Processed by | Agent 1 (Zoho Expense Processor) |
| Receipt required | **YES** - must have receipt attached |
| If no receipt | Flag for human review |
| After human uploads receipt | Re-process through agent, then sync to QBO |

---

## Section 9: Income Handling (Agent 3)

### 9.1 STRIPE Deposits

| Field | Source |
|-------|--------|
| Deposit amount | Bank transaction (negative = credit) |
| Order details | WooCommerce API |
| State allocation | WooCommerce product → course location mapping |
| QBO Account | "Open Enrollment Courses (Stripe Sales)" |

### 9.2 WooCommerce Product Mapping

Each WooCommerce product maps to:
- Course type
- Default location/state
- QBO income account

---

## Section 10: QBO Account Selection

### 10.1 Payment Account Selection

| bank_transactions.source | QBO Payment Account | QBO ID |
|--------------------------|---------------------|--------|
| amex | AMEX Business 61002 | 99 |
| wells_fargo | Wells Fargo AS3 Driver Training (3170) | 49 |

### 10.2 Expense Account Selection

1. Look up Zoho category_name in qbo_accounts.zoho_category_match
2. Use corresponding qbo_accounts.qbo_id
3. Consider qbo_accounts.times_used for ranking when multiple matches

### 10.3 Account Preference Learning

- `qbo_accounts.times_used` tracks how often each account is selected
- Higher times_used = higher preference in AI suggestions
- Incremented when agent successfully posts to QBO using that account

---

## Section 11: Vendor Rules (Agent 2 Only)

### 11.1 Purpose

Vendor rules are ONLY used by Agent 2 for orphan transactions that have no Zoho expense match.

### 11.2 Schema

```sql
vendor_rules (
  vendor_pattern,      -- Pattern to match in description
  default_category,    -- Suggested QBO category
  default_state,       -- Suggested state (NULL = varies)
  is_cogs,            -- Is this a cost of goods sold?
  confidence,         -- Base confidence (0-100)
  times_used          -- Usage count for learning
)
```

### 11.3 Learning

- When human corrects an orphan transaction, create/update vendor_rule
- Increment times_used on successful match
- Higher times_used = higher confidence

---

## Section 12: Monday.com Integration (DEFERRED)

**Status:** DEFERRED until QBO flows are solid

### 12.1 Future Design

- Query Monday.com API directly (no local caching)
- Create subitems under course events for COS expenses
- Link expense to event for P&L reporting

### 12.2 No monday_events Table

- There is NO monday_events table in the database
- n8n queries Monday.com GraphQL API directly when needed

---

## Section 13: Data Immutability Rules

### 13.1 Immutable After Import

| Table | Fields |
|-------|--------|
| bank_transactions | transaction_date, description, amount, source, description_normalized |

### 13.2 Set Once (Never Changed After)

| Table | Fields |
|-------|--------|
| bank_transactions | matched_expense_id, matched_at, qbo_purchase_id |

### 13.3 Can Be Updated

| Table | Fields | By Whom |
|-------|--------|---------|
| bank_transactions | status, orphan_category, orphan_state | n8n agents |
| expense_queue | corrections, status | Human + n8n |
| vendor_rules | times_used, match_count | n8n (auto-increment) |
| qbo_accounts | times_used | n8n (auto-increment) |

---

## Section 14: Error Handling

### 14.1 Retry Strategy

| Error Type | Retries | Backoff |
|------------|---------|---------|
| Supabase connection | 3 | Exponential (1s, 2s, 4s) |
| QBO API rate limit | 3 | 30 seconds |
| QBO OAuth expired | 1 | Refresh token, retry |
| Receipt fetch failed | 0 | Continue, reduce confidence |
| AI iteration limit | 0 | Queue remaining for review |

### 14.2 On Failure

- Log error to workflow_errors table
- Queue affected items for human review
- Continue processing remaining items

---

## Section 15: Reimbursements

### 15.1 Detection

A Zoho expense with NO matching bank transaction = Employee used personal card = Reimbursement needed

### 15.2 Handling

- Reimbursements are paid through QBO directly (Accounts Payable)
- This system only DETECTS potential reimbursements
- Flagged with `is_reimbursement: true` in expense_queue
- Human confirms and processes payment outside this system

---

## Appendix A: State Codes

| Code | State | Venues |
|------|-------|--------|
| CA | California | Laguna Seca (LS), Willow Springs (WS), Sonoma (SON), Crows Landing (CL) |
| TX | Texas | Texas Motor Speedway (TMS) |
| CO | Colorado | Western Colorado Dragway (WCD) |
| WA | Washington | Evergreen Speedway (ES), Pacific Raceways (PR) |
| NJ | New Jersey | New Jersey Motorsports Park (NJMP) |
| FL | Florida | South Florida Fairgrounds (SFF) |
| MT | Montana | Gallatin County Fairgrounds (GCF) |
| NC | North Carolina | Admin/Home Office (default for "Other") |

---

## Appendix B: Document References

| Document | Purpose |
|----------|---------|
| SYSTEM_BOUNDARIES.md | Who can modify what |
| n8n-workflow-spec.md | Agent implementation details |
| database-schema.md | Table structures |
| expense-automation-architecture.md | System overview |

---

*End of Business Rules Document*
