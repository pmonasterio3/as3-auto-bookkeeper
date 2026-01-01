# AS3 Auto Bookkeeper - Migration & Fix Plan

**Version:** 1.0
**Date:** December 31, 2025
**Author:** Claude Agent
**Status:** Ready for Implementation

---

## Executive Summary

This document provides detailed, step-by-step instructions to fix the 7 critical issues identified in the System Analysis Report and complete the n8n to Lambda migration.

### Priority Matrix

| Issue | Severity | Effort | Impact if Fixed |
|-------|----------|--------|-----------------|
| #1 Receipt Fetching | CRITICAL | Medium | 19 expenses unblocked |
| #2 QBO Vendor Escaping | HIGH | Low | SQL errors eliminated |
| #3 Missing QBO Mappings | HIGH | Low | Account errors fixed |
| #4 Date Range Query Bug | MEDIUM | Low | Bank matching works |
| #5 AI Pre-fetch Pattern | HIGH | Medium | Reduced cost/latency |
| #6 Edge Function Deployment | HIGH | Medium | Receipt fetch works |
| #7 n8n Still Running | INFO | Low | Clean cutover |

---

## Phase 1: Critical Fixes (Immediate)

### Fix 1.1: Combine Edge Function Files

**Problem:** `receive-zoho-webhook/index.ts` imports from `./zoho-receipt-fetcher.ts` but Edge Functions deployed via Dashboard only support single files.

**Location:** `supabase/functions/receive-zoho-webhook/`

**Action:** Merge `zoho-receipt-fetcher.ts` content into `index.ts`

**Steps:**

1. Open `supabase/functions/receive-zoho-webhook/index.ts`
2. Remove the import line:
   ```typescript
   // REMOVE THIS LINE:
   import { fetchAndStoreReceipt } from './zoho-receipt-fetcher.ts'
   ```

3. Copy ALL content from `zoho-receipt-fetcher.ts` and paste BEFORE the `serve()` function:

```typescript
// ========== ZOHO RECEIPT FETCHER (INLINE) ==========
// Inline from zoho-receipt-fetcher.ts for single-file deployment

interface ZohoTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
}

let cachedTokens: ZohoTokens | null = null

async function getZohoAccessToken(): Promise<string> {
  const now = Date.now()

  // Check if we have valid cached tokens
  if (cachedTokens && cachedTokens.expiresAt > now + 60000) {
    return cachedTokens.accessToken
  }

  const clientId = Deno.env.get('ZOHO_CLIENT_ID')
  const clientSecret = Deno.env.get('ZOHO_CLIENT_SECRET')
  const refreshToken = Deno.env.get('ZOHO_REFRESH_TOKEN')

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Missing Zoho OAuth credentials')
  }

  const response = await fetch('https://accounts.zoho.com/oauth/v2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Zoho token refresh failed: ${error}`)
  }

  const data = await response.json()

  cachedTokens = {
    accessToken: data.access_token,
    refreshToken: refreshToken,
    expiresAt: now + (data.expires_in * 1000),
  }

  return data.access_token
}

async function fetchReceiptFromZoho(
  expenseId: string
): Promise<{ blob: Blob; contentType: string; fileName: string } | null> {
  const accessToken = await getZohoAccessToken()
  const orgId = Deno.env.get('ZOHO_ORG_ID')

  if (!orgId) {
    throw new Error('Missing ZOHO_ORG_ID')
  }

  // First, get receipt metadata
  const metaResponse = await fetch(
    `https://www.zohoapis.com/expense/v1/organizations/${orgId}/expenses/${expenseId}/receipts`,
    {
      headers: {
        'Authorization': `Zoho-oauthtoken ${accessToken}`,
      },
    }
  )

  if (!metaResponse.ok) {
    console.error(`Failed to get receipt metadata: ${metaResponse.status}`)
    return null
  }

  const metaData = await metaResponse.json()
  const receipts = metaData.receipts || []

  if (receipts.length === 0) {
    console.log(`No receipts found for expense ${expenseId}`)
    return null
  }

  // Get the first receipt
  const receipt = receipts[0]
  const receiptId = receipt.receipt_id

  // Download the actual receipt file
  const downloadResponse = await fetch(
    `https://www.zohoapis.com/expense/v1/organizations/${orgId}/expenses/${expenseId}/receipts/${receiptId}`,
    {
      headers: {
        'Authorization': `Zoho-oauthtoken ${accessToken}`,
      },
    }
  )

  if (!downloadResponse.ok) {
    console.error(`Failed to download receipt: ${downloadResponse.status}`)
    return null
  }

  const contentType = downloadResponse.headers.get('content-type') || 'image/jpeg'
  const blob = await downloadResponse.blob()

  // Determine file extension from content type
  const extMap: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'application/pdf': 'pdf',
  }
  const ext = extMap[contentType] || 'jpg'
  const fileName = `${expenseId}.${ext}`

  return { blob, contentType, fileName }
}

async function uploadReceiptToStorage(
  supabase: any,
  blob: Blob,
  fileName: string,
  contentType: string
): Promise<string> {
  const storagePath = `receipts/${new Date().toISOString().slice(0, 7)}/${fileName}`

  const { error } = await supabase.storage
    .from('expense-receipts')
    .upload(storagePath, blob, {
      contentType,
      upsert: true,
    })

  if (error) {
    throw new Error(`Storage upload failed: ${error.message}`)
  }

  return storagePath
}

export async function fetchAndStoreReceipt(
  supabase: any,
  expenseId: string
): Promise<{ storagePath: string; contentType: string } | null> {
  try {
    const receipt = await fetchReceiptFromZoho(expenseId)

    if (!receipt) {
      return null
    }

    const storagePath = await uploadReceiptToStorage(
      supabase,
      receipt.blob,
      receipt.fileName,
      receipt.contentType
    )

    return {
      storagePath,
      contentType: receipt.contentType,
    }
  } catch (error) {
    console.error(`Error in fetchAndStoreReceipt: ${error}`)
    throw error
  }
}
// ========== END ZOHO RECEIPT FETCHER ==========
```

4. Deploy via Supabase Dashboard:
   - Go to Supabase Dashboard > Edge Functions
   - Select `receive-zoho-webhook`
   - Replace code with combined file
   - Deploy

5. **Verify environment variables are set:**
   - `ZOHO_CLIENT_ID`
   - `ZOHO_CLIENT_SECRET`
   - `ZOHO_REFRESH_TOKEN`
   - `ZOHO_ORG_ID`

---

### Fix 1.2: Fix Date Range Query Bug

**Problem:** Duplicate dictionary keys in Python cause only the second key to survive.

**Location:** `lambda/layers/common/python/utils/supabase_client.py:158-163`

**Current (BROKEN):**
```python
def get_unmatched_bank_transactions(
    self,
    source: str,
    start_date: str,
    end_date: str
) -> List[Dict]:
    params = {
        "status": "eq.unmatched",
        "source": f"eq.{source}",
        "transaction_date": f"gte.{start_date}",
        "transaction_date": f"lte.{end_date}",  # OVERWRITES PREVIOUS!
        "select": "id,transaction_date,description,amount,extracted_vendor,source",
        "order": "transaction_date.asc",
    }
    return self._query("bank_transactions", params)
```

**Fixed:**
```python
def get_unmatched_bank_transactions(
    self,
    source: str,
    start_date: str,
    end_date: str
) -> List[Dict]:
    # Use PostgREST 'and' filter for multiple conditions on same column
    params = {
        "status": "eq.unmatched",
        "source": f"eq.{source}",
        "and": f"(transaction_date.gte.{start_date},transaction_date.lte.{end_date})",
        "select": "id,transaction_date,description,amount,extracted_vendor,source",
        "order": "transaction_date.asc",
    }
    return self._query("bank_transactions", params)
```

---

### Fix 1.3: Improve QBO Vendor Name Escaping

**Problem:** Current escaping only handles ASCII apostrophes. Unicode variants cause SQL parse errors.

**Location:** `lambda/layers/common/python/utils/qbo_client.py:207-210`

**Current:**
```python
def _escape_vendor_name(self, name: str) -> str:
    return name.replace("'", "''")
```

**Fixed:**
```python
def _escape_vendor_name(self, name: str) -> str:
    """
    Escape vendor name for QBO SQL query.
    Handles ASCII and Unicode quote variants.
    """
    if not name:
        return name

    # Unicode quote variants that appear in vendor names
    quote_chars = [
        "'",   # ASCII apostrophe (U+0027)
        "'",   # Right single quotation mark (U+2019)
        "'",   # Left single quotation mark (U+2018)
        "`",   # Grave accent (U+0060)
        "´",   # Acute accent (U+00B4)
    ]

    # Replace all quote variants with escaped single quote
    result = name
    for char in quote_chars:
        result = result.replace(char, "''")

    return result
```

---

### Fix 1.4: Add Missing QBO Account Mappings

**Problem:** Category `Vehicle (Rent/Wash) - COS` has no QBO account mapping.

**Action:** Run this SQL in Supabase SQL Editor to find and add missing mappings:

```sql
-- Step 1: Find all categories missing mappings
SELECT DISTINCT
    ze.category_name,
    COUNT(*) as expense_count,
    SUM(ze.amount) as total_amount
FROM zoho_expenses ze
WHERE NOT EXISTS (
    SELECT 1 FROM qbo_accounts qa
    WHERE qa.zoho_category_match = ze.category_name
)
AND ze.category_name IS NOT NULL
GROUP BY ze.category_name
ORDER BY expense_count DESC;

-- Step 2: Add mapping for Vehicle (Rent/Wash) - COS
-- NOTE: Replace '???' with actual QBO account ID from your QBO Chart of Accounts
INSERT INTO qbo_accounts (
    name,
    qbo_id,
    account_type,
    zoho_category_match,
    is_cogs,
    created_at
) VALUES (
    'Vehicle Rent/Wash - COS',
    '???',  -- NEED ACTUAL QBO ACCOUNT ID
    'Expense',
    'Vehicle (Rent/Wash) - COS',
    true,
    NOW()
) ON CONFLICT (name) DO UPDATE SET
    zoho_category_match = EXCLUDED.zoho_category_match,
    is_cogs = EXCLUDED.is_cogs;

-- Step 3: Verify mapping exists
SELECT * FROM qbo_accounts
WHERE zoho_category_match LIKE '%Vehicle%';
```

---

## Phase 2: Architecture Improvements

### Fix 2.1: Add Pre-fetch Pattern to Lambda Handler

**Problem:** Lambda asks AI to fetch data via tools. n8n pre-fetches before AI (more efficient).

**Location:** `lambda/functions/process_expense/handler.py`

**Add this code AFTER expense data is loaded, BEFORE calling `run_expense_agent()`:**

```python
# ========== PRE-FETCH DATA (n8n Pattern) ==========

def pre_fetch_expense_data(expense: Dict, supabase: SupabaseClient) -> Dict:
    """
    Pre-fetch all data needed for expense processing.
    This mirrors the n8n workflow pattern where data is fetched
    BEFORE the AI agent, reducing tool calls and cost.
    """
    enriched = expense.copy()

    # 1. Generate signed URL for receipt
    if expense.get('receipt_storage_path'):
        try:
            signed_url = supabase.get_receipt_signed_url(
                expense['receipt_storage_path']
            )
            enriched['receipt_signed_url'] = signed_url
            logger.info(f"Generated signed URL for receipt")
        except Exception as e:
            logger.warning(f"Failed to generate signed URL: {e}")
            enriched['receipt_signed_url'] = None

    # 2. Get bank transaction candidates
    if expense.get('expense_date') and expense.get('paid_through'):
        try:
            from datetime import datetime, timedelta
            expense_date = datetime.fromisoformat(expense['expense_date'].replace('Z', '+00:00'))
            start_date = (expense_date - timedelta(days=3)).strftime('%Y-%m-%d')
            end_date = (expense_date + timedelta(days=3)).strftime('%Y-%m-%d')

            # Determine bank source from paid_through
            source = 'amex' if 'amex' in expense.get('paid_through', '').lower() else 'wells_fargo'

            candidates = supabase.get_unmatched_bank_transactions(
                source=source,
                start_date=start_date,
                end_date=end_date
            )
            enriched['bank_candidates'] = candidates[:10]  # Limit to top 10
            logger.info(f"Found {len(candidates)} bank transaction candidates")
        except Exception as e:
            logger.warning(f"Failed to fetch bank candidates: {e}")
            enriched['bank_candidates'] = []

    # 3. Get QBO account for category
    if expense.get('category_name'):
        try:
            qbo_account = supabase.get_qbo_account_for_category(
                expense['category_name']
            )
            enriched['qbo_expense_account'] = qbo_account
            logger.info(f"Found QBO account: {qbo_account.get('name') if qbo_account else 'None'}")
        except Exception as e:
            logger.warning(f"Failed to lookup QBO account: {e}")
            enriched['qbo_expense_account'] = None

    # 4. Get QBO class for state (if state_tag exists)
    if expense.get('state_tag'):
        enriched['qbo_class'] = supabase.get_qbo_class_for_state(
            expense['state_tag']
        )

    return enriched

# In process_expense() function:
# enriched_expense = pre_fetch_expense_data(expense, supabase)
# result = run_expense_agent(enriched_expense, retry_count)
```

---

### Fix 2.2: Update AI Prompt to Use Pre-fetched Data

**Location:** `lambda/functions/process_expense/prompts/expense_processor.py`

**Add these sections to the prompt when pre-fetched data is available:**

```python
def build_expense_prompt(expense: Dict, retry_count: int = 0) -> str:
    """Build the expense processing prompt with pre-fetched data."""

    base_prompt = f"""# Expense Processing Task

## Expense Details
- ID: {expense['id']}
- Vendor: {expense['vendor_name']}
- Amount: ${expense['amount']}
- Date: {expense['expense_date']}
- Category: {expense['category_name']}
- Paid Through: {expense.get('paid_through', 'Unknown')}
- State Tag: {expense.get('state_tag', 'None')}
"""

    # Add pre-fetched receipt info
    if expense.get('receipt_signed_url'):
        base_prompt += f"""
## Receipt (PRE-FETCHED)
- Signed URL: {expense['receipt_signed_url']}
- Content Type: {expense.get('receipt_content_type', 'image/jpeg')}
- STATUS: Ready for validate_receipt tool
"""

    # Add pre-fetched bank candidates
    if expense.get('bank_candidates'):
        candidates_text = "\n".join([
            f"  - ID: {c['id']}, Date: {c['transaction_date']}, Amount: ${c['amount']:.2f}, Vendor: {c.get('extracted_vendor', 'N/A')}"
            for c in expense['bank_candidates'][:5]
        ])
        base_prompt += f"""
## Bank Transaction Candidates (PRE-FETCHED)
Found {len(expense['bank_candidates'])} potential matches:
{candidates_text}
- Use match_bank_transaction tool with one of these IDs if amount matches
"""

    # Add pre-fetched QBO account
    if expense.get('qbo_expense_account'):
        acct = expense['qbo_expense_account']
        base_prompt += f"""
## QBO Expense Account (PRE-FETCHED)
- Name: {acct.get('name')}
- QBO ID: {acct.get('qbo_id')}
- Is COGS: {acct.get('is_cogs', False)}
"""

    # Add decision instructions
    base_prompt += """
## Your Task
1. Validate the receipt using the pre-fetched signed URL
2. Match to a bank transaction from the pre-fetched candidates
3. Determine the state (from tag, vendor rules, or Monday event)
4. If confidence >= 95%: Approve and create QBO Purchase
5. If confidence < 95% or issues found: Flag for human review

## Critical Rules
- DO NOT approve if receipt amount doesn't match expense amount (allow 15-25% tip variance)
- DO NOT approve if no bank transaction matches
- DO NOT guess the state - must have clear source
"""

    return base_prompt
```

---

## Phase 3: Testing & Validation

### Pre-Implementation Testing

Run these diagnostic queries BEFORE implementing fixes:

```sql
-- Current system health baseline
SELECT
    status,
    COUNT(*) as count,
    MAX(created_at) as latest
FROM zoho_expenses
GROUP BY status
ORDER BY count DESC;

-- Expenses that will be unblocked by receipt fix
SELECT COUNT(*) as will_be_unblocked
FROM zoho_expenses
WHERE receipt_storage_path IS NULL
AND status IN ('pending', 'error');
```

### Post-Implementation Testing

#### Test 1: Receipt Fetching

After deploying combined Edge Function:

1. Manually trigger a test webhook (use Postman or curl):
```bash
curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/receive-zoho-webhook \
  -H "Content-Type: application/json" \
  -H "apikey: YOUR_ANON_KEY" \
  -H "Authorization: Bearer YOUR_SERVICE_KEY" \
  -d '{
    "expense_report": {
      "report_id": "TEST001",
      "report_name": "Test Report",
      "expenses": [{
        "expense_id": "KNOWN_EXPENSE_ID",
        "date": "2025-12-31",
        "total": 50.00,
        "merchant_name": "Test Vendor",
        "category_name": "Meals"
      }]
    }
  }'
```

2. Verify in Supabase:
```sql
SELECT id, zoho_expense_id, receipt_storage_path, receipt_content_type
FROM zoho_expenses
WHERE zoho_expense_id = 'KNOWN_EXPENSE_ID';
```

#### Test 2: Date Range Query

After fixing supabase_client.py:

```python
# Test the fix
from utils.supabase_client import SupabaseClient

client = SupabaseClient()
results = client.get_unmatched_bank_transactions(
    source='amex',
    start_date='2025-12-01',
    end_date='2025-12-31'
)

print(f"Found {len(results)} transactions")
# Should return transactions between Dec 1-31, not just <= Dec 31
```

#### Test 3: QBO Vendor Escaping

```python
# Test vendor escaping
from utils.qbo_client import QBOClient

client = QBOClient()

test_vendors = [
    "Peet's Coffee",
    "Love's Travel Stop",
    "Buc-ee's",
    "Coach's Sports Bar & Grill",
    "Test'Vendor",  # Multiple quotes
]

for vendor in test_vendors:
    escaped = client._escape_vendor_name(vendor)
    print(f"{vendor} -> {escaped}")

    # This should NOT throw SQL parse error
    result = client.lookup_vendor(vendor)
    print(f"  Lookup result: {result}")
```

---

## Deployment Checklist

### Before Deployment

- [ ] Backup current Edge Function code
- [ ] Note current `processing_errors` count for comparison
- [ ] Run baseline diagnostic queries
- [ ] Verify Zoho OAuth credentials are valid

### Edge Function Deployment

- [ ] Combine zoho-receipt-fetcher.ts into index.ts
- [ ] Deploy via Supabase Dashboard
- [ ] Verify function appears in Edge Functions list
- [ ] Check logs for any startup errors

### Lambda Deployment

- [ ] Update supabase_client.py with date range fix
- [ ] Update qbo_client.py with improved escaping
- [ ] Run `sam build`
- [ ] Run `sam deploy` (or via GitHub Actions)
- [ ] Verify Lambda appears in AWS Console
- [ ] Check CloudWatch for any errors

### Database Updates

- [ ] Run QBO account mapping SQL
- [ ] Verify mapping exists with SELECT query
- [ ] Add any other missing category mappings

### Post-Deployment Verification

- [ ] Trigger test webhook
- [ ] Verify receipt_storage_path is populated
- [ ] Check Lambda CloudWatch logs
- [ ] Run diagnostic queries to compare error counts
- [ ] Process a real pending expense end-to-end

---

## Rollback Plan

### If Edge Function Fails

1. Go to Supabase Dashboard > Edge Functions
2. Replace with previous version (keep backup!)
3. Deploy immediately

### If Lambda Fails

1. In AWS Console > Lambda > ProcessExpenseFunction
2. Use "Versions" tab to deploy previous version
3. Or: `sam deploy` with previous code from git

### If Database Changes Cause Issues

```sql
-- Remove problematic QBO account mapping
DELETE FROM qbo_accounts
WHERE zoho_category_match = 'Vehicle (Rent/Wash) - COS';
```

---

## Timeline Estimate

| Phase | Tasks | Duration |
|-------|-------|----------|
| Phase 1 | Critical fixes (Edge Function, date bug, escaping, mappings) | 1-2 days |
| Phase 2 | Pre-fetch pattern implementation | 2-3 days |
| Phase 3 | Testing & validation | 1-2 days |
| Go-Live | Disable n8n, monitor Lambda | 1 day |

**Total: ~1 week for complete migration**

---

## Questions Requiring User Input

Before proceeding with implementation, please confirm:

1. **QBO Account ID for Vehicle (Rent/Wash) - COS** - What is the actual QBO account ID?

2. **Test Expense ID** - Is there a known Zoho expense ID we can use for end-to-end testing?

3. **n8n Cutover** - Should we disable n8n workflows after Lambda is verified working, or run both in parallel?

4. **CloudWatch Access** - Can you provide AWS Console access to verify Lambda execution?

5. **Zoho OAuth** - Are the Zoho OAuth credentials (`ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_ORG_ID`) set in Supabase Edge Function secrets?

---

*End of Migration & Fix Plan*
