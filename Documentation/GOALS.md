# AS3 Expense Automation System - Goals

**Version:** 1.0
**Last Updated:** December 6, 2025
**Status:** Authoritative Source of Truth

---

## Overview

This document defines the core goals of the AS3 Expense Automation System. All design decisions, feature implementations, and workflow designs must align with these goals.

---

## Primary Goals

### 1. Accurate State Attribution

**Priority:** Critical (Tax Compliance)

Every expense must be attributed to the correct US state where it occurred. AS3 operates in 7 states:

| State | Code | Primary Venues |
|-------|------|----------------|
| California | CA | Laguna Seca, Sonoma, Thermal |
| Texas | TX | COTA, MSR Houston |
| Colorado | CO | High Plains Raceway |
| Washington | WA | The Ridge, Pacific Raceways |
| New Jersey | NJ | NJMP |
| Florida | FL | Sebring, Homestead |
| Montana | MT | Various |
| Administrative | Admin | Non-course expenses |

**Why:** State tax compliance. Incorrect attribution leads to tax overpayment or audit risk.

**Measurement:** ≥95% accuracy on state attribution without human intervention.

---

### 2. No Duplicate Expenses

**Priority:** Critical (Financial Accuracy)

The system must prevent the same expense from being processed twice.

**Duplicate Sources:**
- Same Zoho expense processed multiple times
- Same bank transaction matched to multiple expenses
- Re-imported bank statements with overlapping dates

**Prevention Strategy:**
1. Unique constraint on `zoho_expense_id` in expense_queue
2. Composite key on bank_transactions: `(source, transaction_date, amount, description_hash)`
3. Pre-import duplicate detection with user preview
4. Bank transaction status tracking (unmatched → matched)

**Measurement:** Zero duplicate postings to QuickBooks Online.

---

### 3. Automated Categorization (80%+ Auto-Match)

**Priority:** High (Efficiency)

At least 80% of expenses should be categorized and matched without human intervention.

**Categorization Components:**
- **QBO Category:** Which expense account (Fuel, Track Rental, Meals, etc.)
- **State:** Where the expense occurred
- **Bank Match:** Which bank transaction corresponds to this expense
- **Course Attribution:** Which Monday.com event (for COS expenses)

**Auto-Match Criteria:**
- Confidence score ≥ 95%
- Bank transaction match found (or explicitly marked as reimbursement)
- State determinable from description or vendor rules
- No split transaction detected

**Measurement:** Track auto-processed vs. flagged ratio weekly.

---

### 4. Course-Level P&L (Profitability Tracking)

**Priority:** High (Business Intelligence)

Every course-related expense must link to a specific course/event in Monday.com for profitability analysis.

**Data Flow:**
```
[Bank Transaction] → [Expense] → [QBO Bill/Expense] → [Monday.com Subitem]
                                        ↓
                              [Course-Level P&L Report]
```

**Monday.com Integration:**
- Events stored in `monday_events` table (synced daily)
- Each COS expense creates a subitem under the corresponding course
- Revenue from course + all attributed expenses = Course P&L

**COS Categories (Cost of Sales):**
- Fuel - COS
- Track Rental - COS
- Vehicle (Rent/Wash) - COS
- Course Catering/Meals - COS
- Travel - Courses COS
- Supplies & Materials - COS
- Cost of Labor - COS

**Measurement:** 100% of COS expenses linked to a Monday.com course item.

---

### 5. Minimal CPA Work

**Priority:** High (Cost Reduction)

Reduce manual bookkeeping effort to near-zero for routine expenses.

**Current State:**
- CPA manually matches bank statements to Zoho reports
- Manual state attribution based on report names
- Manual QBO data entry

**Target State:**
- Automatic matching and posting for 80%+ of expenses
- Human review only for flagged items
- CPA reviews weekly summary, not individual expenses

**Measurement:** CPA time on expense processing reduced by 80%.

---

### 6. Human Oversight for Edge Cases

**Priority:** High (Accuracy + Learning)

Complex or uncertain expenses must be flagged for human review, not guessed.

**Flag Triggers:**
- No bank transaction match (potential reimbursement)
- Confidence score < 95%
- Split transaction detected (multiple courses in one expense)
- Receipt amount ≠ claimed amount
- State cannot be determined
- First-time vendor with no existing rules

**Review Dashboard Features:**
- Clear display of expense details and receipt
- AI suggestions with confidence scores
- Bank transaction match candidates
- Easy approve/correct/reject actions
- Correction feedback feeds learning system

**Measurement:** All flagged items reviewed within 48 hours.

---

### 7. Self-Improving System

**Priority:** Medium (Long-term Efficiency)

The system should learn from corrections to improve future accuracy.

**Learning Mechanisms:**

1. **Vendor Rules Update:**
   - When user corrects category/state for a vendor → update vendor_rules
   - Next time same vendor appears → use learned rule

2. **Categorization History:**
   - Log every categorization decision in `categorization_history`
   - AI references recent corrections for similar expenses

3. **Confidence Calibration:**
   - Track predicted confidence vs. actual accuracy
   - Adjust thresholds based on real performance

**Feedback Loop:**
```
[Correction Made] → [Update vendor_rules] → [Log to categorization_history]
        ↓
[Next Similar Expense] → [AI checks history] → [Higher confidence]
```

**Measurement:** Auto-match rate increases month-over-month until plateau at 90%+.

---

## Non-Goals (Out of Scope)

To maintain focus, these are explicitly NOT goals:

| Non-Goal | Reason |
|----------|--------|
| Multi-tenant SaaS | Single-company focus first |
| Mobile app | Web dashboard sufficient |
| Real-time bank sync | Weekly CSV import is adequate |
| Expense submission | Zoho Expense handles this |
| Invoice generation | Separate system |
| Payroll processing | Handled by Gusto |

---

## Success Metrics Summary

| Goal | Metric | Target |
|------|--------|--------|
| State Attribution | Accuracy without correction | ≥95% |
| No Duplicates | Duplicate QBO postings | 0 |
| Auto-Categorization | Expenses auto-processed | ≥80% |
| Course P&L | COS expenses linked to Monday | 100% |
| CPA Efficiency | Time reduction | ≥80% |
| Human Oversight | Flagged items reviewed in 48h | 100% |
| Self-Improving | Auto-match rate trend | Increasing |

---

## Goal Hierarchy

When goals conflict, use this priority order:

1. **No Duplicates** - Financial accuracy is paramount
2. **Accurate State Attribution** - Tax compliance is non-negotiable
3. **Human Oversight** - When uncertain, flag don't guess
4. **Automated Categorization** - Efficiency, but not at cost of accuracy
5. **Course-Level P&L** - Business intelligence
6. **Self-Improving** - Long-term optimization
7. **Minimal CPA Work** - Natural outcome of above goals

---

## Alignment Checklist

Before implementing any feature, verify:

- [ ] Does this help achieve one or more goals?
- [ ] Does this conflict with any goal?
- [ ] If conflict exists, does it follow the priority hierarchy?
- [ ] How will we measure success for this feature?

---

*End of Goals Document*
