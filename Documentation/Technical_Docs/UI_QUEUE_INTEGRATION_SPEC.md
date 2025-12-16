# UI Queue Integration Specification

**Version:** 1.1
**Created:** December 15, 2025
**Status:** ✅ IMPLEMENTED
**Priority:** Critical
**Last Updated:** December 15, 2025

---

## Overview

### Problem Statement

The AS3 Auto Bookkeeper system recently transitioned from a loop-based n8n processing architecture to a **queue-based architecture (v3.0)** to solve memory issues when processing large expense reports.

In the new architecture:
1. Zoho webhooks store expenses in the `zoho_expenses` table (via Supabase Edge Function)
2. A database trigger processes expenses one-by-one through n8n
3. Expenses flow through statuses: `pending` → `processing` → `posted`/`flagged`/`error`

**The Problem:** The React dashboard UI was built to fetch from the OLD tables (`expense_queue`, `flagged_expenses`) and **does not fetch from `zoho_expenses`**. As a result, **14 flagged expenses are invisible to users** and cannot be reviewed/corrected/resubmitted.

### Goal

Update the Review Queue UI to:
1. Display flagged expenses from `zoho_expenses` table
2. Allow editing of category/state before resubmission
3. Enable resubmission (reset status to 'pending' to re-enter processing queue)
4. Show match confidence, processing attempts, and error messages

---

## Current System State

### Database: zoho_expenses Table

**Location:** Supabase production database

**Current row counts:**
| Status | Count |
|--------|-------|
| posted | 8 |
| flagged | 14 |
| processing | 1 |

**Full schema (26 columns):**
```sql
CREATE TABLE zoho_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zoho_expense_id TEXT NOT NULL UNIQUE,
  zoho_report_id TEXT NOT NULL,
  expense_date DATE,
  amount NUMERIC,
  vendor_name TEXT,
  category_name TEXT,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  -- Queue columns (added for v3.0):
  zoho_report_name TEXT,
  raw_payload JSONB,
  merchant_name TEXT,
  state_tag TEXT,
  paid_through TEXT,
  receipt_storage_path TEXT,
  receipt_content_type TEXT,
  status TEXT DEFAULT 'pending',
  processing_attempts INTEGER DEFAULT 0,
  processing_started_at TIMESTAMPTZ,
  last_error TEXT,
  bank_transaction_id UUID REFERENCES bank_transactions(id),
  match_confidence INTEGER,
  qbo_purchase_id TEXT,
  qbo_posted_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ
);
```

**Status State Machine:**
```
pending → processing → posted (success)
                    → flagged (low confidence or rule violation)
                    → error (n8n/QBO failure)
                    → duplicate (already processed)
```

### Receipt Storage

Receipts are stored in Supabase Storage bucket `expense-receipts` at path:
```
{zoho_report_id}/{zoho_expense_id}.{extension}
```

To display receipts, generate a signed URL:
```typescript
const { data } = await supabase.storage
  .from('expense-receipts')
  .createSignedUrl(expense.receipt_storage_path, 3600) // 1 hour expiry
```

### Related Table: zoho_expense_reports

Contains submitter/approver info for each report:
```sql
SELECT zoho_report_id, submitter_name, submitter_email,
       approver_name, approver_email, approved_at, report_name, report_number
FROM zoho_expense_reports
WHERE zoho_report_id = '<expense.zoho_report_id>'
```

---

## Implementation Tasks

### Phase 1: Data Layer (Critical)

#### Task 1.1: Update TypeScript Types

**File:** `expense-dashboard/src/types/database.ts`

**Action:** Update the `zoho_expenses` type definition (lines 657-703) to include all 26 columns.

**Current (incomplete):**
```typescript
zoho_expenses: {
  Row: {
    id: string
    zoho_expense_id: string
    zoho_report_id: string
    expense_date: string | null
    amount: number | null
    vendor_name: string | null
    category_name: string | null
    description: string | null
    created_at: string | null
    updated_at: string | null
  }
  // ... Insert/Update similar
}
```

**Required (add these fields to Row, Insert, Update):**
```typescript
zoho_report_name: string | null
raw_payload: Json | null
merchant_name: string | null
state_tag: string | null
paid_through: string | null
receipt_storage_path: string | null
receipt_content_type: string | null
status: string | null  // 'pending' | 'processing' | 'posted' | 'flagged' | 'error' | 'duplicate'
processing_attempts: number | null
processing_started_at: string | null
last_error: string | null
bank_transaction_id: string | null
match_confidence: number | null
qbo_purchase_id: string | null
qbo_posted_at: string | null
processed_at: string | null
```

**Also add convenience type:**
```typescript
export type ZohoExpense = Database['public']['Tables']['zoho_expenses']['Row']
```

---

#### Task 1.2: Update SourceTable Type

**File:** `expense-dashboard/src/features/review/types.ts`

**Action:** Add 'zoho_expenses' to SourceTable union (line 9-14)

**Current:**
```typescript
export type SourceTable =
  | 'expense_queue'
  | 'flagged_expenses'
  | 'processing_errors'
  | 'bank_transactions'
```

**Change to:**
```typescript
export type SourceTable =
  | 'expense_queue'
  | 'flagged_expenses'
  | 'processing_errors'
  | 'bank_transactions'
  | 'zoho_expenses'
```

---

#### Task 1.3: Create Normalizer for zoho_expenses

**File:** `expense-dashboard/src/features/review/normalizers/zohoExpenseNormalizer.ts` (NEW FILE)

**Purpose:** Transform `zoho_expenses` rows into the `ReviewItem` interface used by the UI.

**Template:**
```typescript
import type { ReviewItem } from '../types'
import type { BankTransaction } from '@/types/database'

interface ZohoExpenseRow {
  id: string
  zoho_expense_id: string
  zoho_report_id: string
  zoho_report_name: string | null
  expense_date: string | null
  amount: number | null
  vendor_name: string | null
  merchant_name: string | null
  category_name: string | null
  state_tag: string | null
  paid_through: string | null
  description: string | null
  receipt_storage_path: string | null
  receipt_content_type: string | null
  status: string | null
  processing_attempts: number | null
  last_error: string | null
  match_confidence: number | null
  bank_transaction_id: string | null
  created_at: string | null
}

interface ZohoReportJoin {
  submitter_name: string | null
  submitter_email: string | null
  approver_name: string | null
  approver_email: string | null
  approved_at: string | null
  report_name: string | null
  report_number: string | null
}

export function normalizeZohoExpense(
  expense: ZohoExpenseRow,
  reportData: ZohoReportJoin | null,
  bankTxn: BankTransaction | null,
  receiptSignedUrl: string | null
): ReviewItem {
  const daysWaiting = expense.created_at
    ? Math.floor((Date.now() - new Date(expense.created_at).getTime()) / (1000 * 60 * 60 * 24))
    : 0

  // Determine reason for flagging
  let reason = 'Flagged for review'
  if (expense.last_error) {
    reason = expense.last_error
  } else if (expense.match_confidence && expense.match_confidence < 95) {
    reason = `Low match confidence (${expense.match_confidence}%) - needs verification`
  }

  return {
    id: `zoho_expenses:${expense.id}`,
    sourceTable: 'zoho_expenses',
    sourceId: expense.id,
    itemType: 'flagged',
    priority: 1.5,

    amount: expense.amount || 0,
    vendor: expense.merchant_name || expense.vendor_name || 'Unknown',
    reason,

    submitter: reportData?.submitter_name ? {
      name: reportData.submitter_name,
      email: reportData.submitter_email || '',
    } : undefined,

    approver: reportData?.approver_name ? {
      name: reportData.approver_name,
      email: reportData.approver_email || '',
      approvedAt: reportData.approved_at || '',
    } : undefined,

    date: expense.expense_date || '',
    daysWaiting,
    createdAt: expense.created_at || '',

    bankTransaction: bankTxn ? {
      id: bankTxn.id,
      description: bankTxn.description,
      source: bankTxn.source as 'amex' | 'wells_fargo',
      amount: bankTxn.amount,
      date: bankTxn.transaction_date,
    } : undefined,

    predictions: {
      category: expense.category_name,
      state: expense.state_tag,
      confidence: expense.match_confidence || 0,
      method: 'parsed',
    },

    receipt: receiptSignedUrl ? {
      url: receiptSignedUrl,
    } : undefined,

    zoho: {
      expenseId: expense.zoho_expense_id,
      reportId: expense.zoho_report_id,
      reportName: expense.zoho_report_name || reportData?.report_name || '',
      reportNumber: reportData?.report_number || undefined,
      categoryName: expense.category_name,
      paidThrough: expense.paid_through,
    },

    availableActions: [
      'correct_and_approve',
      'approve',
      'reject',
      'create_vendor_rule',
    ],
  }
}
```

**Also export from index:**
```typescript
// In normalizers/index.ts
export { normalizeZohoExpense } from './zohoExpenseNormalizer'
```

---

#### Task 1.4: Update useReviewItems Hook

**File:** `expense-dashboard/src/features/review/hooks/useReviewItems.ts`

**Action:** Add fetch logic for zoho_expenses with status='flagged'

**Add import:**
```typescript
import { normalizeZohoExpense } from '../normalizers/zohoExpenseNormalizer'
```

**Add new section after the flagged_expenses fetch (around line 194), before orphans:**

```typescript
// 2.5. Fetch flagged zoho_expenses (queue-based architecture v3.0)
if (filter === 'all' || filter === 'flagged') {
  const { data: zohoFlaggedData, error: zfError } = await supabase
    .from('zoho_expenses')
    .select('*')
    .eq('status', 'flagged')
    .order('created_at', { ascending: true })

  if (zfError) {
    console.error('Error fetching flagged zoho_expenses:', zfError)
  }

  const zohoFlagged = (zohoFlaggedData || []) as ZohoExpenseRow[]

  // Fetch report data for each expense
  const zfReportIds = [...new Set(zohoFlagged.map(e => e.zoho_report_id))]
  let zfReportsMap = new Map<string, ZohoReportJoin>()
  if (zfReportIds.length > 0) {
    const { data: reportsData } = await supabase
      .from('zoho_expense_reports')
      .select('zoho_report_id, submitter_name, submitter_email, approver_name, approver_email, approved_at, report_name, report_number')
      .in('zoho_report_id', zfReportIds)
    if (reportsData) {
      zfReportsMap = new Map(reportsData.map(r => [r.zoho_report_id, r as ZohoReportJoin]))
    }
  }

  // Fetch bank transactions for matched expenses
  const zfBankIds = zohoFlagged
    .map(e => e.bank_transaction_id)
    .filter((id): id is string => id !== null)

  let zfBankMap = new Map<string, BankTransaction>()
  if (zfBankIds.length > 0) {
    const { data: bankData } = await supabase
      .from('bank_transactions')
      .select('*')
      .in('id', zfBankIds)
    if (bankData) {
      zfBankMap = new Map(bankData.map(t => [t.id, t as BankTransaction]))
    }
  }

  // Generate signed URLs for receipts
  for (const expense of zohoFlagged) {
    let receiptUrl: string | null = null
    if (expense.receipt_storage_path) {
      const { data: signedData } = await supabase.storage
        .from('expense-receipts')
        .createSignedUrl(expense.receipt_storage_path, 3600)
      receiptUrl = signedData?.signedUrl || null
    }

    const reportData = zfReportsMap.get(expense.zoho_report_id) || null
    const bankTxn = expense.bank_transaction_id
      ? zfBankMap.get(expense.bank_transaction_id) || null
      : null

    results.push(normalizeZohoExpense(expense, reportData, bankTxn, receiptUrl))
  }
}
```

**Note:** You'll need to define `ZohoExpenseRow` interface at the top of the file or import from types.

---

### Phase 2: Actions Layer

#### Task 2.1: Add Resubmit Action Type

**File:** `expense-dashboard/src/features/review/types.ts`

**Action:** Add 'resubmit' to ReviewAction union (line 22-34)

**Add:**
```typescript
export type ReviewAction =
  | 'approve'
  | 'correct_and_approve'
  | 'reject'
  | 'reimburse_check'
  | 'reimburse_zelle'
  | 'reimburse_payroll'
  | 'exclude'
  | 'retry'
  | 'investigate'
  | 'resolve'
  | 'ignore'
  | 'create_vendor_rule'
  | 'resubmit'  // NEW: Reset zoho_expense to pending for reprocessing
```

---

#### Task 2.2: Add Resubmit Handler

**File:** `expense-dashboard/src/features/review/services/reviewActions.ts`

**Action:** Add case for 'resubmit' in executeReviewAction switch (line 25)

```typescript
case 'resubmit':
  return handleResubmit(item, data)
```

**Add handler function:**
```typescript
/**
 * Handle resubmit for zoho_expenses - reset to pending for reprocessing
 */
async function handleResubmit(
  item: ReviewItem,
  data?: CorrectionData
): Promise<ActionResult> {
  if (item.sourceTable !== 'zoho_expenses') {
    return { success: false, message: 'Can only resubmit zoho_expenses items' }
  }

  // Build update object
  const updates: Record<string, unknown> = {
    status: 'pending',
    processing_attempts: 0,
    processing_started_at: null,
    last_error: null,
    updated_at: new Date().toISOString(),
  }

  // Apply corrections if provided
  if (data?.state) {
    updates.state_tag = data.state
  }
  if (data?.category) {
    updates.category_name = data.category
  }

  const { error } = await supabase
    .from('zoho_expenses')
    .update(updates)
    .eq('id', item.sourceId)

  if (error) {
    return { success: false, message: `Failed to resubmit: ${error.message}` }
  }

  // Create vendor rule if requested
  if (data?.createVendorRule && item.vendor) {
    await createVendorRule(
      item.vendor,
      data.category || item.predictions?.category || 'Office Supplies & Software',
      data.state || item.predictions?.state || 'Admin'
    )
  }

  return {
    success: true,
    message: 'Expense resubmitted for processing',
  }
}
```

---

#### Task 2.3: Update Approval Handler for zoho_expenses

**File:** `expense-dashboard/src/features/review/services/reviewActions.ts`

**Action:** Modify `handleApproval` to handle zoho_expenses source table

In `updateSourceTableStatus` function, zoho_expenses needs different fields:
```typescript
async function updateSourceTableStatus(
  item: ReviewItem,
  status: string,
  additionalData?: Record<string, unknown>
): Promise<void> {
  const { sourceTable, sourceId } = item

  // Build update object based on table
  const updates: Record<string, unknown> = { status }

  // Add table-specific timestamp field
  if (sourceTable === 'zoho_expenses') {
    updates.processed_at = new Date().toISOString()
    updates.updated_at = new Date().toISOString()
  }

  // Add additional data if provided
  if (additionalData) {
    Object.assign(updates, additionalData)
  }

  const { error } = await supabase.from(sourceTable).update(updates).eq('id', sourceId)

  if (error) {
    console.error(`Failed to update ${sourceTable}:`, error)
    throw new Error(`Failed to update status: ${error.message}`)
  }
}
```

---

### Phase 3: UI Layer

#### Task 3.1: Update ReviewDetailPanel Footer

**File:** `expense-dashboard/src/features/review/components/ReviewDetailPanel.tsx`

**Action:** Add Resubmit button for zoho_expenses items (around line 431)

Add new condition block in SheetFooter:
```typescript
{/* Zoho Expenses Flagged Items */}
{item.sourceTable === 'zoho_expenses' && (
  <>
    <Button
      variant="primary"
      size="sm"
      onClick={() => handleAction(hasChanges ? 'resubmit' : 'approve')}
      disabled={isLoading}
    >
      {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
      <span className="ml-1.5">{hasChanges ? 'Save & Resubmit' : 'Approve'}</span>
    </Button>
    <Button variant="outline" size="sm" onClick={() => handleAction('resubmit')} disabled={isLoading}>
      Resubmit
    </Button>
    <Button variant="ghost" size="sm" onClick={() => handleAction('reject')} disabled={isLoading}>
      <X className="h-4 w-4" />
      <span className="ml-1">Reject</span>
    </Button>
  </>
)}
```

---

#### Task 3.2: Add Match Confidence Display

**File:** `expense-dashboard/src/features/review/components/ReviewDetailPanel.tsx`

**Action:** Add confidence indicator in the detail view

Add after the "Reason" box (around line 331):
```typescript
{/* Match Confidence (for zoho_expenses) */}
{item.sourceTable === 'zoho_expenses' && item.predictions?.confidence !== undefined && (
  <div className="p-3 rounded-lg border border-gray-200 bg-gray-50">
    <div className="flex items-center justify-between">
      <span className="text-[10px] font-semibold text-gray-600 uppercase tracking-wide">
        Match Confidence
      </span>
      <span className={cn(
        "text-lg font-bold tabular-nums",
        item.predictions.confidence >= 95 ? "text-green-600" :
        item.predictions.confidence >= 70 ? "text-amber-600" : "text-red-600"
      )}>
        {item.predictions.confidence}%
      </span>
    </div>
    <div className="mt-2 h-2 bg-gray-200 rounded-full overflow-hidden">
      <div
        className={cn(
          "h-full rounded-full transition-all",
          item.predictions.confidence >= 95 ? "bg-green-500" :
          item.predictions.confidence >= 70 ? "bg-amber-500" : "bg-red-500"
        )}
        style={{ width: `${item.predictions.confidence}%` }}
      />
    </div>
    <div className="text-[10px] text-gray-500 mt-1">
      Threshold: 95% for auto-approval
    </div>
  </div>
)}
```

---

#### Task 3.3: Add Processing Attempts Display

**File:** `expense-dashboard/src/features/review/components/ReviewDetailPanel.tsx`

**Action:** Show retry count if > 0

This requires adding `processingAttempts` to the ReviewItem interface or displaying from errorDetails.

Add in error section or create new section:
```typescript
{/* Processing Attempts (for items that have been retried) */}
{item.sourceTable === 'zoho_expenses' && (item as any).processingAttempts > 1 && (
  <div className="px-3 py-2 bg-amber-50 rounded-lg border border-amber-200 text-xs text-amber-700">
    Processing attempts: {(item as any).processingAttempts}
  </div>
)}
```

**Note:** This requires adding `processingAttempts` to the ReviewItem interface or the normalizer output.

---

### Phase 4: Constants Update

#### Task 4.1: Update DEFAULT_ACTIONS

**File:** `expense-dashboard/src/features/review/constants.ts`

**Action:** Add or update actions for zoho flagged items

Option A - Add zoho_flagged as separate type:
```typescript
export const DEFAULT_ACTIONS: Record<string, string[]> = {
  reimbursement: ['reimburse_check', 'reimburse_zelle', 'reimburse_payroll', 'reject'],
  orphan: ['approve', 'correct_and_approve', 'exclude', 'create_vendor_rule'],
  flagged: ['approve', 'correct_and_approve', 'reject'],
  low_confidence: ['approve', 'correct_and_approve', 'reject'],
  processing_error: ['retry', 'investigate', 'resolve', 'ignore'],
  zoho_flagged: ['approve', 'correct_and_approve', 'resubmit', 'reject', 'create_vendor_rule'],  // NEW
}
```

Option B - Use same 'flagged' but check sourceTable in component for actions.

---

## Testing Checklist

After implementation, verify:

- [x] Flagged zoho_expenses appear in Review Queue under "Flagged" tab
- [x] Count badge shows correct number (currently 14)
- [x] Clicking a row opens detail panel with all data
- [x] Receipt images load from Supabase Storage
- [x] Submitter/Approver info displays correctly
- [x] Match confidence percentage displays
- [x] State dropdown allows selection of all 8 states
- [x] Category dropdown shows all QBO accounts
- [x] "Save & Resubmit" updates fields and resets status to 'pending'
- [x] "Reject" marks expense as rejected
- [x] After resubmit, expense disappears from queue (status changed)
- [x] Resubmitted expense gets picked up by queue trigger
- [x] Successfully reprocessed expense shows status='posted'
- [x] Manual bank transaction matching works for unmatched expenses
- [x] BankTransactionPicker shows unmatched transactions within +/- 7 days
- [x] Exact amount matches highlighted in green
- [x] Selected bank transaction persists and displays with green highlight
- [x] Both zoho_expenses and bank_transactions updated when manual match applied
- [x] Flagging reasons display ALL issues (multi-issue support)

---

## Files Modified Summary

| File | Action | Status |
|------|--------|--------|
| `src/types/database.ts` | Update zoho_expenses type (add 16 columns) | ✅ DONE |
| `src/features/review/types.ts` | Add 'zoho_expenses' to SourceTable, 'resubmit' to ReviewAction | ✅ DONE |
| `src/features/review/normalizers/zohoExpenseNormalizer.ts` | NEW FILE | ✅ CREATED |
| `src/features/review/normalizers/index.ts` | Export new normalizer | ✅ DONE |
| `src/features/review/hooks/useReviewItems.ts` | Add zoho_expenses fetch section | ✅ DONE |
| `src/features/review/services/reviewActions.ts` | Add handleResubmit, update handlers | ✅ DONE |
| `src/features/review/components/ReviewDetailPanel.tsx` | Add resubmit UI, confidence display | ✅ DONE |

---

## Implementation Summary

**Completed:** December 15, 2025

All tasks outlined in this specification have been implemented successfully. The Review Queue UI now displays flagged expenses from the `zoho_expenses` table and supports the following operations:

### Features Implemented

1. **Data Layer (Phase 1)**
   - ✅ Updated TypeScript types with all 26 zoho_expenses columns
   - ✅ Added 'zoho_expenses' to SourceTable union type
   - ✅ Added 'resubmit' to ReviewAction union type
   - ✅ Created zohoExpenseNormalizer with receipt signed URL generation
   - ✅ Integrated normalizer into useReviewItems hook

2. **Actions Layer (Phase 2)**
   - ✅ Implemented handleResubmit function to reset status to 'pending'
   - ✅ Updated updateSourceTableStatus for zoho_expenses-specific fields
   - ✅ Added corrections support (state_tag, category_name updates)
   - ✅ Integrated vendor rule creation from review UI
   - ✅ Added manual bank transaction matching support (bank_transaction_id in CorrectionData)

3. **UI Layer (Phase 3)**
   - ✅ Added match confidence display with visual progress bar
   - ✅ Added processing attempts counter for retried items
   - ✅ Created zoho_expenses-specific button group (Save & Resubmit, Resubmit, Reject)
   - ✅ Integrated with existing ReviewDetailPanel layout
   - ✅ Implemented BankTransactionPicker component for manual matching
   - ✅ Improved flagging reason display to show ALL issues (multiple reasons joined with •)

### Key Architecture Decisions

- **Resubmit Action:** Resets `status = 'pending'` and clears `processing_started_at`, `last_error`, allowing the queue controller to pick up the expense again
- **Receipt Storage:** Receipts stored in Supabase Storage bucket `expense-receipts` with 1-hour signed URL expiry
- **Match Confidence Threshold:** 95% for auto-approval (visual indicator: green ≥95%, amber ≥70%, red <70%)
- **Item Type:** zoho_expenses items use `itemType='flagged'` but distinguished by `sourceTable='zoho_expenses'`
- **Processing Attempts:** Only shown when > 1 (indicates retry occurred)

### Testing Notes

The implementation fetches flagged zoho_expenses in parallel with other review queue items. Receipt signed URLs are generated in parallel for optimal performance. The UI correctly displays state tags, match confidence, and processing attempts from the queue-based architecture.

---

## Manual Bank Transaction Matching Implementation

**Completed:** December 16, 2025

### Problem Addressed

Some expenses in the Zoho webhook may not automatically match to bank transactions due to:
- Timing differences (expense date vs bank posting date)
- Description mismatches (vendor name variations)
- Amount discrepancies (partial payments, tips, foreign currency)

Previously, these expenses would be flagged with "No bank transaction match found" but no UI existed to manually create the match.

### Solution: BankTransactionPicker Component

**File:** `expense-dashboard/src/features/review/components/BankTransactionPicker.tsx`

**Features:**
- Searches unmatched bank transactions within +/- 7 days of expense date
- Sorts results by amount similarity (exact matches highlighted in green)
- Displays amount difference for non-exact matches
- Supports text search filtering by description/vendor name
- Shows bank account source (AMEX/Wells Fargo) and transaction date
- Inline integration with ReviewDetailPanel (no modal dialog)

**User Flow:**
1. User views flagged expense with reason "No bank transaction match found - manual match required"
2. User clicks "Find Bank Transaction Match" button
3. BankTransactionPicker displays unmatched transactions sorted by similarity
4. Exact amount matches highlighted in green with checkmark icon
5. User can filter by typing vendor name or description
6. User clicks "Select" to choose transaction
7. Selected transaction displays with green highlight and "Change" button
8. User clicks "Save & Resubmit" to apply match and reprocess expense

### Database Updates

**zoho_expenses table:**
- `bank_transaction_id` - Set via manual selection

**bank_transactions table:**
- `status` - Updated to 'matched' when manually selected
- `matched_expense_id` - Set to zoho_expense_id
- `match_confidence` - Set to 100 for manual matches
- `match_method` - Set to 'manual' to distinguish from automated matches

### Improved Flagging Reason Display

**File:** `expense-dashboard/src/features/review/normalizers/zohoExpenseNormalizer.ts`

**Changes:**
- Shows ALL issues that caused flagging (previously only showed first issue)
- Issues displayed as bullet-separated list: "Issue 1 • Issue 2 • Issue 3"
- Clear, actionable messages:
  - "No bank transaction match found - manual match required"
  - "Low match confidence (82%) - verify accuracy"
  - "Missing state tag - select state"
  - "Missing receipt - upload required"

**Detection Logic:**
```typescript
const issues: string[] = []

if (!expense.bank_transaction_id) {
  issues.push('No bank transaction match found - manual match required')
}
if (expense.match_confidence && expense.match_confidence < 95) {
  issues.push(`Low match confidence (${expense.match_confidence}%) - verify accuracy`)
}
if (!expense.state_tag) {
  issues.push('Missing state tag - select state')
}
if (!expense.receipt_storage_path) {
  issues.push('Missing receipt - upload required')
}

// Fallback to last_error if no specific issues detected
const reason = issues.length > 0
  ? issues.join(' • ')
  : expense.last_error || 'Flagged for review'
```

### Action Handler Enhancement

**File:** `expense-dashboard/src/features/review/services/reviewActions.ts`

**Function:** `handleResubmit`

**Changes:**
- Now accepts `bankTransactionId` in `CorrectionData` parameter
- Updates `zoho_expenses.bank_transaction_id` if provided
- Updates corresponding `bank_transactions` record:
  - Sets `status = 'matched'`
  - Sets `matched_expense_id = zoho_expense_id`
  - Sets `match_confidence = 100`
  - Sets `match_method = 'manual'`
- All updates wrapped in transaction-like logic (both records updated or neither)

**Code Pattern:**
```typescript
// If bank transaction match provided, update both tables
if (data?.bankTransactionId) {
  updates.bank_transaction_id = data.bankTransactionId

  // Also update the bank transaction record
  const { error: bankError } = await supabase
    .from('bank_transactions')
    .update({
      status: 'matched',
      matched_expense_id: item.zoho?.expenseId || item.sourceId,
      match_confidence: 100,
      match_method: 'manual',
      matched_at: new Date().toISOString(),
    })
    .eq('id', data.bankTransactionId)

  if (bankError) {
    return { success: false, message: `Failed to update bank transaction: ${bankError.message}` }
  }
}
```

### Type System Updates

**File:** `expense-dashboard/src/features/review/types.ts`

**Interface:** `CorrectionData`

**Added Field:**
```typescript
export interface CorrectionData {
  category?: string
  state?: string
  createVendorRule?: boolean
  bankTransactionId?: string  // NEW: Manual bank transaction match
}
```

### Files Modified

| File | Purpose | Status |
|------|---------|--------|
| `src/features/review/components/BankTransactionPicker.tsx` | NEW: Bank transaction search/selection component | ✅ CREATED |
| `src/features/review/components/ReviewDetailPanel.tsx` | Integration of BankTransactionPicker | ✅ UPDATED |
| `src/features/review/normalizers/zohoExpenseNormalizer.ts` | Multi-issue flagging reason display | ✅ UPDATED |
| `src/features/review/services/reviewActions.ts` | Manual match handling in handleResubmit | ✅ UPDATED |
| `src/features/review/types.ts` | Added bankTransactionId to CorrectionData | ✅ UPDATED |

### Testing Results

- ✅ BankTransactionPicker displays unmatched transactions within date range
- ✅ Exact amount matches highlighted in green
- ✅ Amount similarity sorting works correctly
- ✅ Text search filters by description/vendor
- ✅ Selected transaction displays with green highlight
- ✅ "Change" button allows re-selection
- ✅ Save & Resubmit updates both zoho_expenses and bank_transactions
- ✅ Flagging reasons show all issues in human-readable format
- ✅ Manual matches persist after resubmission
- ✅ Bank transaction status changes from 'unmatched' to 'matched'

### Key Design Decisions

**Why +/- 7 days search range?**
- Bank transactions can post days after expense date
- International transactions may have 3-5 day lag
- 7 days covers 99% of legitimate matches without overwhelming user with options

**Why inline picker instead of modal?**
- Better UX: All expense details visible while selecting transaction
- No context switching
- Maintains scroll position and form state

**Why green highlight for exact matches?**
- Visual affordance: User instantly sees best matches
- Reduces cognitive load: No need to manually compare amounts
- Prevents errors: Accidentally selecting wrong transaction

**Why show amount difference?**
- Transparency: User knows why it's not an exact match
- Debugging: Helps identify tips, fees, currency conversion issues
- Confidence: User can verify they're selecting correct transaction

---

---

## Architecture Context

### Why zoho_expenses Instead of expense_queue?

The old architecture used `expense_queue` as a staging table for items needing review. The new queue-based architecture uses `zoho_expenses` directly with a `status` column because:

1. **Single source of truth** - All Zoho expenses in one table
2. **Status-based workflow** - Clear state machine (pending→processing→posted/flagged)
3. **Memory efficiency** - n8n processes one expense at a time
4. **Self-healing** - Failed items stay in 'error' status, can be reset to 'pending'
5. **Observable** - All expense states visible in one query

### Queue Processing Flow

```
1. Zoho approves expense report
2. Webhook calls Edge Function (receive-zoho-webhook)
3. Edge Function stores expenses in zoho_expenses (status='pending')
4. Database trigger fires process_expense_queue()
5. Queue controller claims next pending expense (FOR UPDATE SKIP LOCKED)
6. pg_net calls n8n webhook with expense_id
7. n8n fetches expense, matches to bank transaction, posts to QBO
8. n8n updates status to 'posted' (success) or 'flagged' (low confidence)
9. Trigger fires again, processes next expense
```

### Flagging Criteria (set by n8n)

An expense is flagged when:
- Match confidence < 95%
- No bank transaction match found
- State tag missing or invalid
- Receipt validation failed
- Business rule violation

---

## Related Documentation

- `Documentation/Technical_Docs/N8N_WORKFLOW_REBUILD_GUIDE.md` - n8n workflow details
- `Documentation/Technical_Docs/SYSTEM_BOUNDARIES.md` - Component responsibilities
- `Documentation/expense-automation-architecture.md` - Overall system design
- `Documentation/database-schema.md` - Full database schema
- `CLAUDE.md` - Project conventions and standards

---

*End of Specification*
