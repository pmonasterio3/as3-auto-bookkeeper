# Agent 1 - Complete Update Guide

**Last Updated:** December 29, 2025
**Version:** 3.0 (Bulletproof Edition)

This is the master reference for updating Agent 1 - Queue Based v3.0 workflow in n8n.

---

## Quick Reference

| Node | Document | What It Fixes |
|------|----------|---------------|
| Match Bank Transaction | `AGENT1_MATCH_BANK_TRANSACTION_CODE.md` | ±3 day tolerance, word-based merchant matching |
| AI Agent | `AGENT1_AI_PROMPT.md` | Trust bank_match_type, extract RECEIPT_DATE |
| Parse AI Decision | `AGENT1_PARSE_AI_DECISION_CODE.md` | Multi-layer approval detection, deterministic fallback |
| Update Status Nodes | `AGENT1_UPDATE_STATUS_NODES.md` | Save corrected dates/amounts |

---

## Why These Fixes Were Needed

### Problem 1: False Low-Confidence Matches
**Example:** "Bacon Bacon" expense matched to bank transaction with 100% accuracy, but system gave it 80% confidence.

**Cause:** AI was second-guessing the pre-calculated bank match type.

**Fix:** AI now trusts `bank_match_type` and assigns confidence deterministically:
- `exact` = 100%
- `amount_date_match` = 95%
- `amount_merchant_match` = 90%

### Problem 2: Expenses Flagged Despite Perfect Matches
**Example:** AI response starts with "✅ Perfect match..." but system flagged it because first word wasn't literally "APPROVED".

**Cause:** Parse AI Decision only checked if first word was "APPROVED".

**Fix:** Bulletproof multi-layer detection:
1. Check for APPROVED/FLAGGED keywords anywhere in response
2. Detect positive signals ("PERFECT MATCH", "100%")
3. Detect negative signals ("MISMATCH", "DISCREPANCY")
4. Deterministic fallback based on bank_match_type
5. Safety override for exact matches

### Problem 3: Date Inversions Breaking Matches
**Example:** Receipt shows "11-10-2025" (Nov 10), Zoho sends "2025-10-11" (Oct 11). 30 days apart = no match.

**Cause:** DD/MM vs MM/DD format confusion.

**Fix:** AI extracts actual date from receipt, system auto-corrects when difference >1 day.

### Problem 4: Weak Merchant Matching
**Example:** "Vineyard Creek Chevron" didn't match "CHEVRON XXX5133" because old code only checked first 5 characters ("viney" ≠ "chevr").

**Fix:** Word-based matching - ANY significant word (4+ chars) from merchant name matches bank description.

---

## Step-by-Step Update Instructions

### Step 1: Update Match Bank Transaction Node

1. Open n8n → **Agent 1 - Queue Based v3.0**
2. Click **Match Bank Transaction** node
3. Delete all existing code
4. Copy code from **`AGENT1_MATCH_BANK_TRANSACTION_CODE.md`**
5. Paste into node
6. Click **Save**

**What this enables:**
- ±3 day date tolerance (handles bank processing delays)
- Word-based merchant matching (finds "CHEVRON" in "Vineyard Creek Chevron")
- Match type classification (exact, amount_date_match, amount_merchant_match, etc.)

---

### Step 2: Update AI Agent Node

1. Click **AI Agent** node
2. Find the **System Message** field (large text box)
3. Delete all existing content
4. Copy the system prompt from **`AGENT1_AI_PROMPT.md`** (lines 14-111)
5. Paste into System Message field
6. Click **Save**

**What this changes:**
- AI now TRUSTS the pre-calculated bank_match_type
- AI extracts `RECEIPT_DATE:` for auto-correction
- Confidence scoring is deterministic and consistent
- AI only flags real issues (amount mismatches, unreadable receipts)

---

### Step 3: Update Parse AI Decision Node

1. Click **Parse AI Decision** node
2. Delete all existing code
3. Copy code from **`AGENT1_PARSE_AI_DECISION_CODE.md`**
4. Paste into node
5. Click **Save**

**What this fixes:**
- Multi-layer approval detection (handles emoji, markdown, variations)
- Deterministic fallback when AI response is ambiguous
- Extracts RECEIPT_DATE and compares to expense date
- Detects amount mismatches between receipt and expense
- Safety override: exact match + bank_transaction_id = force approve

---

### Step 4: Update Status Nodes

See **`AGENT1_UPDATE_STATUS_NODES.md`** for exact field configurations.

#### Update Status - Posted Node

Add these fields to save corrected data:

| Field Name | Expression |
|------------|------------|
| `expense_date` | `={{ $json.corrected_expense_date \|\| $json.date }}` |
| `original_expense_date` | `={{ $json.original_expense_date }}` |
| `amount` | `={{ $json.corrected_amount \|\| $json.amount }}` |
| `original_amount` | `={{ $json.original_amount }}` |

#### Update Status - Flagged Node

Add the same fields as above to preserve correction data for flagged expenses.

---

## Verification Checklist

After updating all nodes, test with a known expense:

- [ ] **Exact matches get 100% confidence** (not 60-80%)
- [ ] **Expenses with perfect matches are APPROVED** (not flagged due to AI response format)
- [ ] **Date inversions are detected** (check AI response for `RECEIPT_DATE:`)
- [ ] **Corrected dates are saved** to database (check `expense_date` vs `original_expense_date`)
- [ ] **Merchant matching works** for multi-word names like "Vineyard Creek Chevron"
- [ ] **Safety override works** (exact match + bank_transaction_id = always approved)

---

## Test Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| AI says "APPROVED" | ✓ APPROVED |
| AI says "✅ Perfect match" | ✓ APPROVED (signal detection) |
| AI gives empty response with exact match | ✓ APPROVED (safety override) |
| AI response ambiguous but bank_match_type=exact | ✓ APPROVED (deterministic) |
| Real amount mismatch >$5 | ✓ FLAGGED (safety check) |
| Date inversion detected (>1 day diff) | ✓ Auto-corrected, logged |
| Bank processing delay (±3 days) | ✓ Still matches |

---

## Database Migration

The following columns were added to support date/amount correction:

```sql
ALTER TABLE zoho_expenses
  ADD COLUMN IF NOT EXISTS original_amount DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS original_expense_date DATE;
```

**Status:** Already applied to production database.

---

## Related Documentation

| Document | Purpose |
|----------|---------|
| `AGENT1_UPDATE_GUIDE.md` | **← You are here** - Master update guide |
| `AGENT1_MATCH_BANK_TRANSACTION_CODE.md` | Complete code for Match Bank Transaction node |
| `AGENT1_AI_PROMPT.md` | Complete AI Agent system message |
| `AGENT1_PARSE_AI_DECISION_CODE.md` | Complete Parse AI Decision code |
| `AGENT1_UPDATE_STATUS_NODES.md` | Field configurations for status update nodes |
| `N8N_MATCH_BANK_TRANSACTION_FIX.md` | Technical explanation of matching logic |
| `PROJECT_CHANGELOG.md` | Historical record of all fixes |

---

## Troubleshooting

### Still getting low confidence on exact matches?

1. Check AI response - does it include the confidence calculation?
2. Verify `bank_match_type` in workflow execution data
3. Confirm AI Agent system message was completely replaced (not merged)
4. Check Parse AI Decision logs for which layer made the decision

### Date still wrong after processing?

1. Verify AI response includes `RECEIPT_DATE: YYYY-MM-DD`
2. Check Parse AI Decision output for `date_needs_correction: true`
3. Confirm Update Status nodes have the new field expressions
4. Check database - is `original_expense_date` populated?

### No bank match found?

1. Check if expense date was inverted (use corrected date for retry)
2. Verify bank transactions exist in ±3 day window of correct date
3. Check merchant name word extraction (4+ char words)
4. Look at `_debug_match_score` in workflow execution for match details

### Expense flagged despite perfect AI response?

1. Check Parse AI Decision logs - which layer made the decision?
2. Look for negative signals in AI response ("MISMATCH", "DIFFERS")
3. Verify safety override conditions (exact + bank_transaction_id + no negative signals)
4. Check if amount mismatch >$5 triggered override

---

## Key Principles

1. **Multi-layer detection prevents false negatives** - If one layer fails, others catch it
2. **Deterministic fallback ensures consistency** - bank_match_type always provides ground truth
3. **Safety overrides prevent bad auto-approvals** - Large amount mismatches force flagging
4. **Auto-correction preserves audit trail** - Original values saved before correction

---

**Last Review:** December 29, 2025
**Status:** Production-ready, tested with multiple expense types
