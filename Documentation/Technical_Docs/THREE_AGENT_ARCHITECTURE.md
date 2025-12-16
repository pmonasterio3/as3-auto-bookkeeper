# AS3 Auto Bookkeeper - Three-Agent Architecture

**Version:** 1.1
**Date:** December 10, 2025 (Updated)
**Purpose:** Define the finalized three-agent architecture and key decisions

---

## Executive Summary

The AS3 Auto Bookkeeper uses **three specialized AI agents**, each with optimized context windows and specific responsibilities:

| Agent | Responsibility | Trigger | Uses vendor_rules? | Status |
|-------|----------------|---------|-------------------|--------|
| **Agent 1: Zoho Expense Processor** | Match Zoho expenses to bank transactions, post to QBO | Webhook (Zoho approval) | **NO** - Zoho has everything | ✅ **COMPLETE** |
| **Agent 2: Orphan & Recurring Processor** | Handle unmatched bank transactions after 45 days | Scheduled batch (daily) | **YES** - No Zoho context | 📋 To be built |
| **Agent 3: Income Reconciler** | Match STRIPE deposits to WooCommerce orders | Scheduled batch (daily) | **N/A** - Income flow | ⏸️ DEFERRED |

**Current Status:** Agent 1 is COMPLETE and operational (41 nodes, full QBO integration). Agent 2 ready to build. Agent 3 deferred until expense flows are solid.

---

## Key Architectural Decisions

### 1. Context Window Optimization

**Problem:** Agent 1 was including vendor_rules in context (~3000 tokens) unnecessarily.

**Solution:** Agent 1 does NOT receive vendor_rules because:
- Zoho expenses already have category (employee selected it)
- Zoho expenses already have state (from "Course Location" tag or venue)
- Zoho expenses already have vendor (merchant_name)
- vendor_rules are ONLY for orphans (no Zoho context)

**Impact:** Saves ~3000 tokens per expense, reduces iterations, improves reliability.

### 2. Grace Period: 45 Days

**Decision:** Bank transactions remain "unmatched" for 45 days before Agent 2 processes them.

**Rationale:**
- Gives employees time to submit late expense reports
- Avoids premature categorization
- Reduces human review queue

**Implementation:**
```sql
-- Agent 2 query
SELECT * FROM bank_transactions
WHERE status = 'unmatched'
  AND transaction_date < CURRENT_DATE - INTERVAL '45 days'
```

### 3. ZELLE/VENMO Are Zoho Expenses

**Clarification:** ZELLE and VENMO payments go through Wells Fargo Debit and ARE submitted as Zoho expenses.

**Implications:**
- These transactions MUST have receipts uploaded to Zoho
- Agent 1 handles them (not orphans)
- Require receipt validation like any Zoho expense

### 4. "Other" State Tag = NC

**Decision:** When Zoho "Course Location" tag shows "Other", interpret as **NC (North Carolina)**.

**Rationale:**
- "Other" is used for admin/home office expenses
- AS3's administrative office is in North Carolina
- Provides consistent state for tax reporting

### 5. Credits/Refunds Match to Original

**Rule:** Credits/refunds must be matched to the original expense and posted to the SAME QBO account.

**Implementation:**
- Track original expense's QBO account
- Post refund to same account (negative amount)
- Maintains accurate account balances

### 6. Employee Reimbursements

**Clarification:** Employee reimbursements (for personal card purchases) are **paid directly through QuickBooks**, not tracked in this system.

**This system handles:**
- Corporate card expenses (AMEX, Wells Fargo corporate accounts)
- Identifying which expenses are reimbursable (no bank match = personal card)

**This system does NOT handle:**
- Actually issuing reimbursement payments (done in QBO by accounting)

### 7. Monday.com Integration DEFERRED

**Decision:** Monday.com course expense tracking is DEFERRED until QBO expense flows are solid.

**Current Status:**
- Do NOT create Monday.com subitems yet
- Do NOT query Monday.com API in Agent 1
- Focus 100% on accurate QBO posting first

**Future:** Re-enable Monday.com after 2-3 weeks of successful QBO automation.

---

## Agent 1: Zoho Expense Processor

### Responsibilities

1. **Match Zoho expense to bank transaction**
   - Search bank_transactions WHERE status='unmatched'
   - Filter by date (expense_date ±3 days)
   - Filter by amount (within $0.50)
   - Use vendor name similarity

2. **Determine state**
   - **For Non-COS expenses:** Use "Course Location" tag from Zoho
   - **For COS expenses:** Use venue from report context (parsed from report name)
   - **"Other" tag:** Interpret as NC (admin/home office)

3. **Validate category**
   - Use category_name from Zoho expense
   - Verify COS vs Non-COS alignment with report type
   - Map to QBO account via qbo_accounts.zoho_category_match

4. **Calculate confidence**
   - Start at 100
   - Subtract for issues:
     - No bank match: -40
     - Receipt amount mismatch >$1: -30
     - No receipt: -25
     - State unclear: -20
     - Category/report type mismatch: -15

5. **Decision tree**
   - **IF** confidence ≥95% AND bank match found:
     - POST to QBO
     - UPDATE bank_transactions (status='matched', matched_expense_id, qbo_purchase_id)
   - **ELSE IF** confidence <95% AND bank match found:
     - INSERT expense_queue (flagged for review)
   - **ELSE** (no bank match):
     - INSERT expense_queue (is_reimbursement=true, requires receipt upload)

### Context Data (NO vendor_rules)

Agent 1 receives:
- qbo_accounts (all)
- bank_transactions (unmatched, date/amount filtered)
- Zoho expense data (from webhook payload)
- Receipt image (binary)
- Report context (report_name, venue, COS/Non-COS flag)

Agent 1 does NOT receive:
- vendor_rules (not needed - Zoho has category/state/vendor)

### Tool Calls (Max 4)

1. `log_categorization` - Insert to categorization_history (REQUIRED)
2. `match_bank_transaction` - Update bank_transactions status='matched'
3. `post_to_qbo` - Create Purchase in QuickBooks (if confident)
4. `queue_for_review` - Insert to expense_queue (if uncertain or reimbursement)

---

## Agent 2: Orphan & Recurring Processor

### Responsibilities

1. **Find orphan transactions**
   ```sql
   SELECT * FROM bank_transactions
   WHERE status = 'unmatched'
     AND transaction_date < CURRENT_DATE - INTERVAL '45 days'
   ```

2. **Determine state (waterfall)**
   - **Step 1:** Check vendor_rules.default_state
   - **Step 2:** Parse description for state code (e.g., "CHEVRON SANTA ROSA CA")
   - **Step 3:** Check date proximity to courses (query Monday.com API if needed)
   - **Step 4:** Cannot determine → queue for human review

3. **Determine category**
   - Check vendor_rules.default_category
   - Unknown vendor → queue for human review

4. **Process orphan**
   - **IF** state AND category determined:
     - POST to QBO
     - UPDATE bank_transactions (status='orphan_processed', orphan_category, orphan_state, qbo_purchase_id)
   - **ELSE**:
     - INSERT expense_queue (for manual categorization)

### Context Data (vendor_rules REQUIRED)

Agent 2 receives:
- vendor_rules (all)
- qbo_accounts (all)
- bank_transactions (orphans only)
- Monday.com events (if needed for date proximity check)

### Tool Calls (Max 4)

1. `log_categorization` - Insert to categorization_history (REQUIRED)
2. `update_bank_transaction_orphan` - Set orphan_category, orphan_state, status='orphan_processed'
3. `post_to_qbo` - Create Purchase in QuickBooks (if state/category determined)
4. `queue_for_review` - Insert to expense_queue (if uncertain)

---

## Agent 3: Income Reconciler (DEFERRED)

### Status

**DEFERRED until expense workflows are stable (2-3 weeks).**

### Future Responsibilities

1. **Match STRIPE deposits to WooCommerce orders**
   - Query STRIPE API for deposits
   - Match to WooCommerce orders by amount + date
   - Extract customer state for revenue attribution

2. **Record income by state**
   - POST to QBO as income (not expense)
   - Use QBO income accounts (Client Courses, Open Enrollment/Stripe)
   - Track revenue by state for tax reporting

3. **Handle refunds**
   - Match refunds to original orders
   - Post to same income account (negative)

---

## Human Review Queue Requirements

### Receipt Upload Capability

**Requirement:** Human review interface must support receipt upload for reimbursable expenses.

**Use Case:** Zoho expense has no bank match (employee used personal card) → Flagged as `is_reimbursement=true` → Human reviews → Uploads receipt → Approves → Posts to QBO.

**Implementation:**
- expense_queue.receipt_url (store uploaded receipt)
- Web app: File upload component in review queue
- After upload: Sync receipt to QBO Purchase attachment

### Three Review Queues

| Queue | Purpose | Filter |
|-------|---------|--------|
| **Review Queue** | Zoho expenses with low confidence bank matches | `expense_queue WHERE is_reimbursement=false AND status='pending'` |
| **Reimbursement Queue** | Zoho expenses with no bank match (personal card) | `expense_queue WHERE is_reimbursement=true AND status='pending'` |
| **Orphan Queue** | Bank transactions needing categorization | `bank_transactions WHERE status='unmatched' AND transaction_date < NOW()-45 days` |

---

## QBO Accounts to Add

**Missing Income Accounts:**

These accounts need to be added to `qbo_accounts` table for Agent 3 (when implemented):

| QBO Account Name | QBO ID | Account Type | Purpose |
|------------------|--------|--------------|---------|
| Client Courses | TBD | Income | Corporate training revenue |
| Open Enrollment/Stripe | TBD | Income | Public course revenue via Stripe |
| PayPal Sales | TBD | Income | Revenue via PayPal |

**Action Required:** Query QBO API to get these account IDs and insert into qbo_accounts.

---

## Migration Checklist

When implementing three-agent architecture:

### Agent 1 Changes
- [x] Remove vendor_rules from reference data fetch ✅ COMPLETE
- [x] Update system prompt to exclude vendor_rules context ✅ COMPLETE
- [x] Add "Other" → NC state mapping logic ✅ COMPLETE
- [x] Add ZELLE/VENMO handling notes ✅ COMPLETE
- [x] Monday.com subitem creation (deferred) ✅ DEFERRED
- [x] Test with real Zoho webhook payload ✅ COMPLETE
- [x] Implement QBO vendor lookup/create ✅ COMPLETE
- [x] Implement QBO Purchase posting with ClassRef ✅ COMPLETE
- [x] Implement receipt upload to QBO ✅ COMPLETE
- [x] Multi-expense report handling ✅ COMPLETE

### Agent 2 Implementation
- [ ] Create new n8n workflow for orphan processing
- [ ] Implement 45-day filter in Supabase query
- [ ] Add state waterfall logic (vendor_rules → parse → proximity → manual)
- [ ] Add category determination from vendor_rules
- [ ] Test with sample orphan transactions

### Agent 3 (Future)
- [ ] DEFER until Agents 1 & 2 are stable
- [ ] Add QBO income accounts to database
- [ ] Design STRIPE API integration
- [ ] Design WooCommerce API integration

### Database Changes
- [ ] Verify monday_events table does NOT exist (correct)
- [ ] Add receipt_url column to expense_queue (if missing)
- [ ] Update bank_transactions unique constraint includes 45-day logic

### Documentation Updates
- [x] Update expense-automation-architecture.md ✅ COMPLETE
- [x] Update n8n-workflow-spec.md ✅ COMPLETE
- [x] Update SYSTEM_BOUNDARIES.md ✅ COMPLETE
- [x] Update database-schema.md (remove monday_events references) ✅ COMPLETE
- [x] Update web-app-spec.md (add receipt upload) ✅ COMPLETE
- [x] Update CLAUDE.md ✅ COMPLETE
- [x] Update GOALS.md (verify alignment) ✅ COMPLETE

---

## Testing Strategy

### Agent 1 Test Cases

| Test Case | Input | Expected Outcome |
|-----------|-------|------------------|
| Normal expense with bank match | Zoho expense, matching bank txn | Posted to QBO, bank txn matched |
| Expense with "Other" state tag | Zoho expense, state="Other" | State interpreted as NC |
| ZELLE payment with receipt | Zoho expense, paid_through="Wells Fargo Debit" | Processed normally, receipt validated |
| No bank match (reimbursement) | Zoho expense, no matching bank txn | Flagged as reimbursement, queued |
| Low confidence match | Zoho expense, receipt amount mismatch | Queued for review with suggested match |

### Agent 2 Test Cases

| Test Case | Input | Expected Outcome |
|-----------|-------|------------------|
| Orphan with vendor rule match | Bank txn, vendor in rules | Category/state from rule, posted to QBO |
| Orphan with state in description | Bank txn, "CHEVRON DALLAS TX" | State parsed as TX |
| Orphan during course dates | Bank txn, date within course event | State from course venue |
| Unknown vendor, no state | Bank txn, no context | Queued for human review |

---

## Success Criteria

1. **Token usage reduced:** Agent 1 uses ~3000 fewer tokens per expense
2. **Iteration count:** All agents stay under 6 iterations (well below 10 limit)
3. **45-day grace works:** No premature orphan processing
4. **State accuracy:** "Other" correctly maps to NC, 100% of time
5. **Reimbursements flagged:** All personal card expenses queued with `is_reimbursement=true`
6. **No Monday.com calls yet:** Agent 1 does NOT create subitems (deferred)

---

## Revision History

| Version | Date | Changes |
|---------|------|---------|
| 1.1 | December 10, 2025 | Updated Agent 1 status to COMPLETE, marked all checklist items complete |
| 1.0 | December 8, 2025 | Initial creation after architecture discussion |

---

*End of Three-Agent Architecture Document*
