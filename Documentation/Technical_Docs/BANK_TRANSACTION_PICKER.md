# BankTransactionPicker Component Documentation

**Component Location:** `expense-dashboard/src/features/review/components/BankTransactionPicker.tsx`
**Last Updated:** December 26, 2025
**Version:** 1.0

---

## Overview

The BankTransactionPicker is a modal component that allows users to search, filter, sort, and manually select bank transactions to match with expenses during the review process. It provides a comprehensive UI for finding the correct bank transaction when automatic matching fails or needs manual correction.

---

## Purpose

- **Manual Matching:** When the AI agent fails to automatically match an expense to a bank transaction, users need to manually find and select the correct match
- **Correction Workflow:** Users can review suggested matches and select a different bank transaction if the AI suggestion is incorrect
- **Flexible Search:** Provides multiple ways to find transactions (date range, amount, vendor/description text)
- **Visual Feedback:** Highlights exact matches and shows amount differences to aid decision-making

---

## Features

### 1. Advanced Filtering

#### Date Range Controls
- **Default Range:** ±7 days from expense date
- **Adjustable Start/End:** Date pickers allow expanding or narrowing the search window
- **Reset Button:** One-click return to default ±7 day range
- **Visual Feedback:** Shows active date range in results summary

**Use Case:** If expense is dated Dec 15 but transaction posted Dec 18, users can expand the range to find it.

#### Amount Filter
- **Exact Amount Toggle:** Checkbox to show only transactions matching expense amount exactly (within $0.01 tolerance)
- **Real-time Filtering:** Results update immediately when toggled
- **Clear Indication:** Shows count of matching transactions

**Use Case:** When dealing with common vendors (e.g., Shell gas stations), filter to exact amount to reduce noise.

#### Text Search
- **Description Search:** Matches against transaction description
- **Vendor Search:** Matches against extracted vendor name
- **Case-Insensitive:** Works regardless of capitalization
- **Real-time:** Results filter as user types

**Use Case:** User types "marriott" to find hotel charges among many transactions.

### 2. Sorting Options

Users can sort transactions by 7 different criteria via dropdown:

| Sort Option | Default | Description |
|-------------|---------|-------------|
| **Amount (Closest Match)** | ✓ | Sorts by smallest amount difference first |
| **Date (Newest First)** | | Most recent transactions at top |
| **Date (Oldest First)** | | Oldest transactions at top |
| **Amount (High to Low)** | | Largest amounts first |
| **Amount (Low to High)** | | Smallest amounts first |
| **Vendor (A-Z)** | | Alphabetical by vendor/description |
| **Vendor (Z-A)** | | Reverse alphabetical |

**Default Behavior:** "Amount (Closest Match)" is selected by default, prioritizing transactions with amounts nearest to the expense amount.

**Implementation Detail:** Uses `useMemo` hook to efficiently recalculate sorted/filtered results only when dependencies change (transactions, searchQuery, exactAmountOnly, sortBy, expenseAmount).

### 3. Collapsible Filters Panel

- **Toggle Button:** "Filters" button with expand/collapse icon
- **Visual State:** Blue background when expanded, white when collapsed
- **State Preservation:** Filter settings persist when panel is collapsed
- **Responsive:** Filters wrap appropriately on smaller screens

**Design Rationale:** Keeps the UI clean for users who don't need advanced filters while making them easily accessible when needed.

### 4. Visual Indicators

#### Transaction Cards Display:
- **Source Badge:** Blue badge for AMEX, amber badge for Wells Fargo
- **Exact Match Badge:** Green "EXACT MATCH" badge when amount matches within $0.01
- **Amount Difference:** Shows difference in red (>$5 off) or amber (≤$5 off)
- **Selection Indicator:** Blue circular checkbox with checkmark when selected
- **Hover State:** Blue background highlight on hover
- **Selected State:** Blue left border and background when selected

#### Visual Feedback Examples:
```
[AMEX] Dec 15 [EXACT MATCH]
Shell Oil - Fresno CA
SHELL OIL 12345 FRESNO CA XXXX1044
$45.67  ← Green if exact match
```

```
[Wells Fargo] Dec 18
Marriott Hotels
MARRIOTT DALLAS TX XXXX6323
$189.00
+$3.50 difference  ← Amber if ≤$5, red if >$5
```

### 5. Enhanced Error Handling

- **Fetch Errors:** Displays user-friendly error message when database query fails
- **Retry Button:** Allows user to retry failed fetch without closing modal
- **Loading State:** Shows spinner with "Loading transactions..." message
- **Empty State:** Clear messaging when no transactions found with actionable suggestions

**Error Display:**
```
❌ Failed to load transactions. Please try again.
[Try again]
```

**Empty State:**
```
No matching transactions found
Try adjusting your search or filters
[Clear all filters]
```

### 6. Clear Filters Button

- **Appears When:** Search query or exact amount filter is active
- **Action:** Clears both searchQuery and exactAmountOnly in one click
- **Location:** Appears in results summary line (top right)
- **Styling:** Blue link-style button with hover underline

---

## Props Interface

```typescript
interface BankTransactionPickerProps {
  expenseAmount: number          // Amount from expense for comparison
  expenseDate: string            // ISO date string for default date range
  expenseVendor: string          // Vendor name displayed in header
  currentBankTxnId?: string | null  // Pre-selected transaction ID (if any)
  onSelect: (txn: BankTransaction | null) => void  // Callback with selected transaction
  onCancel: () => void           // Callback to close modal without selection
}
```

**Backwards Compatibility:** Props interface is unchanged from previous version - all new features are internal enhancements.

---

## Data Flow

### 1. Initialization
```
Component Mount
   ↓
Calculate default date range (expense_date ± 7 days)
   ↓
Set initial state (sortBy: 'amount_closest', exactAmountOnly: false)
   ↓
Fetch unmatched bank transactions within date range
```

### 2. Database Query

**Supabase Query:**
```typescript
supabase
  .from('bank_transactions')
  .select('id, transaction_date, description, amount, status, source, extracted_vendor')
  .eq('status', 'unmatched')
  .gte('transaction_date', dateStart)
  .lte('transaction_date', dateEnd)
  .order('transaction_date', { ascending: false })
  .limit(100)
```

**Performance Improvement:** Uses explicit column selection instead of `.select('*')` to reduce data transfer and improve query performance.

### 3. Client-Side Processing

```
Raw Transactions (from DB)
   ↓
Apply Text Search Filter (if searchQuery exists)
   ↓
Apply Exact Amount Filter (if exactAmountOnly=true)
   ↓
Apply Sort Logic (based on sortBy selection)
   ↓
Render Filtered/Sorted Results
```

**Memoization:** The `filteredTransactions` computation uses `useMemo` to avoid recalculating on every render. Only recalculates when:
- `transactions` array changes (new data fetched)
- `searchQuery` changes (user types)
- `exactAmountOnly` changes (checkbox toggled)
- `sortBy` changes (sort dropdown changed)
- `expenseAmount` changes (should not change within modal)

### 4. User Selection Flow

```
User clicks transaction card
   ↓
selectedId state updates (toggle on/off)
   ↓
Visual indicators update (blue background, checkmark)
   ↓
Footer shows "1 transaction selected"
   ↓
User clicks "Confirm Match"
   ↓
onSelect(selectedTransaction) callback fires
   ↓
Parent component (ReviewDetailPanel) updates expense with bank_txn_id
```

---

## Integration with Review Queue

### Parent Component
**File:** `expense-dashboard/src/features/review/components/ReviewDetailPanel.tsx`

### Usage Example
```typescript
const [showBankPicker, setShowBankPicker] = useState(false)

// In render:
{showBankPicker && (
  <BankTransactionPicker
    expenseAmount={item.amount}
    expenseDate={item.expense_date}
    expenseVendor={item.merchant}
    currentBankTxnId={item.bank_transaction_id}
    onSelect={(txn) => {
      if (txn) {
        // Update expense with selected bank transaction
        handleFieldUpdate('bank_transaction_id', txn.id)
      }
      setShowBankPicker(false)
    }}
    onCancel={() => setShowBankPicker(false)}
  />
)}
```

### Triggering the Picker
- **Primary:** "Find Bank Match" button in ReviewDetailPanel for flagged expenses with no match
- **Secondary:** "Change Match" button to replace existing match
- **Context:** Only shown for items from `zoho_expenses` table (queue-based expenses)

---

## Sorting Logic Details

### Amount (Closest Match) - DEFAULT
```typescript
const diffA = Math.abs(a.amount - expenseAmount)
const diffB = Math.abs(b.amount - expenseAmount)
return diffA - diffB  // Smallest difference first
```

**Example:**
- Expense: $50.00
- Results:
  1. $50.00 (diff: $0.00) ← Exact match
  2. $49.50 (diff: $0.50)
  3. $52.30 (diff: $2.30)
  4. $45.00 (diff: $5.00)

### Date (Newest/Oldest)
```typescript
// Newest First
return new Date(b.transaction_date).getTime() - new Date(a.transaction_date).getTime()

// Oldest First
return new Date(a.transaction_date).getTime() - new Date(b.transaction_date).getTime()
```

### Amount (High/Low)
```typescript
// High to Low
return b.amount - a.amount

// Low to High
return a.amount - b.amount
```

### Vendor (A-Z / Z-A)
```typescript
// Fallback to description if extracted_vendor is null
const vendorA = (a.extracted_vendor || a.description).toLowerCase()
const vendorB = (b.extracted_vendor || b.description).toLowerCase()

// A-Z
return vendorA.localeCompare(vendorB)

// Z-A
return vendorB.localeCompare(vendorA)
```

---

## State Management

### Component State Variables

| State Variable | Type | Initial Value | Purpose |
|----------------|------|---------------|---------|
| `searchQuery` | string | '' | User's text search input |
| `transactions` | BankTransaction[] | [] | Raw transactions from database |
| `isLoading` | boolean | true | Loading indicator for fetch |
| `selectedId` | string \| null | currentBankTxnId | Currently selected transaction ID |
| `fetchError` | string \| null | null | Error message if fetch fails |
| `sortBy` | SortOption | 'amount_closest' | Active sort option |
| `showFilters` | boolean | false | Filters panel expanded/collapsed |
| `exactAmountOnly` | boolean | false | Exact amount filter toggle |
| `dateStart` | string | expenseDate - 7 days | Start of date range (YYYY-MM-DD) |
| `dateEnd` | string | expenseDate + 7 days | End of date range (YYYY-MM-DD) |

### Computed Values (useMemo)

**filteredTransactions:**
- Depends on: transactions, searchQuery, exactAmountOnly, sortBy, expenseAmount
- Recalculates only when dependencies change
- Returns filtered and sorted array ready for display

---

## Responsive Design

### Breakpoints

**Small Screens (< 640px):**
- Search and sort dropdown stack vertically
- Date filter inputs wrap to multiple lines
- Modal has reduced inset (inset-4)

**Medium Screens (640px - 1024px):**
- Search and sort on same row
- Date filters on separate row
- Modal has moderate inset (inset-10)

**Large Screens (> 1024px):**
- All filters on single row where possible
- Modal has large inset (inset-20)
- Transaction cards display full details

### Tailwind Classes Used
```typescript
// Modal sizing
"fixed inset-4 md:inset-10 lg:inset-20"

// Search/Sort layout
"flex flex-col sm:flex-row gap-3"

// Filter panel
"flex flex-wrap items-end gap-4"
```

---

## Performance Considerations

### 1. Database Query Optimization
- **Explicit Column Selection:** Only fetches needed columns (id, transaction_date, description, amount, status, source, extracted_vendor)
- **Indexed Filters:** Query uses `status` and `transaction_date` which should be indexed
- **Result Limit:** Caps at 100 transactions to prevent excessive data transfer
- **Date Range:** Constrains query to reasonable window (±7 days default)

### 2. Client-Side Optimization
- **useMemo Hook:** Prevents unnecessary recalculation of filtered/sorted results
- **useCallback Hook:** Memoizes fetchTransactions function to prevent infinite loops in useEffect
- **Conditional Rendering:** Only renders transaction cards when not loading and no errors

### 3. Re-fetch Triggers
The component re-fetches from database when:
- `dateStart` changes (user adjusts start date)
- `dateEnd` changes (user adjusts end date)
- User clicks "Try again" after error

**Does NOT re-fetch when:**
- User types in search box (client-side filter)
- User changes sort option (client-side sort)
- User toggles exact amount filter (client-side filter)

---

## Accessibility Features

### Keyboard Navigation
- **Autofocus:** Search input receives focus when modal opens
- **Tab Navigation:** All interactive elements are keyboard accessible
- **Enter Key:** Can be enhanced to confirm selection (future improvement)
- **Esc Key:** Could be enhanced to cancel modal (future improvement)

### Visual Accessibility
- **Color Coding:** Uses multiple indicators (text, icons, badges) not just color
- **Focus Rings:** Inputs show focus ring (focus:ring-2 focus:ring-[#C10230])
- **Contrast:** Text meets WCAG contrast requirements
- **Icon Labels:** Icons paired with text labels for clarity

### Screen Reader Considerations
- **Semantic HTML:** Uses button, input, select elements appropriately
- **Labels:** Form inputs have associated labels
- **Status Messages:** Loading/error/empty states have descriptive text

**Future Enhancement Opportunity:** Add ARIA labels and roles for improved screen reader support.

---

## Future Enhancements

### Potential Improvements
1. **Keyboard Shortcuts:**
   - Enter to confirm selection
   - Esc to cancel
   - Arrow keys to navigate transaction list

2. **Advanced Filters:**
   - Filter by source (AMEX only / Wells Fargo only)
   - Filter by amount range (e.g., $40-$60)
   - Exclude specific vendors

3. **Saved Searches:**
   - Remember last used sort/filter settings
   - Quick filters (e.g., "This month", "Last 30 days")

4. **Bulk Actions:**
   - Select multiple transactions (for split expenses)
   - Mark transactions as "not a match" to exclude from future searches

5. **Performance:**
   - Virtual scrolling for large result sets (>100 items)
   - Debounce search input to reduce re-renders

6. **Context:**
   - Show other expenses that matched similar transactions
   - Display transaction's proximity to Monday.com events

---

## Testing Considerations

### Manual Testing Checklist

**Basic Functionality:**
- [ ] Modal opens with correct expense details in header
- [ ] Transactions load within date range
- [ ] Default sort is "Amount (Closest Match)"
- [ ] Selecting transaction shows checkmark and blue highlight
- [ ] "Confirm Match" calls onSelect with correct transaction
- [ ] "Cancel" calls onCancel without selection

**Filtering:**
- [ ] Search filters by description and vendor
- [ ] Exact amount filter shows only matching amounts
- [ ] Date range controls fetch new data
- [ ] "Reset to ±7 days" restores default range
- [ ] "Clear filters" removes search and amount filter

**Sorting:**
- [ ] All 7 sort options work correctly
- [ ] Sort persists when applying filters
- [ ] Closest match prioritizes exact matches

**Edge Cases:**
- [ ] No transactions found shows empty state
- [ ] Fetch error shows error message and retry button
- [ ] Loading state shows spinner
- [ ] Deselecting current transaction (click again) works
- [ ] Very long descriptions truncate properly

**Responsive:**
- [ ] Layout adapts to mobile screens
- [ ] Filters wrap appropriately on narrow screens
- [ ] Modal is readable and usable on all screen sizes

### Automated Testing Opportunities

```typescript
// Example Playwright tests
describe('BankTransactionPicker', () => {
  test('should sort by closest amount by default', async ({ page }) => {
    // Test that default sort shows closest amounts first
  })

  test('should filter by exact amount when checkbox is checked', async ({ page }) => {
    // Test exact amount filter functionality
  })

  test('should update results when date range changes', async ({ page }) => {
    // Test date range controls trigger new query
  })
})
```

---

## Troubleshooting

### Common Issues

**Issue:** Modal shows "No matching transactions found" when transactions should exist

**Possible Causes:**
1. Transactions outside date range (try expanding range in filters)
2. Transactions already matched (status ≠ 'unmatched')
3. Amount filter too restrictive (disable exact amount filter)
4. Search query too specific (clear search)

**Resolution:** Use "Clear filters" button and expand date range.

---

**Issue:** Transactions not loading (spinner never stops)

**Possible Causes:**
1. Supabase connection issue
2. RLS policy blocking query
3. Network timeout

**Resolution:**
1. Check browser console for error messages
2. Verify Supabase connection in Network tab
3. Click "Try again" button when error appears

---

**Issue:** Wrong sort order displayed

**Possible Causes:**
1. Caching issue in useMemo
2. Incorrect sort logic for edge cases

**Resolution:**
1. Change sort option and change back
2. Close and reopen modal
3. Check browser console for warnings

---

## Related Documentation

- **Review Queue:** `Documentation/web-app-spec.md` - Review Queue section
- **Database Schema:** `Documentation/database-schema.md` - bank_transactions table
- **System Boundaries:** `Documentation/Technical_Docs/SYSTEM_BOUNDARIES.md` - Manual matching workflow
- **Parent Component:** ReviewDetailPanel.tsx - Integration point

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | December 26, 2025 | Initial documentation for enhanced picker with filters/sort |

---

**Maintained by:** Documentation Maintainer Agent
**Component Owners:** Frontend Team
**Last Reviewed:** December 26, 2025

---

*End of BankTransactionPicker Documentation*
