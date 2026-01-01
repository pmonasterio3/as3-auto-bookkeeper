# N8N Match Bank Transaction Fix + Date Auto-Correction

**Date:** December 29, 2025 (Updated: v2.0)

**Canonical Code Location:** `AGENT1_MATCH_BANK_TRANSACTION_CODE.md`

**Issues Fixed:**
1. Chevron gas station transactions getting 60% confidence when they should be 95%+
2. Date format inversion (11/09/2025 parsed as Sept 11 instead of Nov 9)
3. **v2.0:** Date tolerance expanded ±3 → ±15 days
4. **v2.0:** Multiple match detection - if 2+ transactions match, AI reviews all candidates

---

## Issue 1: Low Confidence Matching

The **Match Bank Transaction** code node in Agent 1 had two issues causing false low-confidence scores:

### Issue 1: Strict Date Matching
```javascript
// OLD CODE - requires exact date match
const dateMatch = (bankDate === expenseDate);
```

This failed when expense date was Nov 25 but bank posted on Nov 26 (normal 1-day bank processing delay).

### Issue 2: Poor Merchant Name Matching
```javascript
// OLD CODE - only checks first 5 characters
const prefix = merchantName.substring(0, Math.min(5, merchantName.length));
if (bankDesc.indexOf(prefix) >= 0 || bankVendor.indexOf(prefix) >= 0) {
  merchantMatch = true;
}
```

For "Vineyard Creek Chevron", prefix was "viney" which doesn't match "CHEVRON XXX5133/CHEVSANTA ROSA CA".

## Solution

### Fix 1: Date Tolerance (±15 days in v2.0)
```javascript
const expDateObj = new Date(expenseDate);
const bankDateObj = new Date(bankDate);
const daysDiff = Math.abs((bankDateObj - expDateObj) / (1000 * 60 * 60 * 24));
const dateMatch = daysDiff <= 15;  // v2.0: expanded from ±3 to ±15
```

### Fix 2: Word-Based Merchant Matching
```javascript
// Extract significant words (4+ chars) from merchant name
const merchantWords = merchantName.split(/\s+/).filter(w => w.length >= 4);
const bankText = (bankDesc + ' ' + bankVendor).toLowerCase();

let merchantMatch = false;
for (const word of merchantWords) {
  if (bankText.includes(word)) {
    merchantMatch = true;
    break;
  }
}

// Also check reverse: bank vendor words in merchant name
if (!merchantMatch && bankVendor.length >= 4) {
  const vendorWords = bankVendor.split(/\s+/).filter(w => w.length >= 4);
  for (const word of vendorWords) {
    if (merchantName.includes(word)) {
      merchantMatch = true;
      break;
    }
  }
}
```

## Expected Result

For the Chevron example:
- **Before:** `amount_only_match` (70 score) → AI gives 60% confidence
- **After:** `exact` (100 score) → AI gives 95-100% confidence

Because:
- Date: Nov 25 vs Nov 26 = 1 day diff ≤ 3 ✓
- Merchant: "chevron" (from "Vineyard Creek Chevron") found in "CHEVRON XXX5133" ✓
- Amount: Exact match ✓

## Complete Updated Code

**IMPORTANT:** The canonical code is now maintained in:
**`AGENT1_MATCH_BANK_TRANSACTION_CODE.md`**

Always use that file for the latest version. Copy-paste from there into n8n.

### v2.0 Changes Summary

| Feature | v1.0 | v2.0 |
|---------|------|------|
| Date tolerance | ±3 days | ±15 days |
| Multiple matches | Keep best only | Collect all ≥70 score |
| Output | `bank_match` | `bank_match` + `all_matches[]` + `has_multiple_matches` |
| Match type | Standard types | Added `multiple_matches_review` |

### When Multiple Matches Found

If 2+ bank transactions score ≥70:
- `bank_match_type` = `multiple_matches_review`
- `has_multiple_matches` = `true`
- `all_matches[]` = array of all candidates with `_match_score` and `_days_diff`
- AI Agent reviews and picks the best one (or flags if ambiguous)

## How to Apply

1. Open n8n workflow: **Agent 1 - Queue Based v3.0**
2. Find node: **Match Bank Transaction**
3. Replace the JavaScript code with the updated version above
4. Save and test with a Chevron transaction

## Verification

After applying the fix, the Chevron transaction should show:
- Match type: `exact` or `amount_date_match`
- Match score: 90-100
- AI confidence: 95%+

---

## Issue 2: Date Format Inversion (DD/MM vs MM/DD)

### Problem
Zoho may send dates in DD/MM/YYYY format (e.g., `11/09/2025`), which JavaScript interprets as MM/DD/YYYY (September 11 instead of November 9).

This causes bank transaction matching to fail because the expense date is off by weeks or months.

### Solution: Auto-Correct Dates from Receipt

Updated `supabase/functions/validate-receipt/index.ts` to auto-correct dates when the AI extracts a different date from the receipt with high confidence.

**New logic (similar to existing amount auto-correction):**
```typescript
// AUTO-CORRECT DATE: If receipt shows different date with high confidence, fix it
let dateCorrected = false
const originalDate = expense.expense_date
if (
  validation.date_extracted !== null &&
  validation.confidence >= 70 &&
  originalDate !== validation.date_extracted
) {
  // Check if dates differ by more than 1 day
  const expenseDate = new Date(originalDate)
  const receiptDate = new Date(validation.date_extracted)
  const daysDiff = Math.abs((receiptDate.getTime() - expenseDate.getTime()) / (1000 * 60 * 60 * 24))

  // Only auto-correct if dates differ significantly (> 1 day)
  // This catches DD/MM vs MM/DD inversions
  if (daysDiff > 1) {
    expenseUpdates.expense_date = validation.date_extracted
    expenseUpdates.original_expense_date = originalDate  // Audit trail
    dateCorrected = true
  }
}
```

### Database Migration Required

Run the migration to add audit columns:

```sql
-- File: supabase/migrations/20251229_add_original_value_columns.sql

ALTER TABLE zoho_expenses
ADD COLUMN IF NOT EXISTS original_amount DECIMAL(10,2);

ALTER TABLE zoho_expenses
ADD COLUMN IF NOT EXISTS original_expense_date DATE;
```

### How It Works

1. Receipt validation runs after expense is stored
2. AI extracts the actual date from the receipt image
3. If the extracted date differs by more than 1 day (with confidence >= 70%), the expense date is auto-corrected
4. Original date is preserved in `original_expense_date` for audit trail
5. Bank transaction matching now uses the correct date

### Example

| Field | Before | After |
|-------|--------|-------|
| `expense_date` | `2025-09-11` (wrong - Sept 11) | `2025-11-09` (correct - Nov 9) |
| `original_expense_date` | NULL | `2025-09-11` |
| Audit note | - | "Date auto-corrected based on receipt" |

---

---

## Issue 3: Fetch Receipt Tool Not Working (v2.1)

### Problem
AI Agent says "Receipt image could not be fetched" or "tool returned structured data but no image".

### Root Cause
The `expense-receipts` Supabase storage bucket was **private**, but the Fetch Receipt Tool URL used the private endpoint without proper authentication headers.

### Solution Applied
1. **Made bucket public** via SQL: `UPDATE storage.buckets SET public = true WHERE name = 'expense-receipts'`
2. **Update Fetch Receipt Tool URL** to use public endpoint

### Fetch Receipt Tool - URL Change Required

**Current (broken):**
```
https://fzwozzqwyzztadxgjryl.supabase.co/storage/v1/object/expense-receipts/{{ $fromAI('receipt_path') }}
```

**Change to:**
```
https://fzwozzqwyzztadxgjryl.supabase.co/storage/v1/object/public/expense-receipts/{{ $fromAI('receipt_path') }}
```

Note the `/public/` added before the bucket name.

---

## Issue 4: Calculate Date Range Still ±3 Days

The **Calculate Date Range** node still uses ±3 days, limiting bank transaction fetching even though Match Bank Transaction allows ±15 days.

### Fix Required

Update the Calculate Date Range node:
```javascript
date_start: {{ DateTime.fromISO($json.date).minus({days: 15}).toISODate() }}
date_end: {{ DateTime.fromISO($json.date).plus({days: 15}).toISODate() }}
```

---

## Deployment Checklist

1. **Database Migration**
   - Run: `supabase/migrations/20251229_add_original_value_columns.sql`

2. **n8n Workflow Updates** (Agent 1 - Queue Based v3.0)
   - **Match Bank Transaction** node: Use code from `AGENT1_MATCH_BANK_TRANSACTION_CODE.md`
   - **Fetch Receipt Tool**: Change URL to use `/public/` endpoint
   - **Calculate Date Range**: Change ±3 to ±15 days

3. **Test**
   - Process a transaction with a known date format issue
   - Verify receipt image is fetched successfully
   - Verify date is extracted from receipt
   - Verify bank transaction matching works with correct date
