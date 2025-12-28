# AS3 Auto Bookkeeper - Project Changelog

**Purpose:** Historical record of changes, fixes, and lessons learned. Reference this when debugging similar issues.

---

## December 28, 2025: Lookup QBO Class Node Fix (Agent 1)

**STATUS:** ✅ FIXED - State lookup now uses abbreviation from Edit Fields node.

**Problem:**
- Lookup QBO Class node was failing to find matches
- Transactions stuck at this node with NO output (breaking workflow chain)
- Caused by using `state_tag` ("California") instead of `state` ("CA") in the query

**Root Cause Analysis:**

The Lookup QBO Class node used this expression:
```javascript
{{ ($json.state_tag === 'Other' || $json.state === 'Other') ? 'NC' : ($json.state_tag || $json.state) }}
```

**Problem with OR precedence:** `($json.state_tag || $json.state)` returns the FIRST truthy value:
- `state_tag` = "California" (truthy) → Returns "California"
- `state` = "CA" (never evaluated)
- `qbo_classes` table only has abbreviations (CA, TX, etc.)
- Result: No match found → Supabase "get" operation returns NO output → Workflow breaks

**The Fix:**
```javascript
{{ $json.state || 'NC' }}
```

**Why This Works:**
1. Edit Fields node already converts state names to abbreviations:
   ```javascript
   const map = {"California":"CA","Texas":"TX","Colorado":"CO",...,"Other":"NC"}
   return map[$json.state_tag] || "NC"
   ```
2. The `state` field contains the abbreviation ("CA"), not the full name
3. Fallback to "NC" (Admin) handles edge cases

**qbo_classes Table Reference:**
| state_code | qbo_class_id |
|------------|--------------|
| CA | 1000000004 |
| TX | 1000000006 |
| CO | 1000000007 |
| WA | 1000000008 |
| NJ | 1000000009 |
| FL | 1000000010 |
| MT | 1000000011 |
| NC | 1000000012 |

**Testing Results:**
- 5 transactions reset and reprocessed
- 2 posted successfully (Starbucks, 7 ELEVEN)
- 3 marked as duplicates (correctly - already existed in QBO from prior attempt)
- All passed through Lookup QBO Class successfully

**Key Lesson:** When chaining field transformations, always use the FINAL transformed field in downstream queries. The pattern `($json.field_a || $json.field_b)` returns the first truthy value, not necessarily the correct one.

**Where to Apply:**
- Workflow: Agent 1 - Queue Based v3.0 (ID: ZpsBzIO0oXaEnKIR)
- Node: Lookup QBO Class
- Field: state_code filter value

---

## December 28, 2025: Editable Date Field for Flagged Expenses

**STATUS:** ✅ IMPLEMENTED - Users can now edit expense dates on flagged zoho_expenses.

**Problem Solved:**
- Sometimes receipts are uploaded with incorrect dates in Zoho
- Bank transactions may post on different dates than expense dates
- Date affects bank transaction matching (±3 day window) and Monday.com event matching
- Previously, date field was read-only - users had to manually update database

**Implementation Changes:**

**1. CorrectionData Interface (types.ts)**
```typescript
export interface CorrectionData {
  category?: string
  state?: string
  date?: string              // NEW: Corrected expense date (YYYY-MM-DD)
  notes?: string
  createVendorRule?: boolean
  bankTransactionId?: string
}
```

**2. ReviewDetailPanel.tsx**
- Added `expenseDate` state variable initialized from `item.date`
- Made Date FieldRow editable for zoho_expenses: `readOnly={item.sourceTable !== 'zoho_expenses'}`
- Added `type="date"` to FieldRow which renders an HTML date input
- Updated hasChanges to detect date changes: `expenseDate !== (item.date || '')`
- Updated handleAction to pass date in corrections: `date: expenseDate !== item.date ? expenseDate : undefined`
- Updated FieldRow component to support type="date" with proper date input and formatted display

**3. reviewActions.ts - handleResubmit**
```typescript
const finalDate = data?.date || expense.expense_date
// Used in webhook payload and expense update
expense_date: finalDate,
```

**4. reviewActions.ts - handleSaveCorrections**
```typescript
if (data?.date) {
  updates.expense_date = data.date
}
// Also added to corrections object for audit trail
```

**User Flow:**
1. For zoho_expenses items, the Date field shows with an edit button
2. Click to edit opens an HTML date picker (YYYY-MM-DD format)
3. When date is changed, hasChanges becomes true and button shows "Save & Resubmit"
4. The corrected date is:
   - Saved to zoho_expenses.expense_date in the database
   - Sent to the Human Approved Processor webhook
   - Posted to QBO with the corrected date
   - Tracked in corrections JSONB field for audit trail

**Why Date Editing Matters:**
- Bank transaction matching uses ±3 day window from expense_date
- Monday.com event matching checks date range overlap with expense_date
- QBO Purchase transactions must have accurate dates for accounting
- Incorrect dates cause legitimate matches to fail, flagging valid expenses

**Files Modified:**
- `expense-dashboard/src/features/review/types.ts` - Added date to CorrectionData
- `expense-dashboard/src/features/review/components/ReviewDetailPanel.tsx` - Made date editable
- `expense-dashboard/src/features/review/services/reviewActions.ts` - Updated handlers

**Key Benefits:**
- Self-service correction - no database access needed
- Better bank transaction matching - correct date = correct ±3 day window
- Accurate Monday.com event matching - date range overlaps use corrected date
- Full audit trail - date corrections stored in corrections JSONB field
- QBO accuracy - Purchase transactions posted with correct date

**Documentation Updated:**
- PROJECT_CHANGELOG.md (this file)
- UI_QUEUE_INTEGRATION_SPEC.md
- web-app-spec.md

---

## December 28, 2025: Review Queue Bank Transaction Editing Fixes

**STATUS:** Fixed bank transaction matching UI for flagged expenses.

**Problems Solved:**

**Problem 1: Could Not Change Existing Bank Transaction Match**
- ReviewDetailPanel showed existing bank transaction as read-only text
- BankTransactionPicker only appeared when `!item.bankTransaction` (no existing match)
- Users could not correct an incorrectly matched transaction

**Problem 2: Save & Resubmit Failed After State/Category Change**
- Changing state/category set `hasChanges = true`, triggering "Save & Resubmit" button
- Button called `handleAction` → `handleResubmit` with `bankTransactionId: selectedBankTxn?.id || undefined`
- Since no new transaction was selected, `selectedBankTxn` was null → undefined passed to handler
- handleResubmit required bankTransactionId and failed: "Bank transaction match is required for resubmit"

**Problem 3: hasChanges Detected False Positives**
- `hasChanges = selectedBankTxn !== null` triggered even when user selected the SAME transaction already matched
- Caused unnecessary "Save & Resubmit" button to appear instead of "Approve"

**Solutions Implemented:**

**1. Added "Change" Button to Existing Match Display (lines 329-335)**
```typescript
{/* Allow changing bank transaction for zoho_expenses */}
{item.sourceTable === 'zoho_expenses' && (
  <button
    onClick={() => setShowBankPicker(true)}
    className="ml-auto text-[10px] text-[#C10230] hover:text-[#A00228] font-medium underline"
  >
    Change
  </button>
)}
```

**2. Made BankTransactionPicker Shared (lines 410-423)**
- Moved BankTransactionPicker outside conditional that checked `!item.bankTransaction`
- Now shows for BOTH items without a match AND items with an existing match
- Picker adapts: "finding a new match" vs "changing the match"

**3. Updated handleAction Fallback Logic (line 147)**
```typescript
// Use selected bank txn, or fall back to existing match
bankTransactionId: selectedBankTxn?.id || item.bankTransaction?.id || undefined,
```

**4. Fixed hasChanges Detection (lines 157-163)**
```typescript
// Detect if user selected a DIFFERENT bank transaction (not just any selection)
const bankTxnChanged = selectedBankTxn !== null && selectedBankTxn.id !== item.bankTransaction?.id

const hasChanges = category !== (item.predictions?.category || item.zoho?.categoryName || '') ||
  state !== (item.predictions?.state || '') ||
  vendor !== (item.vendor || '') ||
  bankTxnChanged
```

**How It Works Now:**
1. **Flagged expense with existing bank match:** Shows matched transaction with "Change" link → Click to pick different one
2. **Flagged expense without bank match:** Shows "Find Bank Transaction Match" button as before
3. **Changing state/category only:** Works correctly - uses existing bank transaction for resubmit
4. **Changing the bank transaction:** Use "Change" link, select new one, then "Save & Resubmit"

**File Modified:**
- `expense-dashboard/src/features/review/components/ReviewDetailPanel.tsx`

**Key Lesson:** When building edit forms, always provide UI to change ALL editable fields, not just fields that are initially empty. The "read-only display with Change button" pattern works well for complex nested selectors like bank transaction pickers.

---

## December 28, 2025: n8n Workflow Bank Transaction ID Data Flow FIX

**STATUS:** Queue-Based Workflow v3.0 bank_transaction_id tracking fully operational.

**Problem Solved:**
- `bank_transaction_id` wasn't flowing through workflow to database
- Posted expenses had NULL bank_transaction_id (broken audit trail)
- Bank transactions weren't being marked as 'matched'
- AI approval decisions inconsistent (high-confidence items flagged)

**Root Causes:**

1. **Match Bank Transaction node** - Destructuring stripped `_bank_transactions` array
2. **Parse AI Decision node** - Didn't extract `bank_transaction_id` from AI JSON
3. **Update Status - Flagged** - Missing `bank_transaction_id` field
4. **Update Status - Posted** - Referenced wrong source node (`Edit Fields` instead of `Prepare Receipt Upload`)
5. **categorization_history tool** - AI returned string "none" → UUID validation error

**Key Fixes:**

**Parse AI Decision - Robust JSON Extraction:**
```javascript
// Try multiple extraction patterns (```json blocks, raw JSON)
let bankTransactionId = parsedDecision?.bank_transaction_id || null;
if (!bankTransactionId) {
  bankTransactionId = $('Match Bank Transaction').first()?.json?.bank_transaction_id;
}

return [{
  json: {
    ...fetchExpense,
    bank_transaction_id: bankTransactionId,  // CRITICAL: Include in output
    // ... other fields
  }
}];
```

**AI System Prompt - Clear Decision Criteria:**
```
APPROVED: confidence >= 95 AND (match_type = 'exact' OR 'amount_date_match')
          OR confidence >= 90 AND match_type = 'amount_merchant_match'

FLAGGED: confidence < 90, no match, multiple matches, unclear fields

CRITICAL: Response MUST START with exactly "APPROVED" or "FLAGGED"
```

**Production Results:**
- 3/7 expenses auto-approved and posted to QBO (43% approval rate)
- 4/7 correctly flagged for human review
- All expenses have `bank_transaction_id` populated
- Bank transactions marked as 'matched' with QBO Purchase IDs
- No workflow errors

**Key Lessons:**
1. **Data Flow After Supabase Nodes:** `$input.first().json` = update confirmation, NOT original data. Reference source node explicitly.
2. **AI Output Parsing:** Try multiple extraction patterns, always have NULL fallbacks (not "none").
3. **UUID Validation:** Database rejects strings. Remove field from tool or ensure AI returns NULL.
4. **AI Prompts:** Use exact thresholds ("confidence >= 95") not ambiguous terms ("high confidence").
5. **Output Format:** Explicitly state: "MUST START with exactly one word: APPROVED or FLAGGED"

**Documentation Created:**
- `Documentation/Technical_Docs/N8N_BANK_TRANSACTION_FIX.md` - Complete debugging guide

---

## December 28, 2025: AI Agent Receipt Tool Architecture CRITICAL FIX

**STATUS:** AI Agent receipt analysis restored via HTTP Request Tool approach.

**Problem Discovered:**
- AI Agent had `passthroughBinaryImages: false` and system message said "DO NOT analyze receipts"
- This DEFEATED the entire purpose of the AI Agent - its core job IS to analyze receipts
- The Edge Function approach (validate-receipt) was wrong - it removed AI's decision-making ability
- Expenses were failing because AI couldn't see/validate receipts

**Root Cause Analysis:**
- Memory issues from loop-based architecture led to over-correction
- Binary was removed from AI Agent entirely, rather than fixing the data flow
- Queue-based v3.0 already solved memory isolation (1 expense per execution)
- The Edge Function approach "threw the baby out with the bathwater"

**CORRECT Architecture (AI Tool-Based):**
```
[Upload Receipt to Storage] → [Update Receipt Path] → ... → [AI Agent]
                                                                 ↓
                                                    AI calls "Fetch Receipt Tool"
                                                    (HTTP Request to Storage)
                                                                 ↓
                                                    AI sees image, analyzes it
                                                                 ↓
                                                    AI makes categorization decision
                                                                 ↓
                                              ... → [Fetch Receipt for QBO] → [Upload to QBO]
```

**Key Principle:** Binary only exists during isolated HTTP operations:
1. Initial upload to Storage (n8n HTTP Request)
2. AI's tool call (AI Agent internal)
3. QBO upload (fresh fetch via HTTP Request)

**NO binary flows through Code nodes = NO memory duplication = NO crashes**

**New Tool Added to AI Agent:**
- **Name:** Fetch Receipt Tool
- **Type:** HTTP Request Tool
- **URL:** `https://...supabase.co/storage/v1/object/expense-receipts/{{ $fromAI('receipt_path') }}`
- **Purpose:** AI calls this to fetch and analyze receipt image on-demand

**Files Superseded:**
- `N8N_VALIDATE_RECEIPT_FIX.md` - OBSOLETE (Edge Function approach abandoned)
- `N8N_SIMPLIFICATION_GUIDE.md` - OBSOLETE (was removing AI receipt analysis)

**New Documentation:**
- `Documentation/Technical_Docs/N8N_AI_RECEIPT_TOOL_FIX.md` - Complete 13-step implementation guide

**Key Lesson:** The AI Agent's core purpose is to analyze receipts and make intelligent decisions. Any architecture that removes this capability defeats the purpose of having an AI Agent. Memory issues should be solved by fixing data flow (no binary in Code nodes), not by removing AI capabilities.

---

## December 27, 2025: Monday.com Subitem Integration COMPLETE

**STATUS:** Monday.com Course Revenue Tracker subitem creation working via Edge Function.

**Problem Solved:**
- n8n HTTP Request node cannot handle nested JSON strings in GraphQL mutations
- Triple-escaping problem: GraphQL string → JSON body → n8n expression evaluation
- Monday.com's `column_values` parameter requires JSON string (not object)

**Solution Architecture:**
```
n8n Workflow (Human Approved Processor V1.0)
    ↓
Build Monday Request (Code Node) - outputs simple JSON
    ↓
Create Monday Subitem (HTTP Request) - calls Edge Function
    ↓
Supabase Edge Function: create-monday-subitem
    ↓
Monday.com GraphQL API (Edge Function handles all escaping)
    ↓
Returns subitem_id → Update Monday IDs (Supabase Node)
```

**Edge Function Created:**
- `supabase/functions/create-monday-subitem/index.ts`
- Receives: `{ parent_item_id, item_name, concept, date, amount }`
- Returns: `{ success, subitem_id, subitem_name, duration_ms }`
- Handles all GraphQL escaping internally

**Critical n8n HTTP Request Gotchas Discovered:**

| Issue | Wrong | Correct |
|-------|-------|---------|
| HTTP Method | GET (default) | **POST** (must set explicitly!) |
| JSON Body | `=={{ $json }}` | `={{ JSON.stringify($json) }}` |
| Supabase Keys | `sb_publishable_...` | Legacy JWT `eyJhbG...` format |

**Key Lesson:** n8n HTTP Request node defaults to GET, which doesn't send request bodies. This caused "Unexpected end of JSON input" because the Edge Function received an empty body.

**Documentation Created:**
- `Documentation/Technical_Docs/N8N_HTTP_REQUEST_GOTCHAS.md` - General n8n HTTP Request lessons
- `Documentation/Technical_Docs/N8N_MONDAY_SUBITEM_FAILED_APPROACHES.md` - Updated with solution

**Monday.com Integration Now Working:**
- Expense processed → QBO Purchase created
- Monday event matched → Revenue Tracker item found
- Subitem created under Revenue Tracker item
- `zoho_expenses.monday_subitem_id` updated

---

## December 24, 2025: Receipt Validation Edge Function & n8n Memory Fix

**STATUS:** Receipt validation moved to Edge Function; n8n binary passthrough being eliminated.

**Problem Solved:**
- n8n Cloud was running out of memory processing expense reports
- Root cause: Binary receipt images (~1-3MB each) duplicated at every Code node
- AI Agent node with `passthroughBinaryImages: true` caused memory explosion

**Solution Architecture:**
```
Zoho Webhook → receive-zoho-webhook Edge Function
                        ↓
              Stores expense in zoho_expenses
                        ↓
              Triggers validate-receipt (fire-and-forget)
                        ↓
              Claude API analyzes receipt via URL (no binary in memory)
                        ↓
              Stores result in receipt_validations table
                        ↓
              n8n reads pre-computed validation (no image processing needed)
```

**Edge Functions Deployed:**

**1. validate-receipt** (NEW)
- Uses Claude claude-sonnet-4-20250514 to analyze receipt images
- Claude fetches image from signed URL (no binary in Edge Function memory)
- Extracts: merchant, amount, date, location
- Validates: amount match, merchant match
- Stores: confidence score (0-100), issues array
- Updates: `zoho_expenses.receipt_validated = true`

**2. receive-zoho-webhook** (UPDATED)
- Now triggers validate-receipt after storing each expense
- Fire-and-forget pattern (doesn't wait for validation to complete)
- Validation runs async in background

**Database Changes:**
- `receipt_validations` table stores all validation results
- `zoho_expenses.receipt_validated` flag indicates validation complete
- `zoho_expenses.receipt_validation_id` links to validation record

**n8n Workflow Changes Required (4 remaining):**

| Node | Change | Why |
|------|--------|-----|
| AI Agent | Uncheck `passthroughBinaryImages` | Stop binary duplication |
| AI Agent Prompt | Replace "Receipt image attached..." with validation data reference | Use pre-computed results |
| Filter Monday | Delete `binary: receiptBinary` from return | No binary needed downstream |
| Add Empty Monday | Delete `binary: receiptBinary` from return | No binary needed downstream |

**Tested Results:**
- validate-receipt tested with expense e8ca82ba-e5f3-41bf-8b10-7eb1efbb42fb
- 98% confidence, extracted "Boots UK Limited", GBP12.23
- Data stored in receipt_validations table
- zoho_expenses.receipt_validated = true

**Key Benefits:**
1. **No binary in n8n workflow** - Prevents out-of-memory crashes
2. **Validation pre-computed** - n8n just reads JSON, doesn't wait for Claude
3. **Faster n8n execution** - No image processing delay
4. **Better debugging** - Validation results visible in database

**Files Created/Modified:**
- `supabase/functions/validate-receipt/index.ts` (NEW)
- `supabase/functions/receive-zoho-webhook/index.ts` (UPDATED)
- `Documentation/Technical_Docs/N8N_SIMPLIFICATION_GUIDE.md` (NEW)

**Stuck Expense Handling:**
- Added `stuckExpenseNormalizer.ts` for expenses stuck in 'processing' > 30 minutes
- handleRetry resets stuck expenses to 'pending' for queue reprocessing
- 'stuck' item type added to Review Queue UI

---

## December 16, 2025: Queue-Based Workflow COMPLETE

**STATUS:** Queue-based architecture v3.0 is FULLY OPERATIONAL in production.

**What We Fixed:**

**1. Bank Transaction Query (HTTP Request vs Supabase Node)**
- **Problem:** Supabase node couldn't handle date filtering with +/-3 days correctly
- **Solution:** Replaced with HTTP Request node using PostgREST query syntax
- **URL:** `https://fzwozzqwyzztadxgjryl.supabase.co/rest/v1/bank_transactions?select=id,transaction_date,description,amount,status,source,extracted_vendor&status=eq.unmatched&transaction_date=gte.{{ $json.date_start }}&transaction_date=lte.{{ $json.date_end }}`
- **Authentication:** Supabase API (native credentials)

**2. Data Flow Through Supabase Update Nodes**
- **Problem:** Code nodes after Supabase update nodes lost reference to earlier data (Supabase returns only update confirmation)
- **Solution:** Reference earlier nodes explicitly using `$('NodeName').first().json`
- **Pattern:** `const expense = $('Process QBO Accounts').first().json;`
- **Binary Data:** `$('Fetch Receipt').first()?.binary` to preserve receipt through entire workflow

**3. Filter Monday State Matching**
- **Problem:** When multiple Monday events match by date, workflow picked first one regardless of state
- **Solution:** Added state matching bonus (+10 points) in Filter Monday node
- **Logic:** When `monday_event.state === expense.state_tag`, add +10 to match score
- **Example:** CA expense on date with both CA and CO events → Prefers CA event

**4. Flag Reason Column**
- **Added:** `flag_reason` column to zoho_expenses table
- **Purpose:** Store why expense was flagged (no bank match, low confidence, missing data, etc.)
- **Migration:** `ALTER TABLE zoho_expenses ADD COLUMN IF NOT EXISTS flag_reason TEXT;`

**Production Results:**
- 9 expenses successfully posted to QBO (Purchase IDs: 9215-9228)
- 14 expenses flagged for review (visible in Review Queue UI)
- Bank transaction matching works correctly (exact match, 100% confidence)
- Monday.com state matching prefers events matching expense state
- Receipt attachment to QBO working
- ClassRef state tracking working (expenses show correct state in QBO reports)
- Queue controller self-healing (processes next expense after each completion)

**Key Technical Improvements:**

**HTTP Request for Bank Queries:**
- PostgREST syntax more reliable than Supabase node for complex date filtering
- Headers: `apikey`, `Authorization: Bearer [service_role_key]`, `Prefer: return=representation`
- Date calculation in Code node before query: `date_start = expense_date - 3 days`, `date_end = expense_date + 3 days`

**Data Referencing Pattern:**
```javascript
// After Supabase update nodes, reference earlier nodes explicitly
const expense = $('Process QBO Accounts').first().json;
const qboClass = $('Fetch QBO Class').first().json;
const receiptBinary = $('Fetch Receipt').first()?.binary;

// NOT: $input.first().json (won't work after update nodes)
```

**State Matching in Filter Monday:**
```javascript
// Add bonus when state matches
if (event.state === expense.state_tag) {
  score += 10; // Prefer events in same state as expense
}
```

---

## December 15, 2025: UI Queue Integration Complete

**FEATURE COMPLETE:** Review Queue UI now displays and manages flagged expenses from the `zoho_expenses` table.

**Problem Solved:**
- 14 flagged expenses in `zoho_expenses` table were invisible to users
- No UI to review, correct, or resubmit expenses flagged by the queue-based architecture
- Users couldn't see match confidence, processing attempts, or error details

**Implementation Completed:**

**1. Data Layer:**
- Updated TypeScript types (`database.ts`) with all 26 zoho_expenses columns
- Added 'zoho_expenses' to SourceTable union type
- Added 'resubmit' to ReviewAction union type
- Created `zohoExpenseNormalizer.ts` to transform DB rows into ReviewItem interface
- Integrated into `useReviewItems` hook with parallel receipt URL generation

**2. Actions Layer:**
- Implemented `handleResubmit()` to reset status='pending' for queue reprocessing
- Updated `updateSourceTableStatus()` for zoho_expenses-specific fields (processed_at, updated_at)
- Added corrections support (state_tag, category_name updates before resubmit)
- Integrated vendor rule creation from review UI

**3. UI Layer:**
- Match confidence display with visual progress bar (green >=95%, amber >=70%, red <70%)
- Processing attempts counter (shown when > 1)
- zoho_expenses-specific button group: "Save & Resubmit", "Resubmit", "Reject"
- Receipt display from Supabase Storage (1-hour signed URLs)

**Key Features:**
- **Resubmit Action:** Resets `status = 'pending'` and clears error state, allowing queue controller to retry
- **Parallel Receipt Loading:** Signed URLs generated in parallel for optimal performance
- **Match Confidence Threshold:** 95% for auto-approval, visual indicator shows where item stands
- **Self-Service Corrections:** Users can fix state/category and resubmit without developer intervention

**Files Modified:**
- `expense-dashboard/src/types/database.ts`
- `expense-dashboard/src/features/review/types.ts`
- `expense-dashboard/src/features/review/normalizers/zohoExpenseNormalizer.ts` (NEW)
- `expense-dashboard/src/features/review/normalizers/index.ts`
- `expense-dashboard/src/features/review/hooks/useReviewItems.ts`
- `expense-dashboard/src/features/review/services/reviewActions.ts`
- `expense-dashboard/src/features/review/components/ReviewDetailPanel.tsx`

---

## December 11, 2025: Queue-Based Architecture v3.0 COMPLETE

**MAJOR ARCHITECTURE CHANGE:** Transitioned from loop-based n8n processing to queue-based single-expense processing.

**Problem Solved:**
- n8n Cloud ran out of memory processing a 23-expense report
- Root cause: Binary data (receipts ~1-3MB each) duplicated at every Code node in loop
- 23 expenses x ~8MB (binary + JSON) = 188MB+ exceeded n8n Cloud limits

**New Architecture:**
```
Zoho Webhook → Supabase Edge Function → zoho_expenses table (status='pending')
                                              ↓
                              Database Trigger fires → Queue Controller
                                              ↓
                              Claims next pending expense (FOR UPDATE SKIP LOCKED)
                                              ↓
                              pg_net calls n8n webhook with single expense_id
                                              ↓
                              n8n processes ONE expense (fresh memory!)
                                              ↓
                              Updates status to 'posted'/'error'/'flagged'
                                              ↓
                              Trigger fires again → Queue continues
```

**Database Infrastructure Completed:**
- `zoho_expenses` table enhanced with queue columns (status, processing_attempts, etc.)
- `pg_net` extension enabled for async HTTP calls from triggers
- `process_expense_queue()` function with max 5 concurrent executions
- Triggers: `trigger_queue_on_insert` and `trigger_queue_on_completion`
- `expense-receipts` Storage bucket created
- Queue controller tested and working (status changes from pending → processing)

**Edge Function Created:**
- `supabase/functions/receive-zoho-webhook/index.ts`
- Receives Zoho webhook, stores expenses in DB, uploads receipts to Storage

**Key Benefits:**
- Memory isolation: Each n8n execution processes ONE expense
- Self-healing: Failed expenses don't block others
- Observable: All expense states visible in zoho_expenses table
- Retryable: Reset status to 'pending' to reprocess
- Max 5 concurrent: Prevents n8n overload

---

## December 10, 2025: Agent 1 Complete (v2.0 - SUPERSEDED by v3.0)

**Status:** Agent 1 (Zoho Expense Processing) n8n workflow WAS complete but had memory issues with large reports. Replaced by queue-based v3.0 architecture above.

**Completed Features:**
- Multi-expense report processing (all expenses in report processed)
- Bank transaction matching (5 matching strategies)
- Receipt image validation via AI Agent
- Monday.com venue extraction for COS expenses
- QBO account lookup and mapping
- QBO Class lookup for state tracking
- Vendor lookup/creation in QBO
- Purchase posting to QBO with EntityRef and ClassRef
- Receipt upload to QBO (conditional)
- Comprehensive error handling with Teams notifications
- Bank transaction status updates

**Final Workflow:** 41 nodes, all connected, handles single and multi-expense reports correctly.

**Multi-Expense Binary Data Issue Fix:**

Problem: Multi-expense reports only processed first expense; AI couldn't see receipt images.

Root causes discovered:
1. Binary data (receipt images) not preserved in Code nodes
2. Wrong data references using `$runIndex` (undefined without loop)

**Working Code Patterns for n8n Code Nodes:**

```javascript
// Pattern 1: Node receives data directly from previous node
const inputItem = $input.first();
const data = inputItem.json;
return [{ json: {...data}, binary: inputItem.binary }];

// Pattern 2: Node needs data from non-adjacent node
const mondayItems = $input.all();  // Current node's input
const fetchReceiptItem = $('Fetch Receipt').first();  // Reference other node
const expense = fetchReceiptItem.json;
return [{ json: {...expense}, binary: fetchReceiptItem.binary }];

// Pattern 3: Processing multiple items (from $input.all())
const items = $input.all();
return items.map(item => ({
  json: {...item.json},
  binary: item.binary  // Preserve binary for each item
}));
```

**Key Lessons Learned:**

1. **Always preserve binary data**: When a Code node processes data that includes binary (like images), include `binary: $input.first().binary` in the return object
2. **Use $input when receiving directly**: If a Code node receives data directly from the previous node, use `$input.first()` not `$('SomeOtherNode')`
3. **Use $('NodeName') for non-adjacent nodes**: Only use `$('NodeName').first()` when you need data from a node that's not directly connected
4. **$runIndex requires a loop**: The $runIndex variable only works inside Split In Batches. Without a loop, it's undefined.
5. **Multi-expense works without a loop**: The workflow processes multiple expenses correctly using Split Out with proper data references

---

## December 8, 2025: Three-Agent Architecture Finalized

**Major Architectural Decision:** Transitioned from two-flow to three-agent specialized architecture.

**Changes Made:**

1. **Three Specialized AI Agents Defined:**
   - **Agent 1 (Zoho Expense Processor)**: Matches Zoho expenses to bank transactions, does NOT use vendor_rules (saves ~3000 tokens)
   - **Agent 2 (Orphan & Recurring Processor)**: Handles unmatched bank transactions after 45-day grace period, USES vendor_rules
   - **Agent 3 (Income Reconciler)**: DEFERRED until expense flows are solid - will handle STRIPE/WooCommerce matching

2. **Critical Clarifications Added:**
   - "Other" state tag in Zoho = NC (North Carolina, admin/home office state)
   - ZELLE/VENMO payments ARE Zoho expenses (Wells Fargo Debit), require receipt upload
   - Credits/refunds must match to original transaction, post to SAME QBO account
   - 45-day grace period before declaring transaction "orphan" (changed from 5 days)
   - Employee reimbursements paid through QBO directly, not tracked in this system
   - Monday.com integration DEFERRED until QBO flows are solid (2-3 weeks)

3. **Context Window Optimization:**
   - Agent 1: No vendor_rules in context (Zoho has everything needed)
   - Agent 2: Needs vendor_rules (no Zoho context for orphans)
   - Each agent gets only the data it needs → Fewer tokens, fewer iterations, higher reliability

4. **Documentation Created:**
   - `Technical_Docs/THREE_AGENT_ARCHITECTURE.md` - Comprehensive three-agent specification
   - Updated: expense-automation-architecture.md, n8n-workflow-spec.md, SYSTEM_BOUNDARIES.md, database-schema.md

**Lesson:** Specialized agents with optimized context windows are more reliable than a single agent trying to handle all scenarios. Saves tokens, reduces iterations, improves success rate.

---

## December 8, 2025: Post-Implementation Cleanup

**Changes Made:**

1. **extractVendor Function Fixed** - BankFeedPanel.tsx lines 262-287
   - Now properly removes Wells Fargo prefixes (PURCHASE AUTHORIZED ON, PURCHASE INTL AUTHORIZED ON, etc.)
   - Removes card identifiers (SXXXXXXXX, CARD XXXX patterns)
   - Removes trailing state codes
   - Cleans special characters while preserving spaces
   - Returns first 2-3 meaningful words or null

2. **Database Function Created** - `extract_vendor_clean(description)`
   - PostgreSQL function for batch vendor re-extraction
   - Mirrors TypeScript logic for consistency
   - Documented in database-schema.md

3. **monday_events Table Removed**
   - Was incorrectly created - NOT part of system design
   - n8n queries Monday.com API directly via GraphQL
   - No local caching of Monday events
   - Updated all documentation to reflect this

4. **csv_format Dropdown Removed** - BankAccountsPanel.tsx
   - Parser auto-detects CSV format from headers
   - Manual format selection was redundant
   - Simplified user experience

5. **Tables Confirmed:**
   - bank_transactions (264 rows)
   - bank_accounts (3 rows)
   - vendor_rules (0 rows - to be populated)
   - qbo_accounts (16 rows)
   - expense_queue (0 rows)
   - categorization_history (1 row)
   - flagged_expenses (1 row)

**Lesson:** After implementing core features, always verify documentation matches reality. This prevents future confusion and architectural violations.

---

## December 7, 2025: System Boundaries Defined

**Problem:** Risk of web app import attempting to determine state or match expenses - responsibilities that belong to n8n.

**Solution:** Created `SYSTEM_BOUNDARIES.md` to explicitly define:
- Web app ONLY stores raw bank data (no business logic)
- n8n EXCLUSIVELY handles matching and state determination
- Clear list of forbidden fields for each component

**Lesson:** When adding features, always ask: "Does this component have the context needed to make this decision?"

---

## Revision History

| Version | Date | Changes |
|---------|------|---------|
| 2.7 | December 28, 2025 | Lookup QBO Class node fix - use `state` abbreviation instead of `state_tag` full name |
| 2.6 | December 28, 2025 | n8n workflow bank_transaction_id data flow fix, Parse AI Decision rewrite, AI prompt decision criteria, 43% auto-approval rate achieved |
| 2.5 | December 28, 2025 | Review Queue bank transaction editing fixes, added Change button for existing matches, fixed Save & Resubmit fallback logic |
| 2.4 | December 28, 2025 | AI Agent receipt tool architecture fix, restore AI receipt analysis via HTTP Request Tool, supersede Edge Function approach |
| 2.3 | December 27, 2025 | Monday.com subitem integration COMPLETE, n8n HTTP Request gotchas documented, Edge Function for Monday.com |
| 2.2 | December 24, 2025 | Receipt validation Edge Function, n8n memory fix documentation, stuck expense handling |
| 2.1 | December 16, 2025 | Queue-based workflow COMPLETE, documented HTTP Request pattern, state matching, flag_reason column |
| 2.0 | December 15, 2025 | UI Queue Integration complete, resubmit functionality, match confidence display |
| 1.4 | December 10, 2025 | Agent 1 declared COMPLETE, removed obsolete in-progress markers, updated Recent Changes section |
| 1.3 | December 10, 2025 | Updated QBO Classes section with actual IDs, added vendor lookup and receipt attachment capabilities |
| 1.2 | December 9, 2025 | Refined QBO API limitations section |
| 1.1 | December 10, 2025 | Added n8n Code node best practices, binary data preservation patterns, multi-expense fix lessons |
| 1.0 | December 7, 2025 | Initial creation with system boundaries enforcement |
