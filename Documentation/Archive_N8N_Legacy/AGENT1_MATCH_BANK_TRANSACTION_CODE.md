# Agent 1 - Match Bank Transaction Code

**Version:** 2.1 | **Updated:** December 29, 2025

## Changes in v2.1
- **CRITICAL FIX:** Changed `bank.bank_amount` → `bank.amount` (field name mismatch was causing $0 amounts)
- Date tolerance: ±3 days → **±15 days**
- Multiple match detection: If 2+ transactions score ≥70, flag for AI decision
- New output fields: `has_multiple_matches`, `all_matches[]`

## ALSO UPDATE: Calculate Date Range Node
The Calculate Date Range node must also be updated to ±15 days:
- `date_start`: `{{ DateTime.fromISO($json.date).minus({days: 15}).toISODate() }}`
- `date_end`: `{{ DateTime.fromISO($json.date).plus({days: 15}).toISODate() }}`

---

## Steps
1. Open n8n → **Agent 1 - Queue Based v3.0**
2. Click **Match Bank Transaction** node
3. Delete all code
4. Paste the code below (between CODE START and CODE END)
5. Save workflow

---

## CODE START
```javascript
const inputData = $input.first().json;
const bankTransactions = inputData._bank_transactions || [];
const { _debug_bank_count, ...expenseData } = inputData;

console.log('=== MATCH BANK TRANSACTION v2.0 ===');
console.log('Expense:', expenseData.expense_id, expenseData.merchant_name, '$' + expenseData.amount_number);
console.log('Bank transactions to match against:', bankTransactions.length);

if (!expenseData || !expenseData.expense_id) {
  console.log('ERROR: No expense data found!');
  return [{
    json: {
      error: 'No expense data found in Match Bank Transaction',
      bank_match: null,
      bank_match_type: 'error',
      bank_transaction_id: null,
      has_multiple_matches: false,
      all_matches: [],
      _bank_transactions: []
    }
  }];
}

// PRE-MATCHED TRANSACTION (from manual UI matching)
if (expenseData.bank_transaction_id) {
  console.log('PRE-MATCHED: Looking for bank_transaction_id:', expenseData.bank_transaction_id);
  const preMatched = bankTransactions.find(bt => bt.id === expenseData.bank_transaction_id);
  if (preMatched) {
    console.log('PRE-MATCH FOUND:', preMatched.id, preMatched.extracted_vendor, '$' + preMatched.amount);
    return [{
      json: {
        ...expenseData,
        bank_match: preMatched,
        bank_match_type: 'pre_matched_manual',
        bank_transaction_id: preMatched.id,
        has_multiple_matches: false,
        all_matches: [{ ...preMatched, _match_score: 100, _match_type: 'pre_matched_manual' }],
        _bank_transactions: bankTransactions,
        _debug_match_score: 100
      }
    }];
  } else {
    console.log('WARNING: Pre-matched transaction not found. Will try normal matching.');
  }
}

// MATCHING ALGORITHM
const expenseAmount = parseFloat(expenseData.amount_number) || parseFloat(expenseData.amount) || 0;
const expenseDate = String(expenseData.date || '');
const merchantName = String(expenseData.merchant_name || '').toLowerCase();
const category = String(expenseData.category_name || '').toLowerCase();

// Collect ALL qualifying matches (score >= 70)
const allMatches = [];

for (const bank of bankTransactions) {
  const bankAmount = Math.abs(parseFloat(bank.amount) || 0);
  const bankDate = String(bank.transaction_date || '');
  const amountDiff = Math.abs(bankAmount - expenseAmount);

  // Date tolerance: ±15 days (expanded from ±3)
  let dateMatch = false;
  let daysDiff = 999;
  if (expenseDate && bankDate) {
    const expDateObj = new Date(expenseDate);
    const bankDateObj = new Date(bankDate);
    daysDiff = Math.abs((bankDateObj - expDateObj) / (1000 * 60 * 60 * 24));
    dateMatch = daysDiff <= 15;
  }

  const bankDesc = String(bank.description || '').toLowerCase();
  const bankVendor = String(bank.extracted_vendor || '').toLowerCase();

  // Word-based merchant matching
  let merchantMatch = false;
  const merchantWords = merchantName.split(/[\s\-\/]+/).filter(w => w.length >= 4);
  const bankText = bankDesc + ' ' + bankVendor;

  for (const word of merchantWords) {
    if (bankText.includes(word)) {
      merchantMatch = true;
      break;
    }
  }

  // Reverse check: bank vendor words in merchant name
  if (!merchantMatch && bankVendor.length >= 4) {
    const vendorWords = bankVendor.split(/[\s\-\/]+/).filter(w => w.length >= 4);
    for (const word of vendorWords) {
      if (merchantName.includes(word)) {
        merchantMatch = true;
        break;
      }
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
  } else if ((category.includes('meal') || category.includes('catering'))) {
    const minTip = expenseAmount * 1.18;
    const maxTip = expenseAmount * 1.25;
    if (bankAmount >= minTip && bankAmount <= maxTip && dateMatch) {
      score = 75; type = 'restaurant_with_tip';
    }
  }

  console.log(`  Bank $${bankAmount} | Days: ${daysDiff.toFixed(1)} | DateOK: ${dateMatch} | MerchantOK: ${merchantMatch} | Score: ${score}`);

  // Collect all matches with score >= 70
  if (score >= 70) {
    allMatches.push({
      ...bank,
      _match_score: score,
      _match_type: type,
      _days_diff: daysDiff
    });
  }
}

// Sort by score (descending), then by days difference (ascending)
allMatches.sort((a, b) => {
  if (b._match_score !== a._match_score) return b._match_score - a._match_score;
  return a._days_diff - b._days_diff;
});

const hasMultipleMatches = allMatches.length >= 2;
const bestMatch = allMatches.length > 0 ? allMatches[0] : null;
let matchType = bestMatch ? bestMatch._match_type : 'no_match';
let matchScore = bestMatch ? bestMatch._match_score : 0;

// If multiple matches, let AI decide (set flag)
if (hasMultipleMatches) {
  console.log('MULTIPLE MATCHES FOUND:', allMatches.length);
  allMatches.forEach((m, i) => {
    console.log(`  Match ${i+1}: $${m.amount} | ${m.extracted_vendor} | Score: ${m._match_score} | Days: ${m._days_diff.toFixed(1)}`);
  });
  matchType = 'multiple_matches_review';
}

console.log('RESULT:', matchType, 'Score:', matchScore, 'Bank ID:', bestMatch?.id || 'none', 'Total Matches:', allMatches.length);

return [{
  json: {
    ...expenseData,
    bank_match: bestMatch,
    bank_match_type: matchType,
    bank_transaction_id: bestMatch ? bestMatch.id : null,
    has_multiple_matches: hasMultipleMatches,
    all_matches: allMatches,
    _bank_transactions: bankTransactions,
    _debug_match_score: matchScore
  }
}];
```
## CODE END
