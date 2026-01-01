# AS3 Auto Bookkeeper - System Analysis Report

**Version:** 1.0
**Date:** December 31, 2025
**Author:** Claude Agent
**Purpose:** Comprehensive analysis of n8n → Lambda migration issues and proposed fixes

---

## Executive Summary

The AS3 Auto Bookkeeper system is migrating from n8n-based workflows to AWS Lambda for expense processing. While the Lambda infrastructure is well-architected, there are **critical issues preventing the image processing pipeline from working**. This report identifies 7 major issues, analyzes their root causes, and provides a detailed fix plan.

### Current System Status

| Metric | Value |
|--------|-------|
| Total Expenses | 287 |
| Posted (Working) | 224 (78%) |
| Duplicates | 33 (11.5%) |
| Flagged (Need Review) | 17 (6%) |
| Errors | 13 (4.5%) |
| **Missing Receipts** | **19 (CRITICAL)** |

---

## Part 1: Architecture Comparison

### n8n Workflow (Working) - Agent 1 Queue Based v3.0

```
[Webhook] → [Fetch Queued Expense] → [Check Duplicate] →
  [Fetch Receipt] → [Match Bank Transaction] → [Lookup QBO Accounts] →
    [AI Agent (DECISION ONLY)] → [Parse AI Decision] →
      [IF Approved] → [QBO Vendor/Purchase/Upload] → [Monday Subitem]
```

**Key Pattern:** n8n PRE-FETCHES all data BEFORE the AI agent:
- Receipt image is fetched and stored as binary
- Bank transactions are matched before AI
- QBO accounts are looked up before AI
- AI Agent ONLY makes approve/flag decision

### Lambda Architecture (Current)

```
[API Gateway] → [Handler] → [AI Agent Loop] →
  (validate_receipt, match_bank, determine_state,
   lookup_qbo_*, create_qbo_*, upload_receipt, create_monday)
```

**Key Pattern:** Lambda asks AI to do EVERYTHING via tools:
- AI must call tools to fetch receipt, match bank, look up accounts
- More iterations needed = higher cost and latency
- More potential failure points

---

## Part 2: Critical Issues Identified

### Issue #1: Receipt Fetching Not Working (SEVERITY: CRITICAL)

**Evidence:**
- 19 expenses have `receipt_storage_path = NULL`
- Recent errors show: "Reset for re-processing - receipt and QBO mapping issues"
- Lambda handler HARD FAILS on line 126-143 if no receipt

**Root Cause:**
The Edge Function `receive-zoho-webhook/index.ts` imports `fetchAndStoreReceipt` from `zoho-receipt-fetcher.ts`, but:
1. Edge Functions must be deployed as single files via Dashboard (per CLAUDE.md)
2. The import may be failing silently
3. Error handling catches and logs but continues without receipt

**Code Location:** `supabase/functions/receive-zoho-webhook/index.ts:132-146`

```typescript
try {
  const receiptResult = await fetchAndStoreReceipt(supabase, expense.expense_id)
  // ...
} catch (receiptError) {
  // Log but don't fail - Lambda will handle missing receipts
  console.error(`Failed to fetch receipt...`)
}
```

---

### Issue #2: QBO Vendor Query SQL Injection (SEVERITY: HIGH)

**Evidence from `processing_errors`:**
```
QueryParserError: Encountered " <STRING> "'s" at line 1, column 48
```
Affected vendors: `Peet's`, `Love's`, `Coach's Sports Bar & Grill`, `Buc-ee's`

**Root Cause:**
Lambda's `qbo_client.py` has `_escape_vendor_name()` that escapes quotes:
```python
def _escape_vendor_name(self, name: str) -> str:
    return name.replace("'", "''")
```

BUT n8n's Query Vendor node uses a different escaping pattern that was fixed:
```javascript
.replace(/[''\\\\\\\\']/g, "''")
```

**Issue:** The Lambda escaping works for simple cases but may not handle all Unicode quote variants.

**Code Location:** `lambda/layers/common/python/utils/qbo_client.py:207-210`

---

### Issue #3: Missing QBO Account Mappings (SEVERITY: HIGH)

**Evidence:**
```
Required parameter Line.AccountBasedExpenseLineDetail.AccountRef is missing
```
Category `Vehicle (Rent/Wash) - COS` has no QBO account mapping.

**Root Cause:**
The `qbo_accounts` table is missing mappings for some Zoho categories.

**Code Location:** AI Agent prompt says to use fallback `Ask My Accountant (ID: 20)` but the n8n workflow flags instead.

---

### Issue #4: AI Agent Receipt Validation Requires URL (SEVERITY: HIGH)

**Evidence:**
The `validate_receipt` tool requires a `receipt_url` (signed URL) but the prompt tells AI:
```
Note: Use validate_receipt tool with a signed URL to analyze
```

The AI has no tool to GET a signed URL - it must be provided.

**Root Cause:**
n8n workflow fetches receipt BEFORE AI agent and stores as binary. Lambda expects AI to somehow get the signed URL.

**Code Location:**
- `lambda/functions/process_expense/prompts/expense_processor.py:105-109`
- `lambda/functions/process_expense/tools/receipt_validation.py:36-42`

---

### Issue #5: Date Range Bug in Bank Transaction Query (SEVERITY: MEDIUM)

**Evidence:** Bank transaction query has duplicate key:
```python
params = {
    "transaction_date": f"gte.{start_date}",
    "transaction_date": f"lte.{end_date}",  # Overwrites previous!
}
```

**Code Location:** `lambda/layers/common/python/utils/supabase_client.py:158-163`

---

### Issue #6: Processing Errors Show n8n, Not Lambda (SEVERITY: INFO)

**Evidence:**
All recent `processing_errors` records have n8n error structures (`NodeApiError`), not Lambda errors.

**Implication:** The Lambda pipeline may not be triggering at all - n8n is still running.

---

### Issue #7: Edge Function Multi-File Deployment (SEVERITY: HIGH)

**Evidence:**
`receive-zoho-webhook/index.ts` imports from `./zoho-receipt-fetcher.ts` but:
- CLAUDE.md says: "For multi-file functions: Combine into single index.ts file"
- Edge Functions deployed via Dashboard only support single files

**Root Cause:** The separate `zoho-receipt-fetcher.ts` file isn't deployed.

---

## Part 3: Component Analysis

### 3.1 Edge Function: `receive-zoho-webhook`

| Aspect | Assessment |
|--------|------------|
| **Webhook Handling** | ✅ Working - receives Zoho payloads |
| **Report Storage** | ✅ Working - upserts to zoho_expense_reports |
| **Expense Storage** | ✅ Working - upserts to zoho_expenses |
| **Receipt Fetching** | ❌ BROKEN - import likely failing |
| **Error Handling** | ⚠️ Too permissive - continues on receipt failure |

### 3.2 Lambda: `ProcessExpenseFunction`

| Component | File | Assessment |
|-----------|------|------------|
| **Handler** | `handler.py` | ✅ Well-structured, good error handling |
| **Agent** | `agent.py` | ⚠️ Good design but relies on tools |
| **Receipt Validation** | `tools/receipt_validation.py` | ⚠️ Needs URL provided by caller |
| **Bank Matching** | `tools/bank_matching.py` | ✅ Logic sound |
| **QBO Operations** | `tools/qbo_operations.py` | ⚠️ Missing URL generation for receipts |
| **QBO Client** | `utils/qbo_client.py` | ⚠️ Quote escaping may be incomplete |
| **Supabase Client** | `utils/supabase_client.py` | ⚠️ Date range query bug |

### 3.3 n8n Workflows (Legacy - Still Running)

| Workflow | Status | Issues |
|----------|--------|--------|
| Agent 1 - Queue Based v3.0 | Active | Working but has known bugs |
| Human Approved Processor V1.0 | Active | Working |

---

## Part 4: n8n vs Lambda - Feature Comparison

| Feature | n8n Workflow | Lambda | Gap |
|---------|--------------|--------|-----|
| Receipt Pre-fetch | ✅ Before AI | ❌ AI must fetch | Lambda needs pre-fetch |
| Bank Match Pre-fetch | ✅ Before AI | ❌ AI must match | Lambda needs pre-fetch |
| QBO Account Lookup | ✅ Before AI | ❌ AI must lookup | Lambda needs pre-fetch |
| AI Role | Decision only | Full orchestration | Lambda is over-engineered |
| Quote Escaping | ✅ Fixed | ⚠️ May need update | Check all quote variants |
| Receipt Binary Handling | ✅ Stores in workflow | ❌ Needs signed URL | Lambda needs signed URL |
| Monday.com Integration | ✅ Working | ❓ Not tested | Verify API version header |

---

## Part 5: Database Schema Analysis

### Tables with Issues

| Table | Records | Issue |
|-------|---------|-------|
| `zoho_expenses` | 287 | 19 missing `receipt_storage_path` |
| `qbo_accounts` | 78 | Missing category mappings |
| `processing_errors` | 12 | All show n8n errors, not Lambda |
| `receipt_validations` | 81 | Low count vs 287 expenses |

### Missing QBO Category Mappings

```sql
-- Categories in zoho_expenses without qbo_accounts mapping
SELECT DISTINCT category_name
FROM zoho_expenses ze
WHERE NOT EXISTS (
  SELECT 1 FROM qbo_accounts qa
  WHERE qa.zoho_category_match = ze.category_name
)
AND category_name IS NOT NULL;
```

---

## Part 6: Proposed Fix Plan

### Phase 1: Critical Fixes (Immediate)

#### Fix 1.1: Combine Edge Function Files

Merge `zoho-receipt-fetcher.ts` into `index.ts`:

```typescript
// index.ts - COMBINED FILE
// ... existing imports ...

// ========== ZOHO RECEIPT FETCHER (INLINE) ==========
let cachedTokens: ZohoTokens | null = null

async function getZohoAccessToken(): Promise<string> {
  // ... copy entire function ...
}

async function fetchReceiptFromZoho(...): Promise<...> {
  // ... copy entire function ...
}

async function uploadReceiptToStorage(...): Promise<string> {
  // ... copy entire function ...
}

export async function fetchAndStoreReceipt(...): Promise<...> {
  // ... copy entire function ...
}
// ========== END ZOHO RECEIPT FETCHER ==========

// ... rest of existing index.ts ...
```

#### Fix 1.2: Add Missing QBO Account Mappings

```sql
-- Add missing mappings
INSERT INTO qbo_accounts (name, qbo_id, account_type, zoho_category_match, is_cogs)
VALUES
  ('Vehicle Rent/Wash - COS', '??', 'Expense', 'Vehicle (Rent/Wash) - COS', true)
ON CONFLICT (name) DO UPDATE SET zoho_category_match = EXCLUDED.zoho_category_match;
```

#### Fix 1.3: Fix Supabase Client Date Range Query

```python
# Before (BROKEN):
params = {
    "transaction_date": f"gte.{start_date}",
    "transaction_date": f"lte.{end_date}",  # Overwrites!
}

# After (FIXED):
results = self._query("bank_transactions", {
    "status": "eq.unmatched",
    "source": f"eq.{source}",
    "and": f"(transaction_date.gte.{start_date},transaction_date.lte.{end_date})",
    "select": "id,transaction_date,description,amount,extracted_vendor,source",
    "order": "transaction_date.asc",
})
```

### Phase 2: Architecture Improvements (Short-term)

#### Fix 2.1: Pre-fetch Pattern for Lambda

Modify `handler.py` to pre-fetch data BEFORE calling AI agent:

```python
# In process_expense() BEFORE run_expense_agent():

# Pre-fetch receipt signed URL
if expense.receipt_storage_path:
    expense.receipt_signed_url = supabase.get_receipt_signed_url(
        expense.receipt_storage_path
    )

# Pre-fetch bank transaction candidates
expense.bank_candidates = supabase.get_unmatched_bank_transactions(
    source=determine_source(expense.paid_through),
    start_date=(expense.expense_date - timedelta(days=3)).isoformat(),
    end_date=(expense.expense_date + timedelta(days=3)).isoformat()
)

# Pre-fetch QBO account
expense.qbo_expense_account = supabase.get_qbo_account_for_category(
    expense.category_name
)
```

#### Fix 2.2: Update AI Prompt to Use Pre-fetched Data

```python
def build_expense_prompt(expense: Expense, retry_count: int = 0) -> str:
    # Include pre-fetched data in prompt
    receipt_info = ""
    if expense.receipt_signed_url:
        receipt_info = f"""
## Receipt (Pre-fetched)
- Signed URL: {expense.receipt_signed_url}
- Content Type: {expense.receipt_content_type}
- READY FOR validate_receipt tool"""

    bank_candidates_info = ""
    if expense.bank_candidates:
        candidates_summary = "\n".join([
            f"- ID: {c['id']}, Date: {c['transaction_date']}, Amount: ${c['amount']}, Vendor: {c['extracted_vendor']}"
            for c in expense.bank_candidates[:5]
        ])
        bank_candidates_info = f"""
## Bank Transaction Candidates (Pre-fetched)
{candidates_summary}"""
```

### Phase 3: Testing & Validation (Before Go-Live)

#### Test 1: Receipt Fetching

```python
# test_receipt_fetching.py
def test_receipt_fetch_from_zoho():
    """Test that edge function fetches receipt from Zoho API"""
    # Simulate webhook with known expense ID
    # Verify receipt_storage_path is populated
    pass

def test_receipt_signed_url_generation():
    """Test signed URL generation from Supabase Storage"""
    # Generate signed URL
    # Verify URL is accessible
    # Verify image content is valid
    pass
```

#### Test 2: QBO Operations

```python
# test_qbo_operations.py
def test_vendor_lookup_with_special_chars():
    """Test vendor lookup with apostrophes and special chars"""
    test_vendors = ["Peet's", "Buc-ee's", "Coach's Sports Bar & Grill"]
    for vendor in test_vendors:
        result = qbo_client.lookup_vendor(vendor)
        # Should not throw SQL parsing error
```

#### Test 3: Full Pipeline

```python
# test_full_pipeline.py
def test_expense_processing_end_to_end():
    """Test complete expense processing from Zoho to QBO"""
    # Create test expense in zoho_expenses
    # Trigger Lambda
    # Verify:
    #   - Receipt validated
    #   - Bank transaction matched
    #   - QBO Purchase created
    #   - Monday subitem created (if COS)
```

---

## Part 7: Recommended Migration Strategy

### Option A: Fix Lambda and Disable n8n (Recommended)

1. **Week 1:** Implement Phase 1 fixes
2. **Week 2:** Implement Phase 2 improvements
3. **Week 3:** Testing with real data (shadow mode - both systems run)
4. **Week 4:** Disable n8n, go live with Lambda only

### Option B: Hybrid Approach

Keep n8n for human-approved workflow, use Lambda only for auto-processing:
- n8n: Human Approved Processor (working)
- Lambda: Auto-processing of high-confidence expenses

### Option C: Fix n8n and Defer Lambda

If Lambda migration is non-critical:
1. Fix known n8n bugs (quote escaping)
2. Defer Lambda migration to Q2 2026

---

## Part 8: File Reference

### Files to Modify

| File | Priority | Changes Needed |
|------|----------|----------------|
| `supabase/functions/receive-zoho-webhook/index.ts` | P0 | Inline zoho-receipt-fetcher.ts |
| `lambda/layers/common/python/utils/supabase_client.py` | P0 | Fix date range query |
| `lambda/layers/common/python/utils/qbo_client.py` | P1 | Improve quote escaping |
| `lambda/functions/process_expense/handler.py` | P1 | Add pre-fetch pattern |
| `lambda/functions/process_expense/prompts/expense_processor.py` | P1 | Update prompt with pre-fetched data |
| Database: `qbo_accounts` | P1 | Add missing category mappings |

### Files That Work Correctly

| File | Assessment |
|------|------------|
| `lambda/functions/process_expense/agent.py` | ✅ Good design |
| `lambda/functions/process_expense/tools/bank_matching.py` | ✅ Logic correct |
| `lambda/functions/process_expense/tools/qbo_operations.py` | ✅ Uses client correctly |
| `supabase/functions/receive-zoho-webhook/zoho-receipt-fetcher.ts` | ✅ Code correct, just not deployed |

---

## Part 9: Questions for Clarification

Before implementing fixes, please confirm:

1. **Should Lambda completely replace n8n?** Or should we keep n8n for human-approved flow?

2. **Which QBO account ID should map to `Vehicle (Rent/Wash) - COS`?** Need the actual QBO account ID.

3. **Is there a test Zoho expense we can use?** To verify receipt fetching end-to-end.

4. **Can we access CloudWatch Logs?** To verify if Lambda is even being triggered.

5. **Should the AI agent still do full orchestration?** Or should we simplify to decision-only like n8n?

---

## Appendix A: Error Samples

### Sample 1: QBO SQL Parse Error

```json
{
  "error_message": "QueryParserError: Encountered \" <STRING> \"'s\" at line 1, column 48",
  "vendor_name": "Peet's"
}
```

### Sample 2: Missing QBO Account

```json
{
  "error_message": "Required parameter Line.AccountBasedExpenseLineDetail.AccountRef is missing",
  "category_name": "Vehicle (Rent/Wash) - COS",
  "qbo_expense_account_id": null
}
```

### Sample 3: Receipt Not Found

```json
{
  "status": "error",
  "flag_reason": "Reset for re-processing - receipt and QBO mapping issues",
  "receipt_storage_path": null
}
```

---

*End of System Analysis Report*
