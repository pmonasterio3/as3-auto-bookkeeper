# AS3 Auto Bookkeeper

Automated expense processing system for AS3 Driver Training that matches bank transactions to Zoho Expense submissions, determines state attribution for tax compliance, and posts to QuickBooks Online.

---

## Quick Start

### For Developers

**BEFORE making ANY changes, read these documents IN ORDER:**

1. **CLAUDE.md** (Project conventions and coding standards)
2. **Documentation/Technical_Docs/SYSTEM_BOUNDARIES.md** (Component responsibilities)
3. **Documentation/Technical_Docs/TRUTH_SOURCE.md** (Data source authority)
4. **Documentation/expense-automation-architecture.md** (System design overview)

### For Users

- **User Guide:** `Documentation/user-guide.md`
- **CSV Import Instructions:** `Documentation/csv-format-spec.md`

---

## System Overview

### The Problem

AS3 Driver Training operates across 7 U.S. states (CA, TX, CO, WA, NJ, FL, MT). Expenses were being incorrectly attributed to California, causing tax overpayment. Manual categorization of hundreds of monthly expenses was time-consuming and error-prone.

### The Solution

An automated system that:

1. **Imports bank transactions** as the source of truth (AMEX, Wells Fargo)
2. **Matches Zoho Expense submissions** to bank transactions
3. **Determines state attribution** via Zoho tags or Monday.com course locations
4. **Handles orphan transactions** (no Zoho expense) via vendor rules
5. **Identifies reimbursements** (personal card expenses)
6. **Posts to QuickBooks Online** for accounting
7. **Tracks course-level expenses** in Monday.com
8. **Learns from corrections** to improve over time

### Architecture

```
Bank CSV Import (Web App)
    ↓
bank_transactions table (source of truth)
    ↓
n8n Workflow (Zoho webhook)
    ↓
Match to bank transaction + Determine state
    ↓
High confidence (≥95%) → QBO + Monday.com
Low confidence (<95%) → Human review queue
```

**Key Principle:** Bank transactions are immutable truth. Zoho expenses MATCH TO bank records, not the other way around.

---

## Project Structure

```
as3-auto-bookkeeper/
├── Documentation/
│   ├── Technical_Docs/
│   │   ├── SYSTEM_BOUNDARIES.md      ← Component responsibilities (READ THIS!)
│   │   └── TRUTH_SOURCE.md            ← Data source authority
│   ├── expense-automation-architecture.md
│   ├── database-schema.md
│   ├── n8n-workflow-spec.md
│   ├── web-app-spec.md
│   ├── api-integration-guide.md
│   ├── deployment-guide.md
│   ├── csv-format-spec.md
│   ├── user-guide.md
│   └── GOALS.md
├── expense-dashboard/                 ← React web app
│   ├── src/
│   │   ├── features/dashboard/
│   │   │   └── BankFeedPanel.tsx      ← CSV import component
│   │   ├── types/database.ts
│   │   └── lib/supabase.ts
│   └── package.json
├── sample_files/                      ← Sample CSVs and webhook payloads
├── CLAUDE.md                          ← Project conventions
└── README.md                          ← This file
```

---

## Technology Stack

- **Web App:** React (TypeScript) + Vite + Tailwind CSS
- **Database:** Supabase (PostgreSQL)
- **Automation:** n8n workflows
- **AI:** Claude (Anthropic API) for pattern recognition
- **External APIs:** Zoho Expense, QuickBooks Online, Monday.com
- **Hosting:** AWS Amplify (web app), Supabase Cloud (database)

---

## Critical Architectural Rules

### 1. Bank Transactions are Source of Truth

Every corporate card expense MUST have exactly one `bank_transactions` record. This is the anchor for all processing.

**See:** `Documentation/Technical_Docs/TRUTH_SOURCE.md`

### 2. Component Separation of Concerns

| Component | Does | Does NOT Do |
|-----------|------|-------------|
| **Web App** | Import CSV, display data, human review UI | Matching, state assignment, categorization |
| **n8n** | Match expenses, determine state, post to QBO | Store data (only updates results) |
| **Supabase** | Store facts, enforce constraints | Business logic, decisions |

**See:** `Documentation/Technical_Docs/SYSTEM_BOUNDARIES.md`

### 3. State Assignment Authority

States are NEVER guessed. Sources in priority order:

1. Zoho "Course Location" tag (for Non-COS)
2. Monday.com event venue (for COS)
3. Vendor rules (for orphans)
4. Human review (last resort)

**The web app has NO access to Zoho data during import, therefore CANNOT determine state.**

**See:** `Documentation/Technical_Docs/SYSTEM_BOUNDARIES.md` Section: "State Assignment Responsibilities"

---

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- Supabase account (free tier OK for development)
- n8n instance (cloud or self-hosted)
- Access to AS3 Zoho Expense, QBO, Monday.com accounts

### Local Development Setup

1. **Clone repository:**
   ```bash
   git clone <repository-url>
   cd as3-auto-bookkeeper
   ```

2. **Install dependencies:**
   ```bash
   cd expense-dashboard
   npm install
   ```

3. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your Supabase credentials
   ```

4. **Run database migrations:**
   - Open Supabase SQL Editor
   - Run script from `Documentation/database-schema.md` Section: "Migration Script"

5. **Start dev server:**
   ```bash
   npm run dev
   ```

6. **Test CSV import:**
   - Use sample files from `sample_files/`
   - Import via Bank Feed Panel
   - Verify transactions appear in Supabase

### Deployment

See `Documentation/deployment-guide.md` for full deployment instructions.

---

## Common Tasks

### Import Bank Transactions

1. Export transactions from QuickBooks Online (Banking tab)
2. File → Export → CSV (DATE, DESCRIPTION, SPENT, RECEIVED format)
3. Upload via web app Bank Feed Panel
4. Review preview, confirm import

**See:** `Documentation/csv-format-spec.md`

### Review Flagged Expenses

1. Navigate to Review Queue in web app
2. View suggested matches side-by-side
3. Approve, correct, or reject each item
4. System learns from corrections (updates vendor_rules)

### Add Vendor Rule

1. Navigate to Vendor Rules page
2. Click "Add Rule"
3. Enter vendor pattern (e.g., "CHEVRON")
4. Set default category (e.g., "Fuel - COS")
5. Set default state (if vendor is always same location) OR leave blank
6. Save

### Process Orphan Transactions

Orphans are bank transactions with no matching Zoho expense after 5 days.

**Automatic processing:**
- n8n runs daily orphan flow
- Uses vendor rules + description parsing
- Posts to QBO if confident, otherwise queues for review

**Manual processing:**
- View Orphan Queue in web app
- Assign category and state
- Approve to post to QBO

---

## Testing

### Web App

```bash
cd expense-dashboard
npm run build          # Must succeed before commit
npm run dev            # Local development server
```

Test CSV import with files from `sample_files/`:
- `sample_amex_qbo_export.csv`
- `sample_wells_fargo_qbo_export.csv`

### n8n Workflows

1. Use "Manual Trigger" node for testing
2. Load sample payload from `sample_files/sample_zoho_webhook_payload.json`
3. Step through workflow execution
4. Verify Supabase updates occur
5. Check QBO sandbox for Purchase creation

---

## Troubleshooting

### Import fails with "No valid transactions"

**Cause:** CSV format not recognized or all rows skipped

**Fix:**
- Verify CSV has headers: DATE, DESCRIPTION, SPENT, RECEIVED
- Check that amount columns contain numbers (not blank)
- Ensure dates are in MM/DD/YYYY format

### Duplicate transactions on import

**Expected behavior.** Unique constraint prevents duplicates. Import will skip them and report count.

### Expense not matching to bank transaction

**Causes:**
- Amount differs by >$1
- Date differs by >3 days
- Bank transaction already matched to different expense

**Fix:**
- Review in expense_queue
- Manually select correct bank transaction
- Approve match

### State showing as "Unknown"

**Causes:**
- Zoho "Course Location" tag not set
- Monday event not found for COS expense
- Vendor has no default_state rule

**Fix:**
- Review in expense_queue
- Manually assign state
- System will learn for next time

---

## Documentation Index

### Must-Read (Before Making Changes)

1. **CLAUDE.md** - Project conventions, coding standards
2. **Documentation/Technical_Docs/SYSTEM_BOUNDARIES.md** - Component responsibilities
3. **Documentation/Technical_Docs/TRUTH_SOURCE.md** - Data source authority

### Architecture and Design

- **Documentation/expense-automation-architecture.md** - System overview, data flow
- **Documentation/database-schema.md** - Table structures, RLS policies
- **Documentation/n8n-workflow-spec.md** - Workflow specifications
- **Documentation/web-app-spec.md** - React app component specs

### User Documentation

- **Documentation/user-guide.md** - How to use the web app
- **Documentation/csv-format-spec.md** - CSV format requirements

### Integration Documentation

- **Documentation/api-integration-guide.md** - External API details
- **Documentation/deployment-guide.md** - Deployment procedures

### Business Documentation

- **Documentation/GOALS.md** - Business objectives and success criteria

---

## Contributing

### Before Committing

1. Read `CLAUDE.md` for conventions
2. Read `SYSTEM_BOUNDARIES.md` to ensure your change respects component boundaries
3. Run `npm run build` (must succeed)
4. Test with sample files
5. Update documentation if architecture changed

### Commit Message Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Examples:**
```
feat(import): add Wells Fargo direct CSV support
fix(matching): prevent duplicate expense matching
docs(boundaries): clarify state assignment waterfall
```

---

## Support

- **Questions:** Check `Documentation/` first, then ask Pablo
- **Bugs:** Open GitHub issue with `bug` label
- **Documentation Issues:** Open GitHub issue with `docs` label

---

## License

Proprietary - AS3 Driver Training LLC

---

## Credits

**Designed and built by:** Pablo Ortiz-Monasterio with assistance from Claude (Anthropic)

**Version:** 1.0
**Last Updated:** December 7, 2025

---

**Remember:** Bank transactions are truth. Zoho expenses match to them. n8n interprets. Humans review. System learns.
