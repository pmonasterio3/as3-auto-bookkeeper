# AS3 Auto Bookkeeper - System Boundaries and Responsibilities

**Version:** 1.2
**Last Updated:** December 8, 2025 (Three-Agent Architecture)
**Purpose:** Define clear boundaries between components to prevent architectural violations

**See Also:** `Technical_Docs/THREE_AGENT_ARCHITECTURE.md` for detailed three-agent specifications

---

## Table of Contents

1. [Critical Principle: Bank Transactions as Source of Truth](#critical-principle-bank-transactions-as-source-of-truth)
2. [Web App Import Responsibilities](#web-app-import-responsibilities)
3. [State Assignment Responsibilities](#state-assignment-responsibilities)
4. [Expense Matching Responsibilities](#expense-matching-responsibilities)
5. [QBO Export Format](#qbo-export-format)
6. [n8n Workflow Responsibilities](#n8n-workflow-responsibilities)
7. [What Goes Where: Quick Reference](#what-goes-where-quick-reference)
8. [Common Mistakes to Avoid](#common-mistakes-to-avoid)

---

## Critical Principle: Bank Transactions as Source of Truth

**FOUNDATIONAL RULE:** Bank transactions in the `bank_transactions` table are the **single source of truth** for all financial activity.

### Why This Matters

- **Tax Accuracy**: State assignments MUST be tied to actual expenses, not guesses
- **Duplicate Prevention**: One bank transaction = one expense, period
- **Audit Trail**: Every dollar spent has a verifiable bank record
- **Matching Integrity**: Zoho expenses MATCH TO existing bank records, not the other way around

### The Flow

```
Bank Statement (CSV)
    ↓
Web App Import (BankFeedPanel.tsx)
    ↓
bank_transactions table (status: 'unmatched')
    ↓
Zoho Expense Approved → n8n matches to bank transaction
    ↓
bank_transactions updated (status: 'matched', matched_expense_id set)
    ↓
QBO Purchase created
```

---

## Web App Import Responsibilities

### Component: `BankFeedPanel.tsx`

The web app import has **ONE JOB**: Store raw bank data accurately and consistently.

### DO: What the Web App Import MUST Do

1. **Parse CSV files** from QBO export format (SPENT/RECEIVED columns)
2. **Extract transaction metadata:**
   - Transaction date (from DATE column)
   - Description (from DESCRIPTION column)
   - Amount (SPENT = positive expense, RECEIVED = negative credit/refund)
   - Source (bank account key: 'amex' or 'wells_fargo')
3. **Normalize description** for deduplication (uppercase, alphanumeric only)
4. **Extract vendor name** from description (for display purposes only)
5. **Set initial status** to 'unmatched'
6. **Store credits/refunds** with negative amounts (NEVER skip them)
7. **Prevent duplicates** via unique constraint on (source, transaction_date, amount, description_normalized)

### DO NOT: What the Web App Import MUST NEVER Do

1. **DO NOT determine state** - The import has NO way to know if an expense occurred in CA or TX
2. **DO NOT set matched_expense_id** - Only n8n sets this after finding a Zoho expense match
3. **DO NOT set matching_confidence** - This is calculated by n8n's AI agent
4. **DO NOT categorize expenses** - Categories come from Zoho or vendor_rules
5. **DO NOT assign QBO account IDs** - That's determined during export based on category
6. **DO NOT skip RECEIVED/credit transactions** - Credits are essential for accurate bookkeeping
7. **DO NOT extract state from description** - State parsing happens in n8n orphan flow, not import
8. **DO NOT make business logic decisions** - Import is a data storage layer ONLY

### Current Implementation (Correct)

**Lines 255-261 in BankFeedPanel.tsx:**
```typescript
// NOTE: State extraction is NOT done during import.
// States are determined by:
// 1. Zoho Expense "Course Location" tag
// 2. n8n processing via vendor_rules
// 3. Manual review in attention queue
// The web app import only stores raw bank data.
```

**Lines 421-430 in BankFeedPanel.tsx:**
```typescript
const transactions: BankTransactionInsert[] = previewData.transactions.map(t => ({
  transaction_date: t.transaction_date,
  description: t.description,
  amount: t.amount,  // Positive = expense, Negative = credit/refund
  source: selectedAccount.account_key,
  description_normalized: t.description_normalized,
  extracted_vendor: t.extracted_vendor,
  // NOTE: extracted_state is NOT set during import - determined by n8n/Zoho
  status: 'unmatched',
}))
```

This implementation is **CORRECT**. Maintain this separation.

---

## State Assignment Responsibilities

### The Problem: Web App Has No Visibility Into Zoho Data

The web app import runs **independently** from Zoho Expense. When a CSV is imported:
- No Zoho expenses have been submitted yet (or may never be)
- No receipt images are available
- No "Course Location" tags exist
- No context about which course the expense relates to

**THEREFORE:** The web app CANNOT and MUST NOT attempt state assignment.

### State Determination Waterfall

States are assigned through **THREE DISTINCT MECHANISMS**, in order of preference:

#### 1. Zoho Expense "Course Location" Tag (Primary Source for Non-COS)

**Who:** n8n workflow processing approved Zoho expense reports
**When:** Immediately after expense report approval
**How:**
```javascript
// From Zoho webhook payload:
expense.line_items[0].tags.find(t => t.tag_name === "Course Location")?.tag_option_name
// Returns: "California", "Texas", "Colorado", "Washington", "New Jersey", "Florida", "Montana"
```

**Applies to:** Non-COS (admin) expenses where employee manually selected state

#### 2. Monday.com Event Venue (Primary Source for COS)

**Who:** n8n workflow matching expense to course event
**When:** During Zoho expense processing for COS-categorized expenses
**How:**
```javascript
// n8n queries Monday.com API directly (NOT a database table)
// GraphQL query to Monday.com board
query {
  items_by_column_values(
    board_id: 8294758830,
    column_id: "date",
    column_value: "${expense_date}"
  ) {
    name
    column_values {
      id
      value
    }
  }
}
// Extract state from venue column
```

**IMPORTANT:** Monday.com events are NOT stored in the database. n8n queries the Monday.com API directly when needed.

**Applies to:** Course-related expenses (categories ending in "- COS")

#### 3. Vendor Rules (Fallback for Orphan Transactions)

**Who:** n8n orphan processing workflow
**When:** 5+ days after import, if no Zoho expense has claimed the transaction
**How:**
```sql
SELECT default_state FROM vendor_rules
WHERE vendor_pattern ILIKE '%<extracted_vendor>%'
LIMIT 1
```

**Applies to:** Orphan bank transactions (no matching Zoho expense)

#### 4. Manual Review (Last Resort)

**Who:** Human reviewer in web dashboard
**When:** When all automated methods fail or confidence is low
**How:** Web app `expense_queue` interface allows manual state selection

---

## Expense Matching Responsibilities

### Component: n8n Zoho Expense Workflow

Expense matching is **EXCLUSIVELY** the responsibility of n8n workflows. The web app only displays match results.

### DO: What n8n MUST Do for Matching

1. **Query bank_transactions** for candidates:
   ```sql
   SELECT * FROM bank_transactions
   WHERE status = 'unmatched'
   AND transaction_date BETWEEN expense_date - 3 AND expense_date + 3
   AND ABS(amount - expense_amount) < 1.00
   ```

2. **Use vendor_rules** for pattern matching:
   ```sql
   SELECT * FROM vendor_rules
   WHERE vendor_pattern ILIKE '%<merchant_name>%'
   ORDER BY length(vendor_pattern) DESC
   LIMIT 1
   ```

3. **Calculate matching_confidence** (0-100 scale):
   - Exact amount match: +40 points
   - Same day: +30 points
   - Vendor name similarity: +20 points
   - Receipt validates amount: +10 points
   - **Start at 100, subtract for issues**

4. **Set matched_expense_id** in bank_transactions when confident match found

5. **Update status**:
   - `'matched'` if confidence >= 95%
   - `'pending_review'` if confidence < 95% (goes to expense_queue)

6. **Handle reimbursements**:
   - No bank match found after checking all candidates → personal card
   - Set `is_reimbursement = true` in expense_queue
   - Flag for reimbursement processing

### DO NOT: What Web App MUST NOT Do for Matching

1. **DO NOT run matching algorithms** - That's n8n's job
2. **DO NOT set matched_expense_id** - Only n8n (service role) writes this field
3. **DO NOT calculate confidence** - Confidence is an n8n AI agent output
4. **DO NOT auto-approve matches** - Only display what n8n has determined

### Web App Role in Matching

**DISPLAY ONLY:**
- Show suggested matches in review queue
- Allow human to approve/reject/correct n8n's suggestions
- Provide UI for manual matching when auto-match fails
- Update corrections JSONB field in expense_queue when human intervenes

---

## QBO Export Format

### Critical Understanding: QBO CSV Import Format

QuickBooks Online accepts **CSV imports** for creating Purchase records. The format is:

| Column | Purpose | Notes |
|--------|---------|-------|
| **DATE** | Transaction date | Format: MM/DD/YYYY |
| **DESCRIPTION** | Merchant/vendor name | Free text, informational |
| **From/To** | Vendor hint | Optional, helps QBO suggest vendor |
| **SPENT** | Expense amount | Positive number for expenses |
| **RECEIVED** | Credit/refund amount | Positive number for credits (opposite sign from import) |
| **ASSIGN TO** | QBO category hint | Informational, for human reference |

### Critical: SPENT vs RECEIVED

**In bank_transactions table:**
- Expenses: `amount` is **positive** (e.g., 52.96)
- Credits/Refunds: `amount` is **negative** (e.g., -25.00)

**In QBO CSV export:**
- Expenses: Goes in **SPENT** column as positive (52.96)
- Credits/Refunds: Goes in **RECEIVED** column as **positive** (25.00)

**Conversion logic:**
```typescript
if (amount >= 0) {
  spent = amount
  received = null
} else {
  spent = null
  received = Math.abs(amount)  // Convert negative to positive
}
```

### ASSIGN TO Column

**Purpose:** Human hint only - NOT for automation

The "ASSIGN TO" column in QBO export is **advisory only**. It suggests a QuickBooks category for the human bookkeeper to review. QBO does NOT auto-assign based on this field.

**Example:**
```csv
DATE,DESCRIPTION,From/To,SPENT,RECEIVED,ASSIGN TO
12/01/2024,CHEVRON FUEL,Chevron,52.96,,Fuel - COS
12/02/2024,REFUND TRACK RENTAL,Buttonwillow,,250.00,Track Rental - COS
```

The ASSIGN TO hint helps the CPA quickly categorize, but they still click to confirm.

---

## n8n Workflow Responsibilities (Three-Agent Architecture)

### Agent 1: Zoho Expense Processor (Webhook-Triggered)

**Trigger:** Zoho expense report approved webhook

**Context Data (NO vendor_rules):**
- qbo_accounts (all)
- bank_transactions (unmatched, filtered by date/amount)
- Zoho expense data + receipt

**Responsibilities:**

1. **Parse report context** (Code Node):
   - Extract report name (contains course/venue/date info)
   - Determine COS vs Non-COS from category names
   - Extract venue code (LS, WS, TMS, etc.)

2. **Fetch reference data** (Supabase - NO vendor_rules):
   - qbo_accounts (all)
   - bank_transactions (unmatched, filtered)
   - **DOES NOT fetch vendor_rules** (Zoho has category/state/vendor)

3. **Find bank transaction match** (Supabase query):
   ```sql
   SELECT * FROM bank_transactions
   WHERE status = 'unmatched'
   AND transaction_date BETWEEN :expense_date - 3 AND :expense_date + 3
   AND ABS(amount - :expense_amount) < 1.00
   ORDER BY ABS(amount - :expense_amount) ASC
   LIMIT 5
   ```

4. **AI Agent 1 decides** (Claude via Anthropic node):
   - **IF** bank match found AND confidence >= 95%:
     - POST to QBO (create Purchase)
     - UPDATE bank_transactions (set status='matched', matched_expense_id, qbo_purchase_id)
     - **Monday.com DEFERRED** (do NOT create subitem yet)
   - **ELSE IF** bank match found AND confidence < 95%:
     - INSERT expense_queue (flagged for review)
   - **ELSE** (no bank match):
     - INSERT expense_queue (is_reimbursement=true, requires receipt upload)

**Special Handling:**
- "Other" state tag in Zoho → Interpret as **NC** (North Carolina, admin/home office)
- ZELLE/VENMO payments → ARE Zoho expenses (Wells Fargo Debit), require receipts
- Credits/refunds → Match to original transaction, post to SAME QBO account

### Agent 2: Orphan & Recurring Processor (Scheduled)

**Trigger:** Daily cron OR manual trigger

**Context Data (vendor_rules REQUIRED):**
- vendor_rules (all)
- qbo_accounts (all)
- bank_transactions (orphans only)

**Responsibilities:**

1. **Find orphan transactions** (Supabase query - 45-day grace period):
   ```sql
   SELECT * FROM bank_transactions
   WHERE status = 'unmatched'
   AND transaction_date < CURRENT_DATE - 45  -- Changed from 5 to 45 days
   ORDER BY transaction_date DESC
   ```

2. **Determine state via waterfall** (Code Node):
   - **Step 1:** Check vendor_rules.default_state
   - **Step 2:** Parse description for city/state pattern (e.g., "CHEVRON SANTA ROSA CA")
   - **Step 3:** Query Monday.com API: Check if date falls within a course event date range → use event state
   - **Step 4:** Cannot determine → INSERT expense_queue for manual review

3. **Determine category** (Code Node):
   - Check vendor_rules.default_category
   - If unknown vendor → INSERT expense_queue

4. **Process orphan** (if state + category determined):
   - POST to QBO
   - UPDATE bank_transactions (status='orphan_processed', orphan_category, orphan_state, qbo_purchase_id)
   - **Monday.com DEFERRED** (do NOT create subitem yet)

### Agent 3: Income Reconciler (DEFERRED)

**Status:** DEFERRED until expense flows (Agents 1 & 2) are stable.

**Future Responsibilities:**
- Match STRIPE deposits to WooCommerce orders
- Record income by state
- Handle refunds to original orders

---

## What Goes Where: Quick Reference

| Data Field | Set By | When | Storage Location |
|------------|--------|------|------------------|
| **transaction_date** | Web App | CSV import | bank_transactions.transaction_date |
| **description** | Web App | CSV import | bank_transactions.description |
| **amount** | Web App | CSV import | bank_transactions.amount |
| **source** | Web App | CSV import | bank_transactions.source |
| **description_normalized** | Web App | CSV import | bank_transactions.description_normalized |
| **extracted_vendor** | Web App | CSV import | bank_transactions.extracted_vendor |
| **status** | Web App → n8n | Import → Match | bank_transactions.status |
| **matched_expense_id** | **n8n ONLY** | After match | bank_transactions.matched_expense_id |
| **matched_by** | **n8n ONLY** | After match | bank_transactions.matched_by |
| **match_confidence** | **n8n ONLY** | After match | bank_transactions.match_confidence |
| **qbo_purchase_id** | **n8n ONLY** | After QBO post | bank_transactions.qbo_purchase_id |
| **state (final)** | **n8n ONLY** | Via waterfall | categorization_history.final_state |
| **category (final)** | **n8n ONLY** | Via rules/Zoho | categorization_history.final_category |

### Critical Fields That Web App NEVER Touches

These fields are **n8n-exclusive** and MUST NEVER be set by web app import:

- `matched_expense_id`
- `matched_at`
- `matched_by`
- `match_confidence`
- `orphan_category`
- `orphan_state`
- `orphan_determination_method`
- `orphan_processed_at`
- `qbo_purchase_id`
- `monday_subitem_id`

**Web app role:** Display these values in read-only mode for human review.

---

## Common Mistakes to Avoid

### Mistake 1: "Let's Extract State from Description During Import"

**Why it's wrong:**
- Bank descriptions are unreliable (truncated, abbreviated, inconsistent)
- A charge in "TX" might be an online purchase from a Texas company, not a course expense
- Guessing state creates tax liability if wrong

**Correct approach:**
- Import stores raw description
- n8n orphan flow attempts state extraction ONLY for orphans, with low confidence
- Ambiguous cases go to human review

### Mistake 2: "Let's Auto-Match in the Web App"

**Why it's wrong:**
- Web app lacks context (no receipt, no Zoho tags, no Monday events)
- Matching requires AI analysis of multiple data sources
- Web app should remain a simple CRUD interface

**Correct approach:**
- n8n performs matching with full context
- Web app displays match suggestions
- Human approves/corrects in web UI

### Mistake 3: "Let's Skip Credit/Refund Transactions"

**Why it's wrong:**
- Credits/refunds are real financial events that affect tax reporting
- Skipping them creates accounting discrepancies
- They may need different n8n processing (refund categorization)

**Correct approach:**
- Import ALL transactions (SPENT + RECEIVED)
- Store credits as negative amounts
- Let n8n handle appropriate categorization

### Mistake 4: "Let's Set extracted_state During Import"

**Why it's wrong:**
- Even if you successfully parse "CA" from "CHEVRON SANTA ROSA CA", you don't know if:
  - This was a course expense in CA, OR
  - This was an employee filling up in CA while traveling from WA course
- State assignment requires business context (course dates, venues, tags)

**Correct approach:**
- Leave extracted_state NULL during import
- Let n8n determine state using Zoho tags, Monday events, or vendor rules
- Flag for human review if uncertain

### Mistake 5: "Let's Add Category Hints to Import"

**Why it's wrong:**
- Categories come from Zoho expense submission (employee's choice)
- Or from vendor_rules (learned patterns)
- Or from manual review
- Import has ZERO context for categorization

**Correct approach:**
- Import stores only what's in the CSV: date, description, amount
- n8n assigns category based on Zoho category or vendor_rules
- Web app displays category in review queue

---

## Enforcement Checklist

Use this checklist when reviewing code changes to web app import:

### Web App Import Code Review

- [ ] Does the import modify ONLY these fields?
  - transaction_date
  - description
  - amount
  - source
  - description_normalized
  - extracted_vendor
  - status (only to 'unmatched')
  - import_batch_id
  - created_at

- [ ] Does the import AVOID touching these fields?
  - extracted_state
  - matched_expense_id
  - matched_at
  - matched_by
  - match_confidence
  - orphan_category
  - orphan_state
  - orphan_determination_method
  - qbo_purchase_id
  - monday_subitem_id

- [ ] Does the import handle BOTH expenses AND credits?
  - Expenses: amount > 0
  - Credits: amount < 0

- [ ] Does the import use the unique constraint for deduplication?
  - (source, transaction_date, amount, description_normalized)

- [ ] Does the import avoid making business logic decisions?
  - No state determination
  - No categorization
  - No matching to Zoho expenses
  - No QBO posting

### n8n Workflow Code Review

- [ ] Does the workflow fetch reference data BEFORE invoking AI agent?
- [ ] Does the workflow limit AI agent tool calls to 3-4 maximum?
- [ ] Does the workflow handle three scenarios?
  - Matched with high confidence → auto-process
  - Matched with low confidence → queue for review
  - No match → flag as reimbursement
- [ ] Does the workflow update bank_transactions after successful match?
- [ ] Does the orphan flow use state waterfall logic?

---

## Architecture Diagram: Component Boundaries

```
┌─────────────────────────────────────────────────────────────────┐
│                         WEB APP LAYER                           │
│  Responsibility: CRUD operations, display, human review UI      │
│                                                                 │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐│
│  │ BankFeedPanel   │  │ ReviewQueue     │  │ OrphanQueue     ││
│  │                 │  │                 │  │                 ││
│  │ • Parse CSV     │  │ • Display       │  │ • Display       ││
│  │ • Store raw     │  │   matches       │  │   orphans       ││
│  │ • Dedupe on     │  │ • Human         │  │ • Human state   ││
│  │   import        │  │   approve/      │  │   assignment    ││
│  │                 │  │   correct       │  │                 ││
│  │ NO MATCHING     │  │                 │  │ NO AUTO-MATCH   ││
│  │ NO STATE        │  │ NO AUTO-APPROVE │  │ NO GUESSING     ││
│  │ NO CATEGORY     │  │                 │  │                 ││
│  └─────────────────┘  └─────────────────┘  └─────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         DATA LAYER                              │
│  Responsibility: Store facts, enforce constraints               │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ bank_transactions (SOURCE OF TRUTH)                      │  │
│  │ • Stores: date, description, amount, source              │  │
│  │ • Updated by: Web App (create) + n8n (match/process)     │  │
│  │ • Unique constraint prevents duplicates                  │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ expense_queue (HUMAN REVIEW)                             │  │
│  │ • Flagged matches needing review                         │  │
│  │ • Reimbursements (no bank match)                         │  │
│  │ • Corrections JSONB for learning                         │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       PROCESSING LAYER (n8n)                    │
│  Responsibility: Matching, state determination, categorization  │
│                                                                 │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐ │
│  │ Zoho Expense     │  │ Orphan Flow      │  │ QBO Poster   │ │
│  │ Workflow         │  │                  │  │              │ │
│  │                  │  │ • Find unmatched │  │ • Create     │ │
│  │ • Match to bank  │  │   > 5 days old   │  │   Purchase   │ │
│  │ • Determine      │  │ • State via      │  │ • Update     │ │
│  │   state via      │  │   waterfall      │  │   bank_txn   │ │
│  │   Zoho tags OR   │  │ • Vendor rules   │  │   with ID    │ │
│  │   Monday event   │  │ • Flag if unsure │  │              │ │
│  │ • AI confidence  │  │                  │  │              │ │
│  │ • Queue if < 95% │  │                  │  │              │ │
│  └──────────────────┘  └──────────────────┘  └──────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      EXTERNAL SYSTEMS                           │
│                                                                 │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐               │
│  │ Zoho       │  │ QBO        │  │ Monday.com │               │
│  │ Expense    │  │            │  │            │               │
│  │            │  │ • Purchase │  │ • Subitem  │               │
│  │ • Webhook  │  │   records  │  │   expense  │               │
│  │ • Tags     │  │ • Bank feed│  │   tracking │               │
│  │ • Receipts │  │   matching │  │            │               │
│  └────────────┘  └────────────┘  └────────────┘               │
└─────────────────────────────────────────────────────────────────┘
```

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | December 7, 2025 | Initial creation - defined system boundaries |

---

## References

- **expense-automation-architecture.md** - Overall system design
- **database-schema.md** - Table structures and relationships
- **web-app-spec.md** - Web application component specifications
- **n8n-workflow-spec.md** - n8n workflow detailed specifications

---

**Remember:** When in doubt, ask "Does this component have the context needed to make this decision?" If the answer is no, don't make the decision. Queue for review or pass to the component that DOES have context.

**The cardinal rule:** The web app stores facts. n8n interprets facts. Humans decide when n8n is uncertain.

---

*End of System Boundaries Document*
