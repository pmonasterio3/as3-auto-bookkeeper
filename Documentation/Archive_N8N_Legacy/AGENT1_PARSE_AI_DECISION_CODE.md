# Parse AI Decision - Complete Code

**Last Updated:** December 29, 2025
**Version:** 3.0 - SIMPLIFIED
**Node:** Parse AI Decision
**Workflow:** Agent 1 - Queue Based v3.0

---

## How to Deploy

1. Open n8n → **Agent 1 - Queue Based v3.0**
2. Click **Parse AI Decision** node
3. Delete ALL existing code
4. Copy everything between the `CODE START` and `CODE END` markers below
5. Paste into the node
6. Save workflow

---

## CODE START

```javascript
// ============================================================
// PARSE AI DECISION - SIMPLIFIED v3.0
// December 29, 2025
// ============================================================
// SIMPLE LOGIC:
// 1. If AI says APPROVED -> approve
// 2. If AI says FLAGGED -> flag
// 3. Extract confidence, vendor, dates from AI response
// ============================================================

const aiOutput = $input.first().json;
const output = aiOutput.output || aiOutput.text || '';

console.log('=== PARSE AI DECISION ===');
console.log('AI output first 100 chars:', output.substring(0, 100));

// ============================================================
// STEP 1: GET EXPENSE DATA
// ============================================================
let expenseData = {};
try {
  expenseData = $('Filter Monday').first()?.json || {};
} catch (e) {}

if (!expenseData.expense_id) {
  try {
    expenseData = $('Add Empty Monday').first()?.json || {};
  } catch (e) {}
}

if (!expenseData.expense_id) {
  try {
    expenseData = $('Edit Fields').first()?.json || {};
  } catch (e) {}
}

// ============================================================
// STEP 2: SIMPLE DECISION - DOES IT START WITH APPROVED?
// ============================================================
const outputTrimmed = output.trim().toUpperCase();
const startsWithApproved = outputTrimmed.startsWith('APPROVED');
const startsWithFlagged = outputTrimmed.startsWith('FLAGGED');

let isApproved = false;

if (startsWithApproved) {
  isApproved = true;
  console.log('Decision: AI said APPROVED');
} else if (startsWithFlagged) {
  isApproved = false;
  console.log('Decision: AI said FLAGGED');
} else {
  // Fallback: check if APPROVED appears anywhere in first 200 chars
  const first200 = output.substring(0, 200).toUpperCase();
  if (first200.includes('APPROVED') && !first200.includes('FLAGGED')) {
    isApproved = true;
    console.log('Decision: Found APPROVED in first 200 chars');
  } else {
    isApproved = false;
    console.log('Decision: Could not find APPROVED, defaulting to FLAG');
  }
}

// ============================================================
// STEP 3: EXTRACT CONFIDENCE
// ============================================================
let confidence = 85; // default
const confMatch = output.match(/Confidence:\s*(\d+)%/i);
if (confMatch) {
  confidence = parseInt(confMatch[1]);
  console.log('Extracted confidence:', confidence);
}

// If approved but no confidence found, assume high confidence
if (isApproved && !confMatch) {
  confidence = 95;
}

// ============================================================
// STEP 4: EXTRACT RECEIPT DATE (for date correction)
// ============================================================
let receiptDateExtracted = null;
const dateMatch = output.match(/RECEIPT_DATE:\s*(\d{4}-\d{2}-\d{2})/);
if (dateMatch) {
  receiptDateExtracted = dateMatch[1];
  console.log('Extracted receipt date:', receiptDateExtracted);
}

let dateNeedsCorrection = false;
let originalExpenseDate = null;

if (receiptDateExtracted && expenseData?.date) {
  const expDate = new Date(expenseData.date);
  const recDate = new Date(receiptDateExtracted);
  const daysDiff = Math.abs((recDate - expDate) / (1000 * 60 * 60 * 24));

  if (daysDiff > 1) {
    dateNeedsCorrection = true;
    originalExpenseDate = expenseData.date;
    console.log('Date correction needed:', expenseData.date, '->', receiptDateExtracted);
  }
}

// ============================================================
// STEP 5: EXTRACT VENDOR NAME
// ============================================================
let vendorClean = null;
const vendorMatch = output.match(/Vendor:\s*([^\n]+)/i);
if (vendorMatch) {
  vendorClean = vendorMatch[1].trim()
    .replace(/\*\*/g, '')
    .replace(/\s*\(.*\)/, '')
    .trim();
}

let merchantForQBO = vendorClean || expenseData?.merchant_name || '';
merchantForQBO = merchantForQBO
  .replace(/[^\w\s\-&.]/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .substring(0, 100);

// ============================================================
// STEP 6: GET BANK TRANSACTION INFO
// ============================================================
let bankTransactionId = expenseData?.bank_transaction_id || null;
let bankMatchType = expenseData?.bank_match_type || null;

// ============================================================
// STEP 7: BUILD FLAG REASON (if flagged)
// ============================================================
let flagReason = null;

if (!isApproved) {
  // Try to extract reason from AI response
  const reasonMatch = output.match(/Reason:\s*([^\n]+)/i);
  if (reasonMatch) {
    flagReason = reasonMatch[1].trim();
  } else if (!bankTransactionId) {
    flagReason = 'no_bank_match';
  } else {
    flagReason = 'AI flagged for manual review';
  }
}

// ============================================================
// STEP 8: RETURN RESULT
// ============================================================
console.log('=== FINAL RESULT ===');
console.log('isApproved:', isApproved);
console.log('should_post:', isApproved);
console.log('confidence:', confidence);

return [{
  json: {
    ...expenseData,

    // Core decision
    ai_decision: isApproved ? 'APPROVED' : 'FLAGGED',
    ai_confidence: confidence,
    ai_response: output,
    should_post: isApproved,

    // Vendor
    vendor_clean: vendorClean || expenseData?.vendor_clean || expenseData?.merchant_name,
    merchant_name_for_qbo: merchantForQBO,

    // Flag info
    flag_reason: flagReason,

    // Bank transaction
    bank_transaction_id: bankTransactionId,
    bank_match_type: bankMatchType,

    // Date correction
    receipt_date_extracted: receiptDateExtracted,
    date_needs_correction: dateNeedsCorrection,
    original_expense_date: originalExpenseDate,
    corrected_expense_date: dateNeedsCorrection ? receiptDateExtracted : null
  }
}];
```

## CODE END

---

## What This Does

1. **Check if AI said APPROVED** - If output starts with "APPROVED", approve it
2. **Check if AI said FLAGGED** - If output starts with "FLAGGED", flag it
3. **Extract confidence** - Parse "Confidence: XX%" from AI response
4. **Extract receipt date** - Parse "RECEIPT_DATE: YYYY-MM-DD" for date correction
5. **Extract vendor** - Parse "Vendor: XXX" for QBO posting
6. **Pass through bank data** - From expenseData

---

## Why v3.0 is Better

- **60 lines of logic** vs 300+ lines before
- **One simple rule**: AI says APPROVED → approve, AI says FLAGGED → flag
- **No complex layers** that can conflict with each other
- **No safety overrides** that depend on upstream node references working

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| v3.0 | Dec 29, 2025 | Complete rewrite - SIMPLIFIED. Just check if AI said APPROVED |
| v2.0 | Dec 29, 2025 | Added fallbacks and safety overrides (too complex, failed) |
| v1.0 | Dec 29, 2025 | Initial bulletproof version (overcomplicated) |
