# AS3 Expense Automation - CSV Format Specification

**Version:** 2.0
**Last Updated:** December 6, 2025
**Status:** Confirmed from sample files

---

## Table of Contents

1. [Overview](#overview)
2. [Unified CSV Format](#unified-csv-format)
3. [Column Specifications](#column-specifications)
4. [Parsing Implementation](#parsing-implementation)
5. [Source Detection](#source-detection)
6. [State Extraction from Description](#state-extraction-from-description)
7. [Duplicate Detection](#duplicate-detection)

---

## Overview

Both AMEX and Wells Fargo CSVs are exported from QuickBooks Online's bank feed. They share the **same format**.

| Source | Account | Card Ending |
|--------|---------|-------------|
| AMEX | Business 61002 | Various (1044, 2000, 1036, 1028) |
| Wells Fargo | AS3 Driver Training | 6323 |

**Key Insight:** The CSV format is identical for both sources. We detect which source based on description patterns, not file structure.

---

## Unified CSV Format

### Columns

| # | Column | Example | Usage |
|---|--------|---------|-------|
| 1 | DATE | "12/01/2025" | Transaction date |
| 2 | DESCRIPTION | "CHEVRON XXX5133 SANTA ROSA CA XXXX1044" | Full bank description |
| 3 | From/To | "CHEVRON" | **IGNORE** - QBO's guess, unreliable |
| 4 | SPENT | "$26.37" | Expense amount (outflow) |
| 5 | RECEIVED | "" | Income amount (inflow) - skip these rows |
| 6 | ASSIGN TO | "Fuel - COS" | **IGNORE** - QBO's guess, unreliable |

### Sample Data

**AMEX Transactions:**
```csv
DATE,DESCRIPTION,From/To,SPENT,RECEIVED,ASSIGN TO
"12/01/2025","HERTZTOLL XXXXX0500 PHILADELPHIA AP PA XXXX1036","HERTZ CAR RENTAL","$15.99","","Vehicle (Rent/Wash) - COS"
"11/26/2025","CHEVRON XXX5133/CHEVSANTA ROSA CA XXXX1044","CHEVRON","$26.37","","Fuel - COS"
"11/26/2025","LAGUNA SECA RACEWAY SALINAS CA XXXX1028","WeatherTech Raceway Laguna Seca","$4,700.00","","Track Rental - COS"
```

**Wells Fargo Transactions:**
```csv
DATE,DESCRIPTION,From/To,SPENT,RECEIVED,ASSIGN TO
"12/04/2025","PURCHASE INTL AUTHORIZED ON 12/03 MOTORSPORT VISION FAWKHAM DA3 GBR SXXXXXXXX0690312 CARD 6323","","$40.21","","Vehicle (Rent/Wash) - COS"
"11/26/2025","PURCHASE AUTHORIZED ON 11/24 STARBUCKS STORE 06 DEL REY OAKS CA SXXXXXXXX5353193 CARD 6323","Starbucks","$72.00","","Course Catering/Meals - COS"
"11/24/2025","CHECK 1003","","$4,500.00","","Track Rental - COS"
```

---

## Column Specifications

### DATE

- **Format:** MM/DD/YYYY in double quotes
- **Example:** `"12/01/2025"`
- **Parsing:** Remove quotes, parse as date, convert to YYYY-MM-DD

### DESCRIPTION

- **Contains:** Vendor name, location, card identifier
- **AMEX Pattern:** `VENDOR_NAME LOCATION STATE XXXX1044`
- **Wells Fargo Pattern:** `PURCHASE AUTHORIZED ON MM/DD VENDOR_NAME LOCATION STATE SXXXXXXXX... CARD 6323`
- **Use for:** Vendor matching, state extraction, source detection

### SPENT

- **Format:** Currency with dollar sign, optional comma for thousands
- **Examples:** `"$26.37"`, `"$4,700.00"`, `"$15.99"`
- **Parsing:** Remove `$`, `,`, quotes → parse as float

### RECEIVED

- **Contains:** Income/deposits (Stripe transfers, refunds)
- **Rule:** Skip rows where RECEIVED has a value (these are not expenses)

### From/To and ASSIGN TO

- **Status:** **IGNORE COMPLETELY**
- **Reason:** QBO's guesses, not authoritative. Our AI will categorize.

---

## Parsing Implementation

### TypeScript Parser

```typescript
// src/services/csv-parser.ts

import Papa from 'papaparse';

export interface ParsedTransaction {
    source: 'amex' | 'wells_fargo';
    transaction_date: string;        // YYYY-MM-DD
    description: string;             // Raw bank description
    amount: number;                  // Positive decimal
    extracted_state: string | null;  // CA, TX, etc. if found in description
    extracted_vendor: string | null; // First recognizable word(s)
    card_identifier: string | null;  // XXXX1044, CARD 6323, etc.
}

export interface ParseResult {
    transactions: ParsedTransaction[];
    date_range: { start: string; end: string };
    summary: {
        total_rows: number;
        expenses: number;
        income_skipped: number;
        amex_count: number;
        wells_fargo_count: number;
    };
    errors: string[];
}

export function parseCSV(fileContent: string): ParseResult {
    const errors: string[] = [];
    const transactions: ParsedTransaction[] = [];
    let incomeSkipped = 0;

    const parsed = Papa.parse(fileContent, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (h) => h.trim().toUpperCase(),
    });

    for (let i = 0; i < parsed.data.length; i++) {
        const row = parsed.data[i] as Record<string, string>;

        try {
            // Skip income rows (RECEIVED has value)
            const received = row['RECEIVED']?.replace(/["$,]/g, '').trim();
            if (received && parseFloat(received) > 0) {
                incomeSkipped++;
                continue;
            }

            // Skip rows without SPENT
            const spent = row['SPENT']?.replace(/["$,]/g, '').trim();
            if (!spent || parseFloat(spent) <= 0) {
                continue;
            }

            const description = row['DESCRIPTION']?.replace(/"/g, '').trim() || '';
            const txn = parseTransaction(row, description);

            if (txn) {
                transactions.push(txn);
            }
        } catch (error) {
            errors.push(`Row ${i + 2}: ${error.message}`);
        }
    }

    // Sort by date descending (newest first)
    transactions.sort((a, b) => b.transaction_date.localeCompare(a.transaction_date));

    return {
        transactions,
        date_range: {
            start: transactions[transactions.length - 1]?.transaction_date || '',
            end: transactions[0]?.transaction_date || '',
        },
        summary: {
            total_rows: parsed.data.length,
            expenses: transactions.length,
            income_skipped: incomeSkipped,
            amex_count: transactions.filter(t => t.source === 'amex').length,
            wells_fargo_count: transactions.filter(t => t.source === 'wells_fargo').length,
        },
        errors,
    };
}

function parseTransaction(row: Record<string, string>, description: string): ParsedTransaction {
    // Parse date
    const dateStr = row['DATE']?.replace(/"/g, '').trim();
    const transaction_date = parseDate(dateStr);

    // Parse amount
    const amountStr = row['SPENT']?.replace(/["$,]/g, '').trim();
    const amount = parseFloat(amountStr);
    if (isNaN(amount) || amount <= 0) {
        throw new Error(`Invalid amount: ${row['SPENT']}`);
    }

    // Detect source from description
    const source = detectSource(description);

    // Extract state from description
    const extracted_state = extractState(description);

    // Extract vendor hint (first meaningful words)
    const extracted_vendor = extractVendor(description);

    // Extract card identifier
    const card_identifier = extractCardIdentifier(description);

    return {
        source,
        transaction_date,
        description,
        amount,
        extracted_state,
        extracted_vendor,
        card_identifier,
    };
}

function parseDate(dateStr: string): string {
    const parts = dateStr.split('/');
    if (parts.length !== 3) {
        throw new Error(`Invalid date: ${dateStr}`);
    }
    const [month, day, year] = parts;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}
```

---

## Source Detection

Detect AMEX vs Wells Fargo from description patterns:

```typescript
function detectSource(description: string): 'amex' | 'wells_fargo' {
    const upper = description.toUpperCase();

    // Wells Fargo patterns
    if (upper.includes('CARD 6323')) return 'wells_fargo';
    if (upper.includes('PURCHASE INTL')) return 'wells_fargo';
    if (upper.includes('PURCHASE ') && upper.includes('AUTHORIZED ON')) return 'wells_fargo';
    if (upper.includes('RECURRING PAYMENT')) return 'wells_fargo';
    if (upper.includes('MONEY TRANSFER')) return 'wells_fargo';
    if (upper.includes('BUSINESS TO BUSINESS ACH')) return 'wells_fargo';
    if (upper.includes('ZELLE TO')) return 'wells_fargo';
    if (upper.includes('CHECK ') && /CHECK \d+/.test(upper)) return 'wells_fargo';

    // AMEX patterns (card numbers ending in 1044, 2000, 1036, 1028)
    if (/XXXX(1044|2000|1036|1028)/.test(upper)) return 'amex';

    // Default to AMEX (more common for expenses)
    return 'amex';
}
```

---

## State Extraction from Description

Extract US state codes from bank descriptions for tax attribution:

```typescript
const US_STATES = [
    'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
    'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
    'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
    'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
    'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC'
];

// AS3 operating states (for priority matching)
const AS3_STATES = ['CA', 'TX', 'CO', 'WA', 'NJ', 'FL', 'MT'];

function extractState(description: string): string | null {
    const upper = description.toUpperCase();

    // Pattern 1: "CITY STATE" or "CITY STATE XXXX" at end
    // Examples: "SANTA ROSA CA XXXX1044", "PHILADELPHIA PA XXXX1036"
    for (const state of AS3_STATES) {
        const pattern = new RegExp(`\\b([A-Z]+)\\s+${state}\\b`);
        if (pattern.test(upper)) {
            return state;
        }
    }

    // Pattern 2: Any US state code preceded by city-like word
    for (const state of US_STATES) {
        const pattern = new RegExp(`\\b[A-Z]{2,}\\s+${state}\\b`);
        if (pattern.test(upper)) {
            return state;
        }
    }

    // Pattern 3: International (GB, GBR = UK, etc.)
    if (upper.includes(' GB ') || upper.includes(' GBR ')) {
        return 'INTL';
    }
    if (upper.includes(' SG ')) {
        return 'INTL'; // Singapore
    }

    return null;
}
```

### State Extraction Examples

| Description | Extracted State |
|-------------|-----------------|
| `CHEVRON XXX5133/CHEVSANTA ROSA CA XXXX1044` | CA |
| `HERTZTOLL XXXXX0500 PHILADELPHIA AP PA XXXX1036` | PA |
| `STARBUCKS STORE 06 DEL REY OAKS CA` | CA |
| `HILTON HOTELS LONDON GB XXXX1044` | INTL |
| `AIRALO SINGAPORE SG XXXX1044` | INTL |
| `STRIPE TRANSFER ST-W0T8I0Z2M6I0` | null |

---

## Duplicate Detection

### Composite Key

Bank transactions may not have unique reference numbers. Use composite key:

```typescript
function generateTransactionKey(txn: ParsedTransaction): string {
    // Normalize description (first 30 chars, alphanumeric only)
    const descNorm = txn.description
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .substring(0, 30);

    return `${txn.source}|${txn.transaction_date}|${txn.amount.toFixed(2)}|${descNorm}`;
}
```

### Pre-Import Check

```typescript
async function checkDuplicates(
    transactions: ParsedTransaction[],
    supabase: SupabaseClient
): Promise<{ new: ParsedTransaction[]; duplicates: ParsedTransaction[] }> {

    // Get date range
    const dates = transactions.map(t => t.transaction_date);
    const minDate = dates.reduce((a, b) => a < b ? a : b);
    const maxDate = dates.reduce((a, b) => a > b ? a : b);

    // Query existing transactions in date range
    const { data: existing } = await supabase
        .from('bank_transactions')
        .select('transaction_date, amount, description, source')
        .gte('transaction_date', minDate)
        .lte('transaction_date', maxDate);

    const existingKeys = new Set(
        (existing || []).map(e => generateTransactionKey({
            source: e.source,
            transaction_date: e.transaction_date,
            amount: e.amount,
            description: e.description,
            extracted_state: null,
            extracted_vendor: null,
            card_identifier: null,
        }))
    );

    const newTxns: ParsedTransaction[] = [];
    const dupTxns: ParsedTransaction[] = [];

    for (const txn of transactions) {
        const key = generateTransactionKey(txn);
        if (existingKeys.has(key)) {
            dupTxns.push(txn);
        } else {
            newTxns.push(txn);
            existingKeys.add(key); // Prevent within-import duplicates
        }
    }

    return { new: newTxns, duplicates: dupTxns };
}
```

---

## Vendor Extraction

Extract vendor name for matching against vendor_rules:

```typescript
function extractVendor(description: string): string | null {
    let clean = description.toUpperCase();

    // Remove Wells Fargo prefixes
    clean = clean.replace(/^PURCHASE INTL\s+AUTHORIZED ON\s+\d{2}\/\d{2}\s+/i, '');
    clean = clean.replace(/^PURCHASE\s+AUTHORIZED ON\s+\d{2}\/\d{2}\s+/i, '');
    clean = clean.replace(/^RECURRING PAYMENT\s+AUTHORIZED ON\s+\d{2}\/\d{2}\s+/i, '');
    clean = clean.replace(/^MONEY TRANSFER\s+AUTHORIZED ON\s+\d{2}\/\d{2}\s+/i, '');

    // Remove card identifiers
    clean = clean.replace(/XXXX\d{4}/g, '');
    clean = clean.replace(/SXXXXXXXX\d+/g, '');
    clean = clean.replace(/CARD \d{4}/g, '');

    // Remove state codes at end
    clean = clean.replace(/\s+[A-Z]{2}\s*$/g, '');

    // Get first 2-3 meaningful words
    const words = clean.trim().split(/\s+/).filter(w => w.length > 1);
    const vendorWords = words.slice(0, 3).join(' ');

    return vendorWords || null;
}
```

### Vendor Extraction Examples

| Description | Extracted Vendor |
|-------------|------------------|
| `CHEVRON XXX5133/CHEVSANTA ROSA CA XXXX1044` | `CHEVRON` |
| `PURCHASE AUTHORIZED ON 11/24 STARBUCKS STORE 06 DEL REY OAKS CA` | `STARBUCKS STORE 06` |
| `HILTON GARDEN INN LOHOUNSLOW GB XXXX2000` | `HILTON GARDEN INN` |
| `HERTZ CAR RENTAL MONTEREY CA XXXX1036` | `HERTZ CAR RENTAL` |

---

## Transaction Types to Handle

| Type | Description Pattern | Action |
|------|---------------------|--------|
| Regular Purchase | Most transactions | Import as expense |
| Check | `CHECK 1003` | Import, flag for review |
| ACH Payment | `BUSINESS TO BUSINESS ACH...` | Import as expense (payroll, vendor payments) |
| Zelle | `ZELLE TO...` | Import as expense |
| Stripe Transfer | `STRIPE TRANSFER...` | **SKIP** (income, RECEIVED column has value) |
| International | Contains `GBR`, `GB`, `SG` | Import, mark state as INTL |

---

## Sample Files Location

```
as3-auto-bookkeeper/
└── sample_files/
    ├── American_Express.csv    # 50 transactions
    └── Wells_Fargo.csv         # 50 transactions
```

---

*End of CSV Format Specification*
