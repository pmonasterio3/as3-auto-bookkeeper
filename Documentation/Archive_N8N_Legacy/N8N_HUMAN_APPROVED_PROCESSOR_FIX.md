# Human Approved Processor V1.0 - Query Vendor Fix

**Date:** December 28, 2025
**Status:** FIXED
**Affected Workflow:** Human Approved Processor V1.0
**Root Cause:** Copy-paste error from Agent 1 workflow

---

## Problem Summary

The Human Approved Processor workflow was failing with QBO API errors when trying to query vendors:

```
Error parsing query
QueryParserError: Encountered " "=" "= "" at line 1, column 1.
Was expecting: "select" ...
```

And also:
```
Referenced node doesn't exist
```

---

## Root Cause Analysis

The **Query Vendor** node in Human Approved Processor was incorrectly configured with references to a node that only exists in Agent 1 - Queue Based v3.0.

### The Broken Configuration

```javascript
// Query Vendor node - query parameter (BROKEN)
"==SELECT * FROM Vendor WHERE DisplayName = '{{ $('Parse AI Decision').first().json.merchant_name_for_qbo.replace(/[''\\']/g, \"''\") }}'"
```

### Three Bugs Identified

| Bug | Problem | Impact |
|-----|---------|--------|
| `==SELECT` | Double equals prefix | Sent literally as `== SELECT...` to QBO API causing parse error |
| `$('Parse AI Decision')` | Node doesn't exist in Human Approved Processor | "Referenced node doesn't exist" error |
| `merchant_name_for_qbo` | Field doesn't exist in Edit Fields node | Would return undefined |

---

## Workflow Architecture Difference

### Agent 1 - Queue Based v3.0
```
Webhook → Fetch Expense → Edit Fields → ... → AI Agent → Parse AI Decision → Query Vendor
                                                              ↑
                                              This node EXISTS and has merchant_name_for_qbo
```

### Human Approved Processor V1.0
```
Webhook → Edit Fields → Lookup QBO Accounts → ... → Query Vendor
              ↑
              Has vendor_clean field, NO Parse AI Decision node
```

The Human Approved Processor receives pre-approved expenses from the Review Queue UI. It doesn't need AI analysis - the human already approved it. Therefore, it has no "Parse AI Decision" node.

---

## The Fix

### Query Vendor Node - Correct Configuration

**Change the query parameter from:**
```
==SELECT * FROM Vendor WHERE DisplayName = '{{ $('Parse AI Decision').first().json.merchant_name_for_qbo.replace(/[''\\']/g, "''") }}'
```

**To:**
```
=SELECT * FROM Vendor WHERE DisplayName LIKE '%{{ $('Edit Fields').first().json.vendor_clean.replace(/['"\\']/g, '') }}%'
```

### Why Each Change Matters

| Change | Before | After | Reason |
|--------|--------|-------|--------|
| Prefix | `==` | `=` | Single `=` makes n8n evaluate as expression |
| Node reference | `$('Parse AI Decision')` | `$('Edit Fields')` | References node that actually exists |
| Field | `merchant_name_for_qbo` | `vendor_clean` | Field that Edit Fields extracts from webhook |
| Match type | `= '...'` | `LIKE '%...%'` | Fuzzy matching (more forgiving for vendor names) |
| Escaping | `.replace(/[''\\']/g, "''")` | `.replace(/['"\\']/g, '')` | Strips quotes entirely instead of escaping |

---

## Step-by-Step Fix in n8n

1. Open **Human Approved Processor V1.0** workflow in n8n
2. Click the **Query Vendor** node
3. Go to **Query Parameters** section
4. Find the parameter named `query`
5. Replace the entire value with:
   ```
   =SELECT * FROM Vendor WHERE DisplayName LIKE '%{{ $('Edit Fields').first().json.vendor_clean.replace(/['"\\']/g, '') }}%'
   ```
6. Click **Save** to save the workflow
7. Test by approving a flagged expense from the Review Queue

---

## Verification

After applying the fix, test with these expenses that were reset to `flagged`:

| Merchant | Amount | Expense ID |
|----------|--------|------------|
| Apro LLC | $88.84 | b7632e31-5f94-4539-adcb-72c69539bde6 |
| Chevron | $80.47 | 3404f806-809f-46d2-803b-e9183cd4f3b8 |

Expected result: Expenses should post to QBO successfully without vendor query errors.

---

## Prevention

### When Copying Nodes Between Workflows

1. **Always verify node references** - Check that `$('NodeName')` references exist in the target workflow
2. **Check field names** - Different workflows may have different field structures
3. **Test after copying** - Run a test execution before deploying

### Workflow-Specific Data Sources

| Workflow | Vendor Name Source | Why |
|----------|-------------------|-----|
| Agent 1 - Queue Based v3.0 | `$('Parse AI Decision').first().json.merchant_name_for_qbo` | AI cleans and validates merchant name |
| Human Approved Processor V1.0 | `$('Edit Fields').first().json.vendor_clean` | Webhook provides pre-cleaned vendor |

---

## Related Documentation

- `N8N_BANK_TRANSACTION_FIX.md` - Parse AI Decision node fixes in Agent 1
- `QBO_LIVE_IMPLEMENTATION.md` - QBO API integration patterns
- `CLAUDE.md` - Project conventions and recent changes

---

## Lesson Learned

**When maintaining parallel workflows that share similar logic (Agent 1 and Human Approved Processor), always verify that node references are workflow-specific.** The two workflows have different data flow:

- **Agent 1**: Automated processing with AI decision-making
- **Human Approved Processor**: Manual approval bypass without AI

Each workflow must reference its own nodes, not copy references from the other workflow verbatim.
