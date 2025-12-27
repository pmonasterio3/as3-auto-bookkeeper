# AS3 Expense Automation - Web Application Specification

**Version:** 1.3
**Last Updated:** December 26, 2025
**Technology Stack:** React 18 + Vite + Tailwind CSS + Supabase

---

## Table of Contents

1. [Overview](#overview)
2. [Technology Stack](#technology-stack)
3. [Project Structure](#project-structure)
4. [Pages & Routes](#pages--routes)
5. [Component Specifications](#component-specifications)
6. [State Management](#state-management)
7. [API Integration](#api-integration)
8. [Authentication](#authentication)
9. [UI/UX Guidelines](#uiux-guidelines)
10. [Build & Deploy](#build--deploy)

---

## Overview

### Purpose

The AS3 Expense Dashboard is a web application for:
- **Reviewing** flagged expenses that require human approval
- **Importing** bank transaction CSV files (AMEX, Wells Fargo)
- **Managing** vendor rules for automatic categorization
- **Viewing** reports and analytics on expense processing

### Users

| Role | Access Level | Primary Actions |
|------|--------------|-----------------|
| Admin (Pablo) | Full access | All features, user management |
| Bookkeeper (Ashley) | Standard access | Review, import, reports |
| Team Members | Limited access | View reports, review queue |

---

## Technology Stack

| Layer | Technology | Version | Purpose |
|-------|------------|---------|---------|
| Framework | React | 18.2+ | UI components |
| Build Tool | Vite | 5.0+ | Fast builds, HMR |
| Styling | Tailwind CSS | 3.4+ | Utility-first CSS |
| State | React Query | 5.0+ | Server state, caching |
| State (Local) | Zustand | 4.5+ | Simple global state |
| Forms | React Hook Form | 7.50+ | Form handling |
| Routing | React Router | 6.20+ | Client-side routing |
| Icons | Lucide React | 0.300+ | Icon library |
| Charts | Recharts | 2.10+ | Data visualization |
| Tables | TanStack Table | 8.10+ | Data tables |
| Backend | Supabase | 2.40+ | Auth, database, storage |
| Hosting | AWS Amplify | - | Static hosting, CDN |

---

## Project Structure

```
expense-dashboard/
├── public/
│   ├── favicon.ico
│   └── manifest.json
│
├── src/
│   ├── main.tsx                    # App entry point
│   ├── App.tsx                     # Root component with routing
│   ├── index.css                   # Global styles + Tailwind
│   │
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Layout.tsx          # Main layout wrapper
│   │   │   ├── Sidebar.tsx         # Navigation sidebar
│   │   │   ├── Header.tsx          # Top header bar
│   │   │   └── UserMenu.tsx        # User dropdown menu
│   │   │
│   │   ├── dashboard/
│   │   │   ├── StatCard.tsx        # Metric display card
│   │   │   ├── RecentActivity.tsx  # Recent expense list
│   │   │   ├── AlertBanner.tsx     # Warning/info banners
│   │   │   └── QuickActions.tsx    # Action buttons
│   │   │
│   │   ├── expenses/
│   │   │   ├── ExpenseTable.tsx    # Data table for expenses
│   │   │   ├── ExpenseRow.tsx      # Table row component
│   │   │   ├── ExpenseDetail.tsx   # Expense detail modal
│   │   │   ├── ExpenseFilters.tsx  # Filter controls
│   │   │   └── ReceiptViewer.tsx   # Receipt image viewer
│   │   │
│   │   ├── review/
│   │   │   ├── ReviewQueue.tsx           # Queue list
│   │   │   ├── ReviewCard.tsx            # Individual review card
│   │   │   ├── BankTransactionPicker.tsx # Enhanced bank transaction matcher with filters/sort
│   │   │   ├── CategoryPicker.tsx        # Category selection
│   │   │   ├── StatePicker.tsx           # State selection
│   │   │   └── ApprovalActions.tsx       # Approve/Correct/Reject buttons
│   │   │
│   │   ├── bank/
│   │   │   ├── TransactionList.tsx # Bank transaction table
│   │   │   ├── CSVUploader.tsx     # Drag-drop upload zone
│   │   │   ├── ImportPreview.tsx   # Preview before import
│   │   │   ├── ColumnMapper.tsx    # Map CSV columns
│   │   │   └── ImportProgress.tsx  # Import progress indicator
│   │   │
│   │   ├── vendors/
│   │   │   ├── VendorRulesTable.tsx   # Rules list
│   │   │   ├── VendorRuleForm.tsx     # Add/edit form
│   │   │   ├── VendorRuleRow.tsx      # Table row
│   │   │   └── VendorRuleTester.tsx   # Test pattern
│   │   │
│   │   ├── reports/
│   │   │   ├── StateBreakdown.tsx     # Expenses by state chart
│   │   │   ├── CategoryBreakdown.tsx  # Expenses by category
│   │   │   ├── MonthlyTrend.tsx       # Monthly totals chart
│   │   │   └── AccuracyMetrics.tsx    # AI accuracy stats
│   │   │
│   │   └── common/
│   │       ├── Button.tsx
│   │       ├── Modal.tsx
│   │       ├── Table.tsx
│   │       ├── Badge.tsx
│   │       ├── Card.tsx
│   │       ├── Input.tsx
│   │       ├── Select.tsx
│   │       ├── Spinner.tsx
│   │       ├── EmptyState.tsx
│   │       └── ErrorBoundary.tsx
│   │
│   ├── pages/
│   │   ├── Dashboard.tsx           # Home page with stats
│   │   ├── ReviewQueue.tsx         # Expense review page
│   │   ├── BankImport.tsx          # CSV import page
│   │   ├── BankTransactions.tsx    # View all bank txns
│   │   ├── VendorRules.tsx         # Manage vendor rules
│   │   ├── Reports.tsx             # Analytics & reports
│   │   ├── Settings.tsx            # App settings
│   │   └── Login.tsx               # Authentication page
│   │
│   ├── hooks/
│   │   ├── useAuth.ts              # Authentication hook
│   │   ├── useExpenses.ts          # Expense CRUD operations
│   │   ├── useBankTransactions.ts  # Bank transaction CRUD
│   │   ├── useVendorRules.ts       # Vendor rules CRUD
│   │   ├── useMondayEvents.ts      # Monday.com events
│   │   ├── useReviewQueue.ts       # Review queue operations
│   │   └── useDashboardStats.ts    # Dashboard statistics
│   │
│   ├── services/
│   │   ├── supabase.ts             # Supabase client config
│   │   ├── auth.ts                 # Auth service functions
│   │   ├── csv-parser.ts           # CSV parsing utilities
│   │   ├── expense-matcher.ts      # Matching algorithms
│   │   └── api.ts                  # API helper functions
│   │
│   ├── types/
│   │   ├── expense.ts              # Expense types
│   │   ├── bank-transaction.ts     # Bank transaction types
│   │   ├── vendor-rule.ts          # Vendor rule types
│   │   ├── monday-event.ts         # Monday event types
│   │   ├── user.ts                 # User types
│   │   └── index.ts                # Type exports
│   │
│   ├── utils/
│   │   ├── date-helpers.ts         # Date formatting
│   │   ├── currency-format.ts      # Currency formatting
│   │   ├── state-codes.ts          # State code mappings
│   │   ├── category-helpers.ts     # Category logic
│   │   └── cn.ts                   # Tailwind class merge
│   │
│   └── store/
│       ├── authStore.ts            # Auth state
│       └── uiStore.ts              # UI state (sidebar, modals)
│
├── package.json
├── vite.config.ts
├── tailwind.config.js
├── tsconfig.json
├── .env.example
└── README.md
```

---

## Pages & Routes

### Route Configuration

```typescript
// App.tsx
const routes = [
    { path: '/', element: <Dashboard />, protected: true },
    { path: '/review', element: <ReviewQueue />, protected: true },
    { path: '/orphans', element: <OrphanQueue />, protected: true },
    { path: '/reimbursements', element: <ReimbursementQueue />, protected: true },
    { path: '/import', element: <BankImport />, protected: true },
    { path: '/transactions', element: <BankTransactions />, protected: true },
    { path: '/vendors', element: <VendorRules />, protected: true },
    { path: '/reports', element: <Reports />, protected: true },
    { path: '/settings', element: <Settings />, protected: true },
    { path: '/login', element: <Login />, protected: false },
];
```

### Three Distinct Review Queues

| Queue | Route | Purpose | Data Source |
|-------|-------|---------|-------------|
| **Review Queue** | `/review` | Zoho expenses flagged during queue processing | `zoho_expenses` (status='flagged') + legacy `expense_queue` |
| **Orphan Queue** | `/orphans` | Bank transactions with no Zoho expense after 5 days | `bank_transactions` (status='unmatched') |
| **Reimbursement Queue** | `/reimbursements` | Zoho expenses with no bank match (personal card) | `expense_queue` (is_reimbursement=true) |

**Note:** As of December 2025, the Review Queue fetches from **both** the new `zoho_expenses` table (queue-based architecture v3.0) and the legacy `expense_queue` table. The `zoho_expenses` table is the primary source for new expenses processed via the queue controller.

### Page Specifications

#### Dashboard (`/`)

**Purpose:** Overview of system status and pending items across all three queues

**Layout:**
```
┌────────────────────────────────────────────────────────────────┐
│ Header: AS3 Expense Dashboard                      [User Menu] │
├────────────────────────────────────────────────────────────────┤
│ Sidebar │                Main Content                          │
│         │                                                      │
│ [Dashboard]  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────┐│
│ [Review] │ Pending  │ │ Orphan   │ │Reimburse│ │ This    ││
│ [Orphans]│ Reviews  │ │Bank Txns│ │ ments   │ │ Week    ││
│ [Reimb.] │   12     │ │   8     │ │    3    │ │  $4,521 ││
│ [Import] └──────────┘ └──────────┘ └──────────┘ └─────────┘│
│ [Trans.] │                                                      │
│ [Vendors]│ ┌─────────────────────────────────────────────────┐ │
│ [Reports]│ │ [!] 12 expenses pending review                  │ │
│ [Settings]│ │ [!] 8 orphan bank txns need categorization     │ │
│         │ │ [!] 3 reimbursements awaiting approval           │ │
│         │ └─────────────────────────────────────────────────┘ │
│         │                                                      │
│         │ ┌─────────────────────────────────────────────────┐ │
│         │ │ Recent Activity                                  │ │
│         │ │ • Fuel - COS $52.96 - Processed (CA)             │ │
│         │ │ • Travel $189.00 - Queued for review             │ │
│         │ │ • Office Supplies $34.99 - Processed (Admin)     │ │
│         │ │ • Orphan SHELL $45.00 - Categorized (TX)         │ │
│         │ └─────────────────────────────────────────────────┘ │
│         │                                                      │
│         │ [Quick Actions: Import CSV | Review | Orphans]       │
└─────────┴──────────────────────────────────────────────────────┘
```

**Data Requirements:**
- `dashboard_stats` view for counts:
  - pending_reviews (expense_queue WHERE is_reimbursement=false AND status='pending')
  - pending_reimbursements (expense_queue WHERE is_reimbursement=true AND status='pending')
  - orphan_bank_txns (bank_transactions WHERE status='unmatched' AND age > 5 days)
  - processed_today, amount_this_week
- Recent `categorization_history` (limit 10)
- Alert banners for each non-zero queue

---

#### Review Queue (`/review`)

**Purpose:** Human review of flagged expenses

**Layout:**
```
┌────────────────────────────────────────────────────────────┐
│ Review Queue (12 pending)                    [Filters ▼]    │
├────────────────────────────────────────────────────────────┤
│                                                             │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ EXPENSE CARD                                   [Expand] │ │
│ │ Aho LLC - $52.96 - Dec 06, 2024                         │ │
│ │ Category: Fuel - COS | State: CA | Confidence: 78%      │ │
│ │ Flag: No bank transaction match found                   │ │
│ │                                                         │ │
│ │ [Suggested Match: AMEX *1002 - $52.96 - Dec 06]         │ │
│ │                                                         │ │
│ │ [Approve] [Correct] [Reject] [Skip]                     │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ EXPENSE CARD (expanded)                                 │ │
│ │ ┌─────────────┐  ┌─────────────────────────────────────┐│ │
│ │ │   RECEIPT   │  │ Details                             ││ │
│ │ │   [Image]   │  │ Merchant: Aho LLC                   ││ │
│ │ │             │  │ Date: Dec 06, 2024                  ││ │
│ │ │             │  │ Amount: $52.96                      ││ │
│ │ │             │  │ Category: Fuel - COS                ││ │
│ │ └─────────────┘  │ Paid via: AMEX Business 61002      ││ │
│ │                  └─────────────────────────────────────┘│ │
│ │                                                         │ │
│ │ Bank Transaction Match:                                 │ │
│ │ ┌─────────────────────────────────────────────────────┐ │ │
│ │ │ ○ AMEX - $52.96 - Dec 06 - "AHO LLC FUEL"          │ │ │
│ │ │ ○ AMEX - $53.50 - Dec 05 - "SHELL OIL"             │ │ │
│ │ │ ○ No match (manual entry)                           │ │ │
│ │ └─────────────────────────────────────────────────────┘ │ │
│ │                                                         │ │
│ │ Category: [Fuel - COS ▼]  State: [CA ▼]                │ │
│ │                                                         │ │
│ │ [Approve & Post to QBO] [Save Correction] [Reject]      │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

**Data Requirements:**
- `expense_queue` WHERE status = 'pending'
- `bank_transactions` WHERE status = 'unmatched' (for matching)
- `qbo_accounts` (for category dropdown)

**Actions:**
- **Approve:** Update expense_queue.status → 'approved', trigger QBO posting
- **Correct:** Update expense_queue with corrections, status → 'corrected'
- **Reject:** Update expense_queue.status → 'rejected'

**zoho_expenses Items (Queue-Based Architecture v3.0):**

For items from the `zoho_expenses` table (flagged during queue processing):

- **Match Confidence Display:** Visual progress bar showing confidence percentage (green ≥95%, amber ≥70%, red <70%)
- **Processing Attempts:** Counter shown when item has been retried more than once
- **Available Actions:**
  - **Approve:** If no changes needed, mark as approved (status → 'posted')
  - **Save & Resubmit:** Apply corrections (state_tag, category_name) and reset status → 'pending' for reprocessing
  - **Resubmit:** Reset status → 'pending' without changes to retry processing
  - **Reject:** Mark as rejected (status → 'rejected')
  - **Create Vendor Rule:** Optionally create vendor rule from corrections

**Receipt Display:** Receipts stored in Supabase Storage bucket `expense-receipts` are displayed via signed URLs (1-hour expiry).

**Resubmit Flow:**
1. User corrects state/category in UI
2. Clicks "Save & Resubmit"
3. Updates zoho_expenses row with corrections
4. Resets status to 'pending', clears processing_started_at and last_error
5. Queue controller picks up expense for reprocessing
6. n8n applies corrected values during processing

---

#### Orphan Queue (`/orphans`)

**Purpose:** Review and categorize bank transactions that have no matching Zoho expense

**When transactions appear here:**
- Bank transaction status = 'unmatched'
- transaction_date < current_date - 5 days (grace period expired)

**Layout:**
```
┌────────────────────────────────────────────────────────────────┐
│ Orphan Bank Transactions (8 pending)         [Process All] [?] │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│ ┌─────────────────────────────────────────────────────────────┐│
│ │ SHELL OIL 12345 FRESNO CA XXXX1044         Dec 01 | $45.67  ││
│ │                                                             ││
│ │ AI Suggestion:                                              ││
│ │   Category: Fuel - COS                                      ││
│ │   State: CA (parsed from description)                       ││
│ │   Method: description_parsing                               ││
│ │                                                             ││
│ │ Category: [Fuel - COS ▼]      State: [CA ▼]                ││
│ │ Monday Event: [C24 - EVOC - CL - Dec 01-02 ▼] (optional)   ││
│ │                                                             ││
│ │ [Approve & Post to QBO]     [Exclude]     [Skip]           ││
│ └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│ ┌─────────────────────────────────────────────────────────────┐│
│ │ MICROSOFT*365 MSBILL.INFO WA XXXX6323      Nov 28 | $31.50  ││
│ │                                                             ││
│ │ AI Suggestion:                                              ││
│ │   Category: Office - Business Expenses                      ││
│ │   State: Admin (known vendor, non-location-specific)        ││
│ │   Method: vendor_rules                                      ││
│ │                                                             ││
│ │ [Approve & Post to QBO]     [Exclude]     [Skip]           ││
│ └─────────────────────────────────────────────────────────────┘│
└────────────────────────────────────────────────────────────────┘
```

**Data Requirements:**
- `bank_transactions` WHERE status='unmatched' AND transaction_date < NOW()-5 days
- `vendor_rules` for suggestion matching
- `monday_events` for course attribution (if COS category selected)
- `qbo_accounts` for category dropdown

**Actions:**
- **Approve:**
  - Update bank_transactions status → 'orphan_processed'
  - Set orphan_category, orphan_state, orphan_determination_method
  - POST to QBO
  - Create Monday.com subitem if COS
- **Exclude:**
  - Update bank_transactions status → 'excluded'
  - (Not a business expense - transfers, personal, etc.)
- **Skip:** Leave for later review

**State Determination Waterfall (shown as badges):**
1. vendor_rules.default_state → Green badge: "Rule Match"
2. Parsed from description → Blue badge: "Parsed"
3. Course date proximity → Yellow badge: "Course Nearby"
4. Cannot determine → Red badge: "Manual"

---

#### Reimbursement Queue (`/reimbursements`)

**Purpose:** Process Zoho expenses that have no bank transaction match (employee used personal card)

**When expenses appear here:**
- expense_queue WHERE is_reimbursement = true AND status = 'pending'

**Layout:**
```
┌────────────────────────────────────────────────────────────────┐
│ Reimbursements Pending (3)                    [Export to CSV]  │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│ ┌─────────────────────────────────────────────────────────────┐│
│ │ EXPENSE: Home Depot - $89.45 - Dec 03, 2024                 ││
│ │ Employee: Pablo Ortiz-Monasterio                            ││
│ │ Report: C24 - EVOC - TMS - Dec 02-03                        ││
│ │                                                             ││
│ │ ┌──────────────────┐  Category: Supplies & Materials - COS  ││
│ │ │    [RECEIPT]     │  State: TX (from report venue)         ││
│ │ │    thumbnail     │  Receipt Amount: $89.45 ✓              ││
│ │ └──────────────────┘                                        ││
│ │                                                             ││
│ │ No bank match found. This appears to be a personal card    ││
│ │ purchase requiring reimbursement.                           ││
│ │                                                             ││
│ │ Reimbursement Method: [Check ▼]                             ││
│ │ Reference (optional): [Check #1234_____]                    ││
│ │                                                             ││
│ │ [Approve for Reimbursement]  [Reject]  [Skip]               ││
│ └─────────────────────────────────────────────────────────────┘│
│                                                                 │
└────────────────────────────────────────────────────────────────┘
```

**Data Requirements:**
- `expense_queue` WHERE is_reimbursement=true AND status='pending'
- Receipt images from Zoho
- Report context for state determination

**Actions:**
- **Approve for Reimbursement:**
  - Update expense_queue status → 'approved'
  - Set reimbursement_method, reimbursement_reference
  - POST to QBO as expense (no bank link)
  - Marked for reimbursement tracking
- **Reject:**
  - Update expense_queue status → 'rejected'
  - Not a valid expense
- **Skip:** Leave for later review

**Reimbursement Methods:**
- Check
- Zelle
- Payroll deduction
- ACH transfer

---

#### Bank Import (`/import`)

**Purpose:** Upload bank transaction CSV files exported from QuickBooks Online

**Layout:**
```
┌────────────────────────────────────────────────────────────┐
│ Import Bank Transactions                                    │
├────────────────────────────────────────────────────────────┤
│                                                             │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │                                                         │ │
│ │     ┌───────────────────────────────────────────┐       │ │
│ │     │                                           │       │ │
│ │     │    Drag & drop CSV file here             │       │ │
│ │     │         or click to browse               │       │ │
│ │     │                                           │       │ │
│ │     │    QuickBooks Online CSV Export          │       │ │
│ │     │                                           │       │ │
│ │     └───────────────────────────────────────────┘       │ │
│ │                                                         │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ PREVIEW (after file upload):                                │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Source: AMEX Business 61002 (auto-detected)              │ │
│ │ Total rows in file: 50                                   │ │
│ │ Transactions to import: 42                               │ │
│ │                                                         │ │
│ │ Skipped rows:                                            │ │
│ │ - Income/refunds (RECEIVED has value): 5                 │ │
│ │ - Invalid dates: 2                                       │ │
│ │ - No valid amount: 1                                     │ │
│ │                                                         │ │
│ │ Date Range: Nov 01, 2024 - Nov 30, 2024                  │ │
│ │ Total amount: $8,543.67                                  │ │
│ │                                                         │ │
│ │ Sample transactions:                                     │ │
│ │ Date    | Description           | Amount  | State       │ │
│ │ Nov 30  | SHELL OIL FRESNO CA  | $45.67  | CA          │ │
│ │ Nov 29  | MARRIOTT DALLAS TX   | $189.00 | TX          │ │
│ │ Nov 28  | MICROSOFT*365 WA     | $31.50  | Admin       │ │
│ │ ...                                                     │ │
│ │                                                         │ │
│ │ Parse errors:                                            │ │
│ │ - Row 15: Invalid date "Nov 32, 2024"                    │ │
│ │ - Row 23: Cannot parse date "TBD"                        │ │
│ │                                                         │ │
│ │ [Cancel] [Import 42 Transactions]                        │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

**Data Flow:**
1. User selects bank account from dropdown (AMEX, Wells Fargo, etc.)
2. User drops CSV file
3. Parse CSV with case-insensitive header matching
4. Auto-detect CSV format from headers (QBO export format)
5. Filter out income rows (RECEIVED column has value)
6. Parse dates, amounts, extract vendors from descriptions
7. Show detailed preview with:
   - Valid transactions to import
   - Skipped rows breakdown
   - Parse errors with row numbers
   - Sample transactions
8. On confirm, batch insert with duplicate detection
9. Show result summary (success/duplicate/failed counts)

**Note:** The CSV format is auto-detected from column headers. There is no manual format selection dropdown - the parser intelligently identifies the format.

---

#### Vendor Rules (`/vendors`)

**Purpose:** Manage automatic categorization patterns

**Layout:**
```
┌────────────────────────────────────────────────────────────┐
│ Vendor Rules (45 patterns)                   [+ Add Rule]   │
├────────────────────────────────────────────────────────────┤
│                                                             │
│ [Search patterns...]                                        │
│                                                             │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Pattern      | Category         | State | Matches | Edit │ │
│ │─────────────────────────────────────────────────────────│ │
│ │ shell        | Fuel - COS       | -     | 23      | ✏️   │ │
│ │ marriott     | Travel - COS     | -     | 12      | ✏️   │ │
│ │ office depot | Office Supplies  | Admin | 8       | ✏️   │ │
│ │ hertz        | Vehicle - COS    | -     | 15      | ✏️   │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ TEST PATTERN:                                               │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Vendor name: [SHELL OIL 12345______]                     │ │
│ │                                                         │ │
│ │ Match: "shell" → Fuel - COS                             │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

---

#### Reports (`/reports`)

**Purpose:** Analytics and export

**Charts:**
1. **Expenses by State** (pie chart)
2. **Expenses by Category** (bar chart)
3. **Monthly Trend** (line chart)
4. **AI Accuracy** (gauge showing % auto-approved vs corrected)

**Filters:**
- Date range
- State
- Category
- COS/Non-COS

---

## Component Specifications

### ReviewCard Component

```typescript
// src/components/review/ReviewCard.tsx

interface ReviewCardProps {
    expense: ExpenseQueueItem;
    bankTransactions: BankTransaction[];
    onApprove: (expenseId: string, bankTxnId?: string) => Promise<void>;
    onCorrect: (expenseId: string, corrections: Corrections) => Promise<void>;
    onReject: (expenseId: string, reason: string) => Promise<void>;
}

interface ExpenseQueueItem {
    id: string;
    zoho_expense_id: string;
    zoho_report_name: string;
    vendor_name: string;
    amount: number;
    expense_date: string;
    category_suggested: string;
    state_suggested: string;
    confidence_score: number;
    flag_reason: string;
    receipt_url: string;
    suggested_bank_txn_id: string | null;
    original_data: Record<string, any>;
}

interface Corrections {
    category?: string;
    state?: string;
    bank_txn_id?: string;
    notes?: string;
}
```

### BankTransactionPicker Component

**Full Documentation:** See `Documentation/Technical_Docs/BANK_TRANSACTION_PICKER.md` for comprehensive details.

**Summary:** Modal component for searching, filtering, and selecting bank transactions during manual expense matching. Features advanced filtering (date range, exact amount), sorting (7 options), and real-time search.

```typescript
// src/features/review/components/BankTransactionPicker.tsx

interface BankTransactionPickerProps {
    expenseAmount: number;           // For amount comparison and sorting
    expenseDate: string;             // For default date range calculation
    expenseVendor: string;           // Displayed in modal header
    currentBankTxnId?: string | null; // Pre-selected transaction (if any)
    onSelect: (txn: BankTransaction | null) => void; // Selection callback
    onCancel: () => void;            // Cancel callback
}
```

**Key Features:**
- **Sorting:** Amount (closest), Date (newest/oldest), Amount (high/low), Vendor (A-Z/Z-A)
- **Filters:** Date range (adjustable, default ±7 days), Exact amount match, Text search
- **Visual Indicators:** Exact match badges, amount difference display, source badges
- **Performance:** Uses explicit column selection, useMemo for filtering/sorting
- **Error Handling:** Retry button on fetch errors, clear empty state messaging

**Integration:** Used in ReviewDetailPanel for flagged expenses needing manual bank transaction matching.

### CSVUploader Component

```typescript
// src/components/bank/CSVUploader.tsx

interface CSVUploaderProps {
    onFileSelect: (file: File) => void;
    onParse: (data: ParsedCSV) => void;
    isLoading: boolean;
}

interface ParsedCSV {
    source: 'amex' | 'wells_fargo';
    transactions: ParsedTransaction[];
    dateRange: { start: string; end: string };
}

interface ParsedTransaction {
    transaction_date: string;
    post_date: string;
    description: string;
    amount: number;
    reference_number: string;
    card_last_four?: string;
    isDuplicate: boolean;
}
```

---

## State Management

### React Query for Server State

```typescript
// src/hooks/useExpenses.ts

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../services/supabase';

export function useReviewQueue() {
    return useQuery({
        queryKey: ['expense-queue', 'pending'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('expense_queue')
                .select('*')
                .eq('status', 'pending')
                .order('created_at', { ascending: false });

            if (error) throw error;
            return data;
        },
        refetchInterval: 30000, // Refetch every 30 seconds
    });
}

export function useApproveExpense() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ expenseId, bankTxnId }: { expenseId: string; bankTxnId?: string }) => {
            // Update expense_queue
            const { error: expenseError } = await supabase
                .from('expense_queue')
                .update({
                    status: 'approved',
                    reviewed_at: new Date().toISOString(),
                    reviewed_by: (await supabase.auth.getUser()).data.user?.email,
                })
                .eq('id', expenseId);

            if (expenseError) throw expenseError;

            // Update bank_transaction if matched
            if (bankTxnId) {
                const { error: bankError } = await supabase
                    .from('bank_transactions')
                    .update({
                        status: 'matched',
                        matched_expense_id: expenseId,
                        matched_at: new Date().toISOString(),
                        matched_by: 'human',
                    })
                    .eq('id', bankTxnId);

                if (bankError) throw bankError;
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['expense-queue'] });
            queryClient.invalidateQueries({ queryKey: ['bank-transactions'] });
            queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
        },
    });
}
```

### Zustand for UI State

```typescript
// src/store/uiStore.ts

import { create } from 'zustand';

interface UIState {
    sidebarOpen: boolean;
    selectedExpenseId: string | null;
    modalOpen: { type: string; data?: any } | null;

    toggleSidebar: () => void;
    selectExpense: (id: string | null) => void;
    openModal: (type: string, data?: any) => void;
    closeModal: () => void;
}

export const useUIStore = create<UIState>((set) => ({
    sidebarOpen: true,
    selectedExpenseId: null,
    modalOpen: null,

    toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
    selectExpense: (id) => set({ selectedExpenseId: id }),
    openModal: (type, data) => set({ modalOpen: { type, data } }),
    closeModal: () => set({ modalOpen: null }),
}));
```

---

## API Integration

### Supabase Client Configuration

```typescript
// src/services/supabase.ts

import { createClient } from '@supabase/supabase-js';
import type { Database } from '../types/database';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
    },
});
```

### Environment Variables

```env
# .env.example

VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_APP_NAME=AS3 Expense Dashboard
```

---

## Authentication

### Auth Flow

```typescript
// src/hooks/useAuth.ts

import { useEffect, useState } from 'react';
import { supabase } from '../services/supabase';
import type { User, Session } from '@supabase/supabase-js';

export function useAuth() {
    const [user, setUser] = useState<User | null>(null);
    const [session, setSession] = useState<Session | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Get initial session
        supabase.auth.getSession().then(({ data: { session } }) => {
            setSession(session);
            setUser(session?.user ?? null);
            setLoading(false);
        });

        // Listen for auth changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            (_event, session) => {
                setSession(session);
                setUser(session?.user ?? null);
            }
        );

        return () => subscription.unsubscribe();
    }, []);

    const signIn = async (email: string, password: string) => {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
    };

    const signOut = async () => {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
    };

    return { user, session, loading, signIn, signOut };
}
```

### Protected Routes

```typescript
// src/components/ProtectedRoute.tsx

import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { Spinner } from './common/Spinner';

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
    const { user, loading } = useAuth();

    if (loading) {
        return <Spinner />;
    }

    if (!user) {
        return <Navigate to="/login" replace />;
    }

    return <>{children}</>;
}
```

---

## UI/UX Guidelines

### Color Palette

```css
/* Tailwind config colors */
colors: {
    primary: {
        50: '#f0f9ff',
        500: '#0ea5e9',
        600: '#0284c7',
        700: '#0369a1',
    },
    success: '#22c55e',
    warning: '#f59e0b',
    error: '#ef4444',
    gray: { /* Default Tailwind grays */ }
}
```

### Status Badges

| Status | Color | Use |
|--------|-------|-----|
| Pending | Yellow | Awaiting review |
| Approved | Green | Approved, posting to QBO |
| Corrected | Blue | Approved with changes |
| Rejected | Red | Rejected, not posting |
| Matched | Green | Bank txn matched |
| Unmatched | Yellow | Bank txn awaiting match |
| Excluded | Gray | Bank txn excluded |

### Responsive Breakpoints

| Breakpoint | Width | Layout |
|------------|-------|--------|
| Mobile | < 768px | Sidebar hidden, stacked cards |
| Tablet | 768-1024px | Collapsed sidebar |
| Desktop | > 1024px | Full sidebar |

---

## Build & Deploy

### Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Run on http://localhost:5173
```

### Production Build

```bash
# Build for production
npm run build

# Preview production build
npm run preview
```

### AWS Amplify Deployment

See `deployment-guide.md` for detailed AWS Amplify configuration.

---

## TypeScript Types

### Complete Type Definitions

```typescript
// src/types/expense.ts

export interface ExpenseQueueItem {
    id: string;
    zoho_expense_id: string;
    zoho_report_id: string | null;
    zoho_report_name: string | null;
    status: 'pending' | 'approved' | 'corrected' | 'rejected' | 'auto_processed';
    vendor_name: string;
    amount: number;
    expense_date: string;
    category_name: string | null;
    paid_through: string | null;
    receipt_url: string | null;
    category_suggested: string | null;
    state_suggested: string | null;
    confidence_score: number | null;
    flag_reason: string | null;
    suggested_bank_txn_id: string | null;
    alternate_bank_txn_ids: string[] | null;

    // Reimbursement tracking (no bank match = personal card)
    is_reimbursement: boolean;
    reimbursement_method: 'check' | 'zelle' | 'payroll' | 'ach' | null;
    reimbursement_reference: string | null;
    reimbursed_at: string | null;
    reimbursed_by: string | null;

    reviewed_by: string | null;
    reviewed_at: string | null;
    corrections: Corrections | null;
    original_data: Record<string, any> | null;
    created_at: string;
    updated_at: string;
}

export interface Corrections {
    category?: string;
    state?: string;
    bank_txn_id?: string;
    monday_event_id?: string;
    notes?: string;
}

// src/types/bank-transaction.ts

export interface BankTransaction {
    id: string;
    source: 'amex' | 'wells_fargo';
    card_last_four: string | null;
    reference_number: string | null;
    transaction_date: string;
    post_date: string | null;
    description: string;
    amount: number;

    // Parsed fields (extracted at import time)
    extracted_vendor: string | null;
    extracted_state: string | null;
    description_normalized: string | null;

    // Matching status
    status: 'unmatched' | 'matched' | 'excluded' | 'orphan_processed' | 'manual_entry';
    matched_expense_id: string | null;
    matched_at: string | null;
    matched_by: 'agent' | 'human' | null;
    match_confidence: number | null;

    // Orphan processing (bank txn with no Zoho expense)
    orphan_category: string | null;
    orphan_state: string | null;
    orphan_determination_method: 'vendor_rules' | 'description_parsing' | 'course_proximity' | 'human' | null;
    orphan_processed_at: string | null;

    // Downstream system IDs
    qbo_purchase_id: string | null;
    monday_subitem_id: string | null;
    import_batch_id: string | null;
    created_at: string;
    updated_at: string;
}

// src/types/vendor-rule.ts

export interface VendorRule {
    id: string;
    vendor_pattern: string;
    default_category: string | null;
    default_state: string | null;
    notes: string | null;
    match_count: number;
    last_matched_at: string | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
}
```

---

*End of Web Application Specification*
