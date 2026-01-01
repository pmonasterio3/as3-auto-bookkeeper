# N8N Pre-Match Fix Documentation

**Issue:** When users manually match an expense to a bank transaction via the Review UI, n8n needs to recognize and prefer the pre-matched transaction.

**Solution Applied (December 26, 2025):**

1. **Code change (DONE)**: `handleResubmit` in `reviewActions.ts` no longer updates `bank_transactions.status`. The transaction remains 'unmatched' so n8n can find it in its query.

2. **n8n changes (REQUIRED)**: Two modifications needed:
   - Add `bank_transaction_id` to "Edit Fields" node
   - Modify "Match Bank Transaction" to prefer pre-matched transactions

**Original Root Cause:**
1. `handleResubmit` was setting `bank_transactions.status = 'matched'` AND `zoho_expenses.bank_transaction_id = <UUID>`
2. n8n's HTTP Request node queries: `status=eq.unmatched` which EXCLUDED the pre-matched transaction
3. n8n then failed to find a match and flagged the expense

---

## Required Workflow Changes (SIMPLIFIED)

Since `handleResubmit` no longer changes the bank transaction status, the transaction remains 'unmatched' and n8n can find it. The changes needed are minimal:

### 1. Update "Edit Fields" Node

Add a new assignment to pass through the pre-matched bank_transaction_id:

| Field Name | Value | Type |
|------------|-------|------|
| bank_transaction_id | `={{ $json.bank_transaction_id }}` | string |

This field is set by `handleResubmit` when the user manually matches an expense. It tells the matching algorithm which transaction to prefer.

---

### 2. Modify "Match Bank Transaction" Node

Replace the existing code with this updated version that checks for pre-matched transactions:

```javascript
// Get data from input (now contains expense data + embedded bank transactions)
const inputData = $input.first().json;
const bankTransactions = inputData._bank_transactions || [];

// Extract expense data (remove the _bank_transactions field)
const { _bank_transactions, _debug_bank_count, ...expenseData } = inputData;

// DEBUG: Log matching attempt
console.log('=== MATCH BANK TRANSACTION DEBUG ===');
console.log('Expense:', expenseData.expense_id, expenseData.merchant_name, '$' + expenseData.amount_number);
console.log('Bank transactions to match against:', bankTransactions.length);

if (!expenseData || !expenseData.expense_id) {
  console.log('ERROR: No expense data found!');
  return [{
    json: {
      error: 'No expense data found in Match Bank Transaction',
      bank_match: null,
      bank_match_type: 'error',
      bank_transaction_id: null
    }
  }];
}

// CHECK FOR PRE-MATCHED TRANSACTION (from manual UI matching)
// If bank_transaction_id is already set, look for that specific transaction
if (expenseData.bank_transaction_id) {
  console.log('PRE-MATCHED: Looking for bank_transaction_id:', expenseData.bank_transaction_id);

  const preMatched = bankTransactions.find(bt => bt.id === expenseData.bank_transaction_id);

  if (preMatched) {
    console.log('PRE-MATCH FOUND:', preMatched.id, preMatched.extracted_vendor, '$' + preMatched.bank_amount);
    return [{
      json: {
        ...expenseData,
        bank_match: preMatched,
        bank_match_type: 'pre_matched_manual',
        bank_transaction_id: preMatched.id,
        _debug_match_score: 100
      }
    }];
  } else {
    console.log('WARNING: Pre-matched transaction not found in query results. Will try normal matching.');
    // Fall through to normal matching - the pre-matched transaction might have different date range
  }
}

// NORMAL MATCHING ALGORITHM
const expenseAmount = parseFloat(expenseData.amount_number) || parseFloat(expenseData.amount) || 0;
const expenseDate = String(expenseData.date || '');
const merchantName = String(expenseData.merchant_name || '').toLowerCase();
const category = String(expenseData.category_name || '').toLowerCase();

let bestMatch = null;
let matchType = 'no_match';
let matchScore = 0;

for (const bank of bankTransactions) {
  const bankAmount = Math.abs(parseFloat(bank.bank_amount) || 0);
  const bankDate = String(bank.transaction_date || '');
  const amountDiff = Math.abs(bankAmount - expenseAmount);
  const dateMatch = (bankDate === expenseDate);

  const bankDesc = String(bank.description || '').toLowerCase();
  const bankVendor = String(bank.extracted_vendor || '').toLowerCase();

  let merchantMatch = false;
  if (merchantName.length >= 3) {
    const prefix = merchantName.substring(0, Math.min(5, merchantName.length));
    if (bankDesc.indexOf(prefix) >= 0 || bankVendor.indexOf(prefix) >= 0) {
      merchantMatch = true;
    }
  }
  if (!merchantMatch && bankVendor.length >= 3) {
    const vPrefix = bankVendor.substring(0, Math.min(5, bankVendor.length));
    if (merchantName.indexOf(vPrefix) >= 0) {
      merchantMatch = true;
    }
  }

  let score = 0;
  let type = 'no_match';

  if (amountDiff <= 0.01 && dateMatch && merchantMatch) {
    score = 100; type = 'exact';
  } else if (amountDiff <= 0.01 && dateMatch) {
    score = 90; type = 'amount_date_match';
  } else if (amountDiff <= 0.01 && merchantMatch) {
    score = 80; type = 'amount_merchant_match';
  } else if (amountDiff <= 0.01) {
    score = 70; type = 'amount_only_match';
  } else if ((category.indexOf('meal') >= 0 || category.indexOf('catering') >= 0)) {
    const minTip = expenseAmount * 1.18;
    const maxTip = expenseAmount * 1.25;
    if (bankAmount >= minTip && bankAmount <= maxTip) {
      score = 75; type = 'restaurant_with_tip';
    }
  }

  // DEBUG: Log each comparison
  console.log(`  Comparing: Bank $${bankAmount} vs Expense $${expenseAmount} | AmtDiff: ${amountDiff.toFixed(2)} | DateMatch: ${dateMatch} | MerchantMatch: ${merchantMatch} | Score: ${score} (${type})`);

  if (score > matchScore) {
    bestMatch = bank;
    matchType = type;
    matchScore = score;
  }
}

console.log('RESULT:', matchType, 'Score:', matchScore, 'Bank ID:', bestMatch?.id || 'none');
console.log('=== END MATCH DEBUG ===');

return [{
  json: {
    ...expenseData,
    bank_match: bestMatch,
    bank_match_type: matchType,
    bank_transaction_id: bestMatch ? bestMatch.id : null,
    _debug_match_score: matchScore
  }
}];
```

**Key Changes:**
- Lines 19-38: Check if `bank_transaction_id` is already set (pre-matched by user)
- If found in the bank transactions pool, immediately return with match type `'pre_matched_manual'` and score 100
- If not found (edge case), fall through to normal matching algorithm

---

## Why This Works

1. **Bank transaction stays unmatched**: Since `handleResubmit` no longer changes the bank transaction status, n8n's query will find it
2. **bank_transaction_id passed through**: The Edit Fields node passes the pre-matched ID to downstream nodes
3. **Match Bank Transaction prefers pre-match**: If `bank_transaction_id` is set, the code looks for that specific transaction first
4. **100% confidence for pre-matches**: Pre-matched transactions get `match_type = 'pre_matched_manual'` and score 100
5. **Fallback to normal matching**: If the pre-matched transaction isn't in the query results (edge case), normal matching runs

---

## Testing

After applying these changes:

1. Match an expense to a bank transaction via the Review UI
2. Click "Save & Resubmit" or "Resubmit"
3. Verify in the database:
   - `zoho_expenses.bank_transaction_id` is set to the matched transaction
   - `zoho_expenses.status` is 'pending'
   - `bank_transactions.status` is still 'unmatched' (NOT 'matched')
4. Queue controller triggers n8n
5. n8n should:
   - Find the bank transaction in its query (because it's still 'unmatched')
   - Detect the pre-match in "Match Bank Transaction" code
   - Use match_type = 'pre_matched_manual' with score 100
   - Process through to QBO posting successfully
   - Update bank_transactions.status to 'matched' AFTER QBO posting

---

## Summary of Changes

| Component | Change | Status |
|-----------|--------|--------|
| `reviewActions.ts` | Don't update bank_transaction.status in handleResubmit | ✅ DONE |
| n8n Edit Fields | Add `bank_transaction_id` assignment | ⏳ TODO |
| n8n Match Bank Transaction | Add pre-match detection code | ⏳ TODO |

---

*Created: December 26, 2025*
*Updated: December 26, 2025*
*For: AS3 Auto Bookkeeper - Agent 1 Queue Based v3.0*
