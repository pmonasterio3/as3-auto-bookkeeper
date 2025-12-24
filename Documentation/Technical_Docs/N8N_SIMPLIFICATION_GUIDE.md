# n8n Workflow Simplification Guide

**Version:** 1.0
**Created:** December 22, 2025
**Purpose:** Remove AI receipt validation from n8n (now handled by Edge Function)

---

## Background

Receipt validation has been moved to a Supabase Edge Function (`validate-receipt`) which:
- Uses Claude API to analyze receipt images
- Stores results in `receipt_validations` table
- Updates `zoho_expenses.receipt_validated = true`
- Runs automatically when expenses are received from Zoho

**Benefits of this change:**
- No binary image data flowing through n8n workflow
- Eliminates out-of-memory crashes
- Faster n8n execution (no waiting for Claude API)
- Validation results pre-computed before n8n runs

---

## Changes Required

### 1. REMOVE: Node 4 - Fetch Receipt from Storage

**Current:** Downloads receipt image as binary data
**Action:** DELETE this node entirely

The workflow no longer needs to handle binary receipt data.

---

### 2. MODIFY: Node 11 - Merge Reference Data

**Current:** Includes binary data passthrough
**Change:** Remove all binary references

**Before:**
```javascript
return [{
  json: {
    expense: expense,
    reference_data: { ... },
    monday_event: expense.monday_event
  },
  binary: binary  // REMOVE THIS
}];
```

**After:**
```javascript
return [{
  json: {
    expense: expense,
    reference_data: { ... },
    monday_event: expense.monday_event
  }
}];
```

---

### 3. ADD: Node - Fetch Receipt Validation

**Purpose:** Get pre-computed validation results from database

**Add Supabase Node AFTER "Fetch Expense":**
- **Name:** `Fetch Receipt Validation`
- **Operation:** Get Many Rows
- **Table:** `receipt_validations`
- **Filters:**
  - Field: `expense_id`
  - Condition: `equals`
  - Value: `{{ $json.id }}`
- **Limit:** 1

---

### 4. MODIFY: Node 12 - AI Agent Prompt

**Remove this section entirely:**
```
### Receipt Image:
Attached as binary. Verify amount and merchant.
```

**Replace with:**
```
### Receipt Validation (Pre-Computed):
{{ $json.receipt_validation ? JSON.stringify($json.receipt_validation, null, 2) : 'No receipt or validation pending' }}

Key fields:
- merchant_extracted: What the receipt shows
- amount_extracted: Amount on receipt
- amounts_match: Whether receipt matches expense amount
- merchant_match: Whether merchant names match
- confidence: 0-100 validation confidence
- issues: Any problems found
```

---

### 5. MODIFY: AI Agent Confidence Scoring

**Remove:**
```
- Receipt amount mismatch (>$1): -30
- No receipt: -25
```

**Replace with:**
```
- Receipt validation confidence < 80%: -20
- Receipt validation has issues: -15 per issue
- No receipt validation available: -10
```

**New confidence logic:**
```
## CONFIDENCE SCORING

Start at 100, subtract:
- No bank match: -40
- COS without Monday event: -20
- State unclear: -20
- Category not found: -15
- Receipt validation confidence < 80%: -20
- Receipt validation has issues: -15 per issue
- No receipt validation: -10
```

---

### 6. UPDATE: Merge Reference Data Code

**New Code for Node 11:**
```javascript
const expense = $('Merge').first().json;
const receiptValidation = $('Fetch Receipt Validation').first()?.json || null;

const bankTransactions = $('Fetch Bank Transactions').all().map(item => item.json);
const qboAccounts = $('Fetch QBO Accounts').all().map(item => item.json);
const qboClasses = $('Fetch QBO Classes').all().map(item => item.json);

return [{
  json: {
    expense: expense,
    receipt_validation: receiptValidation,
    reference_data: {
      bank_transactions: bankTransactions,
      qbo_accounts: qboAccounts,
      qbo_classes: qboClasses
    },
    monday_event: expense.monday_event
  }
}];
```

---

### 7. REMOVE: Binary Passthrough from All Code Nodes

Search for and remove all instances of:
```javascript
binary: $('...').first().binary
binary: $input.first().binary
binary: inputItem.binary
```

These are no longer needed.

---

### 8. REMOVE: Node 19-20 - Receipt Upload to QBO

**Option A (Recommended):** Keep receipt upload but fetch from Storage
- Change Node 20 to fetch receipt directly from Supabase Storage URL
- No binary passthrough needed

**Option B:** Remove receipt upload entirely
- Delete nodes 19 (IF Receipt Exists) and 20 (Upload Receipt to QBO)
- Connect "Get Purchase ID" directly to "Update Bank Transaction"
- Receipts remain in Supabase Storage (accessible via UI)

---

## Updated Workflow Flow

```
[Webhook] → [Fetch Expense] → [Fetch Receipt Validation] → [IF Processing?]
                                                                  │
                               ┌─────── NO ───────────────────────┤
                               ▼                                  │ YES
                         [Exit Early]                             ▼
                                                           [IF is COS?]
                                                            /         \
                                                       YES /           \ NO
                                                          ▼             ▼
                                                   [Monday API]    [Add Empty Monday]
                                                          \             /
                                                           \           /
                                                            ▼         ▼
                                                             [Merge]
                                                                │
                                         ┌──────────────────────┼──────────────────────┐
                                         ▼                      ▼                      ▼
                                   [Bank Txns]            [QBO Accounts]          [QBO Classes]
                                         │                      │                      │
                                         └──────────────────────┼──────────────────────┘
                                                                ▼
                                                    [Merge Reference + Validation]
                                                                │
                                                                ▼
                                                          [AI Agent]
                                                       (NO binary data!)
                                                                │
                                                                ▼
                                                      [Parse AI Output]
                                                                │
                                                                ▼
                                                        ... rest same ...
```

---

## Summary of Removed/Changed Nodes

| Node | Action | Reason |
|------|--------|--------|
| Fetch Receipt from Storage | DELETE | No longer needed |
| All `binary:` references | DELETE | No binary data in workflow |
| AI prompt receipt section | REPLACE | Use pre-computed validation |
| Receipt Upload to QBO | MODIFY or DELETE | Fetch from Storage if keeping |

---

## Benefits After Simplification

1. **No more out-of-memory crashes** - No binary data flowing through workflow
2. **Faster execution** - AI Agent only does matching, not image analysis
3. **More reliable** - Less data = fewer points of failure
4. **Better debugging** - Validation results stored in DB, visible in UI

---

## Testing After Changes

1. Reset a flagged expense to `status = 'pending'`
2. Trigger the queue controller
3. Verify n8n completes without memory errors
4. Check that receipt validation data was used in AI decision

---

*End of Simplification Guide*
