# AS3 Expense Dashboard - User Guide

**Version:** 1.0
**Last Updated:** December 6, 2025
**Audience:** AS3 Team Members (Pablo, Ashley, Team)

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Dashboard Overview](#dashboard-overview)
3. [Reviewing Expenses](#reviewing-expenses)
4. [Importing Bank Transactions](#importing-bank-transactions)
5. [Managing Vendor Rules](#managing-vendor-rules)
6. [Viewing Reports](#viewing-reports)
7. [Troubleshooting](#troubleshooting)
8. [FAQ](#faq)

---

## Getting Started

### Logging In

1. Navigate to the AS3 Expense Dashboard URL (provided by admin)
2. Enter your email and password
3. Click **Sign In**

If you don't have an account, contact Pablo to create one.

### First-Time Setup

When you first log in, you'll see the Dashboard with:
- **Pending Reviews** - Expenses waiting for your approval
- **Unmatched Bank Transactions** - Bank transactions that need matching
- **Today's Activity** - What's been processed today

---

## Dashboard Overview

The Dashboard shows the current state of expense processing at a glance.

### Stat Cards

| Card | Meaning | Action Needed |
|------|---------|---------------|
| **Pending Reviews** | Expenses flagged for human review | Click to review queue |
| **Unmatched Bank Txns** | Bank transactions without matching expenses | Import more or review |
| **Processed Today** | Expenses auto-processed today | None (informational) |
| **This Week's Total** | Total expense amount this week | None (informational) |

### Alert Banner

When there are items requiring attention, an alert appears:
- **Yellow:** Items need review soon
- **Red:** Urgent items (over 5 days old)

### Quick Actions

- **Import Bank Statement** - Upload AMEX or Wells Fargo CSV
- **Review Queue** - Go to expense review
- **View Reports** - See analytics

---

## Reviewing Expenses

### What Triggers a Review?

Expenses are flagged for human review when:
1. **No bank match found** - Zoho expense doesn't match any bank transaction
2. **Low confidence** - AI is less than 95% confident in categorization
3. **Receipt mismatch** - Receipt amount differs from claimed amount
4. **State unclear** - Can't determine which state the expense belongs to

### Review Process

1. Go to **Review Queue** from sidebar or dashboard
2. Expenses are listed newest first
3. Click an expense card to expand details

### Expense Card Details

When expanded, you'll see:

**Left Panel:**
- Receipt image (if available)
- Click to zoom/download

**Right Panel:**
- Expense details (vendor, amount, date, category)
- AI suggestions with confidence percentage
- Flag reason explaining why it needs review

### Making a Decision

#### Option 1: Approve

If the AI got it right:
1. Verify the bank transaction match (shown below the details)
2. Click **Approve**
3. Expense will be posted to QuickBooks

#### Option 2: Correct

If something needs to change:
1. Select the correct bank transaction (if different)
2. Change the category using the dropdown
3. Change the state using the dropdown
4. Add optional notes
5. Click **Save Correction**

The system learns from your corrections to improve future predictions.

#### Option 3: Reject

If the expense is invalid or duplicate:
1. Click **Reject**
2. Enter a reason
3. Expense will be marked as rejected (not posted to QBO)

#### Option 4: Skip

If you're unsure and want to come back later:
1. Click **Skip**
2. Expense remains in queue

### Bank Transaction Matching

When reviewing, you'll see suggested bank transaction matches:

```
○ AMEX - $52.96 - Dec 06 - "SHELL OIL 12345" (Best Match)
○ AMEX - $53.50 - Dec 05 - "CHEVRON 98765"
○ No match (create manual entry)
```

- **Best Match** is highlighted by the AI
- Select a different option if the AI is wrong
- Choose "No match" if the expense shouldn't be linked to a bank transaction

---

## Importing Bank Transactions

### When to Import

Import bank statements:
- **Weekly** (recommended) - Every Monday for the previous week
- **Monthly** - At month-end before closing

### How to Import

1. Go to **Import** from the sidebar
2. Download CSV from your bank:
   - **AMEX:** Log in → Statements → Download CSV
   - **Wells Fargo:** Log in → Account Activity → Export
3. Drag and drop the CSV file onto the upload area
4. Wait for parsing (takes a few seconds)

### Preview Screen

After uploading, you'll see:

| Field | Description |
|-------|-------------|
| **Source** | AMEX or Wells Fargo (auto-detected) |
| **Transactions** | Total number found |
| **Date Range** | Earliest to latest transaction date |
| **Duplicates** | Already imported (will be skipped) |
| **New** | New transactions to import |

### Transaction Preview Table

Review the transactions before importing:
- **New** - Will be imported
- **Duplicate** - Already exists, will be skipped
- Red highlight = potential issues (unusual amount, etc.)

### Confirming Import

1. Review the preview
2. Click **Import X Transactions**
3. Wait for completion
4. See success message with count

### Troubleshooting Import

| Issue | Solution |
|-------|----------|
| "Unknown format" | Wrong file type - ensure it's a CSV |
| "No transactions found" | Empty file or wrong date range |
| "All duplicates" | Already imported this statement |
| Parse errors | Check file isn't corrupted |

---

## Managing Vendor Rules

### What Are Vendor Rules?

Vendor rules tell the system how to categorize expenses from known vendors automatically. For example:

| Pattern | Category | State |
|---------|----------|-------|
| shell | Fuel - COS | - |
| marriott | Travel - Courses COS | - |
| office depot | Office Supplies & Software | Admin |

### Viewing Rules

1. Go to **Vendor Rules** from sidebar
2. See all patterns in the table
3. **Matches** column shows how often each rule is used

### Adding a Rule

1. Click **+ Add Rule**
2. Enter the vendor pattern (case-insensitive)
3. Select the default category
4. Optionally select a default state
5. Add notes if helpful
6. Click **Save**

### Editing a Rule

1. Click the **edit** icon on the rule row
2. Modify fields as needed
3. Click **Save**

### Testing a Pattern

Use the "Test Pattern" section at the bottom:
1. Enter a sample vendor name (e.g., "SHELL OIL 12345 FRESNO")
2. See which rule would match
3. Useful before adding new rules

### Pattern Matching Tips

- Patterns are **case-insensitive**
- Shorter patterns match more vendors (e.g., "shell" matches "SHELL OIL", "SHELL GAS", etc.)
- Be specific to avoid incorrect matches
- The first matching rule is used

---

## Viewing Reports

### Available Reports

Go to **Reports** from sidebar to see:

1. **Expenses by State** - Pie chart showing expense distribution
2. **Expenses by Category** - Bar chart of category breakdown
3. **Monthly Trend** - Line chart of expenses over time
4. **AI Accuracy** - How often the AI gets it right

### Filtering Reports

Use the filter controls at the top:
- **Date Range** - Select start and end dates
- **State** - Filter to specific state(s)
- **Category** - Filter to specific category(s)
- **COS/Non-COS** - Toggle between course-related and admin expenses

### Exporting Data

1. Click **Export** button
2. Choose format (CSV or PDF)
3. Download the file

---

## Troubleshooting

### Common Issues

#### "I can't log in"
- Check your email is correct
- Try "Forgot Password" to reset
- Contact Pablo if account is locked

#### "Expense is stuck in review"
- Check if there's a system error (red banner)
- Try refreshing the page
- Contact Pablo if persists

#### "Bank import failed"
- Ensure file is CSV format (not PDF or Excel)
- Try downloading a fresh export from the bank
- Check if the file is empty

#### "Expense posted to wrong QBO account"
- Report to Pablo immediately
- We can void and re-post in QBO
- Check vendor rules for incorrect pattern

#### "Receipt image not showing"
- Zoho may still be processing
- Try refreshing after a few minutes
- Check if receipt was actually attached in Zoho

### Getting Help

For technical issues, contact:
- **Pablo** - System admin, technical issues
- **Ashley** - Process questions, categorization help

---

## FAQ

### General

**Q: How long does expense processing take?**
A: Most expenses are processed within 5 minutes of Zoho approval. Flagged expenses wait until reviewed.

**Q: What happens after I approve an expense?**
A: It's automatically posted to QuickBooks Online and linked to the course in Monday.com (if COS).

**Q: Can I undo an approval?**
A: Contact Pablo. We can void the QBO entry and re-process.

### Categorization

**Q: How does the AI decide the category?**
A: It looks at:
1. Zoho category selected by the submitter
2. Vendor rules from learned patterns
3. Receipt content analysis
4. Historical data from similar expenses

**Q: Why was this expense flagged?**
A: Common reasons:
- No matching bank transaction
- Receipt amount differs from claimed amount
- State couldn't be determined
- Similar to a potential duplicate

**Q: What's the difference between COS and Non-COS?**
A:
- **COS (Cost of Sales):** Course-related expenses (fuel for course vehicles, track rental, etc.)
- **Non-COS:** Administrative expenses (office supplies, general travel, etc.)

### Bank Transactions

**Q: Why are there unmatched bank transactions?**
A: Either:
- The expense wasn't submitted to Zoho yet
- The expense was reimbursed (personal card)
- The transaction should be excluded (not a business expense)

**Q: How do I exclude a bank transaction?**
A: In the Bank Transactions view, find the transaction and click "Exclude". It won't be matched to any expense.

**Q: Can I manually add a bank transaction?**
A: Yes, in Bank Transactions, click "Add Manual Entry". Useful for cash purchases.

### States & Tax

**Q: Why does state matter?**
A: Tax compliance. Expenses are reported to the state where they occurred. California has different tax rates than Texas, for example.

**Q: What if an expense spans multiple states?**
A: Split it in Zoho before submitting, or flag for manual handling. Most expenses occur in a single state.

**Q: What's "Admin" state?**
A: For expenses that don't have a specific state (e.g., online purchases, subscriptions). These are reported as general administrative.

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `A` | Approve selected expense |
| `C` | Open correction modal |
| `R` | Reject selected expense |
| `S` | Skip to next expense |
| `→` | Next expense in queue |
| `←` | Previous expense in queue |
| `Esc` | Close modal |

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | Dec 6, 2025 | Initial release |

---

*End of User Guide*
