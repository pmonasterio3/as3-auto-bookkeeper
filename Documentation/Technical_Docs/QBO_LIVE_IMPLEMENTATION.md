# QBO Live Implementation Guide

**Version:** 1.1
**Created:** December 9, 2025
**Updated:** December 10, 2025
**Status:** In Progress - Vendor & Receipt Nodes Pending

---

## Prerequisites

### Step 1: Create Classes in QBO (User Action Required)

1. Go to QBO: **Settings (gear icon) → All Lists → Classes**
2. Create 8 Classes with these exact names:

| Class Name | State Code | Purpose |
|------------|------------|---------|
| California | CA | COS expenses in California |
| Texas | TX | COS expenses in Texas |
| Colorado | CO | COS expenses in Colorado |
| Washington | WA | COS expenses in Washington |
| New Jersey | NJ | COS expenses in New Jersey |
| Florida | FL | COS expenses in Florida |
| Montana | MT | COS expenses in Montana |
| Admin | NC | Admin/Office expenses (North Carolina) |

3. After creating each Class, get its QBO ID:
   - Click on the Class name
   - Look at the URL: `https://app.qbo.intuit.com/app/class?id=XXXXXXX`
   - The `XXXXXXX` is the QBO Class ID

4. Provide the 8 Class IDs to populate the `qbo_classes` table.

---

## Step 2: Populate qbo_classes Table

Once you have the Class IDs from QBO, run this SQL in Supabase:

```sql
INSERT INTO qbo_classes (qbo_class_id, state_code, class_name) VALUES
('REPLACE_WITH_CA_ID', 'CA', 'California'),
('REPLACE_WITH_TX_ID', 'TX', 'Texas'),
('REPLACE_WITH_CO_ID', 'CO', 'Colorado'),
('REPLACE_WITH_WA_ID', 'WA', 'Washington'),
('REPLACE_WITH_NJ_ID', 'NJ', 'New Jersey'),
('REPLACE_WITH_FL_ID', 'FL', 'Florida'),
('REPLACE_WITH_MT_ID', 'MT', 'Montana'),
('REPLACE_WITH_NC_ID', 'NC', 'Admin');
```

---

## Step 3: Modify n8n Workflow

### Overview of Changes

**Current Flow:**
```
Process QBO Accounts → Fetch Receipt → IF is COS → ... → AI Agent → Parse AI Decision → IF Approved → Mock Post QBO → Update Bank Transaction
```

**New Flow (Complete):**
```
Process QBO Accounts → Fetch Receipt → IF is COS → ... → AI Agent → Parse AI Decision → IF Approved → Lookup QBO Class → Lookup/Create Vendor → Post to QBO (HTTP) → Upload Receipt (HTTP) → Update Bank Transaction
```

**What We're Building:** Match Zoho's native QBO integration feature set:
- Vendor matching (auto-create if not found)
- Receipt attachment to Purchase
- State tracking via Classes (ClassRef)
- Payment account mapping
- Expense account mapping

---

### 3A: Add "Lookup/Create Vendor" Node

**Node Type:** HTTP Request (with fallback logic)
**Node Name:** `Lookup/Create Vendor`
**Position:** After "IF Approved" (true branch), before "Lookup QBO Class"

**Purpose:** Find existing vendor in QBO or create new one. Including EntityRef in Purchase improves QBO's bank feed matching algorithm.

**Implementation Pattern:**

This requires TWO HTTP Request nodes in sequence:

#### Node 3A.1: Query Vendor

| Setting | Value |
|---------|-------|
| Method | GET |
| URL | `https://quickbooks.api.intuit.com/v3/company/123146088634019/query?query=SELECT * FROM Vendor WHERE DisplayName = '{{ $('Parse AI Decision').item.json.merchant_name }}'&minorversion=65` |
| Authentication | OAuth2 (use existing QBO credential) |

**Response Handling:**
- If `QueryResponse.Vendor` exists → Use existing vendor ID
- If empty or not found → Continue to Create Vendor node

#### Node 3A.2: Create Vendor (Conditional)

**Execute only if:** `{{ $json.QueryResponse && $json.QueryResponse.Vendor && $json.QueryResponse.Vendor.length > 0 ? false : true }}`

| Setting | Value |
|---------|-------|
| Method | POST |
| URL | `https://quickbooks.api.intuit.com/v3/company/123146088634019/vendor?minorversion=65` |
| Authentication | OAuth2 (use existing QBO credential) |
| Body Content Type | JSON |

**JSON Body:**
```json
{
  "DisplayName": "{{ $('Parse AI Decision').item.json.merchant_name }}"
}
```

**Output Merge (Code Node):**
```javascript
// Merge results from Query and Create into single vendor_id
const queryResult = $('Query Vendor').first().json;
const createResult = $('Create Vendor').first().json;

const vendorId = queryResult?.QueryResponse?.Vendor?.[0]?.Id || createResult?.Vendor?.Id || null;
const vendorName = queryResult?.QueryResponse?.Vendor?.[0]?.DisplayName || createResult?.Vendor?.DisplayName || null;

return [{
  json: {
    vendor_id: vendorId,
    vendor_name: vendorName
  }
}];
```

**Why This Matters:**
- Including EntityRef in Purchase tells QBO "this transaction is with Vendor XYZ"
- QBO's bank feed matching algorithm uses this to suggest better matches
- Reduces manual work in QBO Banking tab

---

### 3B: Add "Lookup QBO Class" Node

**Node Type:** Supabase (Get)
**Node Name:** `Lookup QBO Class`
**Position:** After "IF Approved" (true branch), before new QBO posting node

**Configuration:**

| Setting | Value |
|---------|-------|
| Operation | Get |
| Table | qbo_classes |
| Return All | No |
| Filter | state_code equals `{{ $json.state }}` |

**Purpose:** Gets the QBO Class ID for the expense's state so we can include it in the Purchase API call.

---

### 3C: Replace "Mock Post QBO" with HTTP Request

**Node Type:** HTTP Request
**Node Name:** `Post to QBO`
**Position:** After "Lookup QBO Class" and "Lookup/Create Vendor"

**Configuration:**

| Setting | Value |
|---------|-------|
| Method | POST |
| URL | `https://quickbooks.api.intuit.com/v3/company/123146088634019/purchase?minorversion=65` |
| Authentication | OAuth2 (use existing QBO credential) |
| Body Content Type | JSON |

**JSON Body:**

```json
{
  "PaymentType": "{{ $('Parse AI Decision').item.json.qbo_payment_type || 'CreditCard' }}",
  "AccountRef": {
    "value": "{{ $('Parse AI Decision').item.json.qbo_payment_account_id }}"
  },
  "TxnDate": "{{ $('Parse AI Decision').item.json.date }}",
  "EntityRef": {
    "value": "{{ $('Merge Vendor Result').item.json.vendor_id }}"
  },
  "Line": [
    {
      "DetailType": "AccountBasedExpenseLineDetail",
      "Amount": {{ $('Parse AI Decision').item.json.amount_number }},
      "Description": "{{ $('Parse AI Decision').item.json.description || $('Parse AI Decision').item.json.merchant_name }}",
      "AccountBasedExpenseLineDetail": {
        "AccountRef": {
          "value": "{{ $('Parse AI Decision').item.json.qbo_expense_account_id }}"
        },
        "ClassRef": {
          "value": "{{ $('Lookup QBO Class').item.json.qbo_class_id }}"
        }
      }
    }
  ],
  "PrivateNote": "Zoho Expense: {{ $('Parse AI Decision').item.json.expense_id }} | State: {{ $('Parse AI Decision').item.json.state }} | Vendor: {{ $('Merge Vendor Result').item.json.vendor_name }} | Bank Match: {{ $('Parse AI Decision').item.json.bank_transaction_id || 'None' }}"
}
```

**Key Changes from Mock:**
- EntityRef now uses actual vendor_id from Lookup/Create Vendor
- ClassRef uses qbo_class_id from Lookup QBO Class
- PrivateNote includes vendor name for audit trail

**Headers:**
- `Content-Type`: `application/json`
- `Accept`: `application/json`

**Response Handling:**
- On success (200/201): Continue to next node
- On error: Route to error handling (Teams notification)

---

### 3D: Add "Upload Receipt to QBO" Node

**Node Type:** HTTP Request
**Node Name:** `Upload Receipt to QBO`
**Position:** After "Post to QBO"

**Purpose:** Attach receipt image to the Purchase record we just created. This matches what Zoho's native QBO integration does.

**Configuration:**

| Setting | Value |
|---------|-------|
| Method | POST |
| URL | `https://quickbooks.api.intuit.com/v3/company/123146088634019/upload?minorversion=65` |
| Authentication | OAuth2 (use existing QBO credential) |
| Body Content Type | Multipart Form-Data |
| Send Binary Data | Yes |

**Multipart Form-Data Structure:**

The Attachable API requires a very specific multipart/form-data format with TWO parts:

**Part 1: file_metadata_0 (JSON metadata)**
```json
{
  "AttachableRef": [
    {
      "EntityRef": {
        "type": "Purchase",
        "value": "{{ $('Post to QBO').item.json.Purchase.Id }}"
      }
    }
  ],
  "FileName": "receipt_{{ $('Parse AI Decision').item.json.expense_id }}.jpg",
  "ContentType": "{{ $('Fetch Receipt').item.binary.data.mimeType || 'image/jpeg' }}"
}
```

**Part 2: file_content_0 (Binary data)**
- Field Name: `file_content_0`
- Binary Property: `data` (reference to Fetch Receipt node binary output)
- Content-Type: Will be set from metadata

**n8n Configuration:**

In the HTTP Request node:
1. Set "Body Content Type" to "Form-Data Multipart"
2. Add TWO fields:
   - Field 1: Name = `file_metadata_0`, Type = Text, Value = JSON above
   - Field 2: Name = `file_content_0`, Type = Binary, Binary Property = `data`

**Conditional Execution:**
Only execute if binary data exists:
```javascript
{{ $('Fetch Receipt').item.binary && $('Fetch Receipt').item.binary.data ? true : false }}
```

If no receipt, skip this node and continue to Update Bank Transaction.

**Why This Matters:**
- CPA can see receipt in QBO without switching to Zoho
- Matches the feature set of Zoho's native QBO integration
- Receipt is directly linked to the Purchase transaction

**Error Handling:**
If upload fails, log warning but continue (don't block the entire workflow). Receipt is still accessible in Zoho.

---

### 3E: Update "Update Bank Transaction" Node

**Current:** Updates `status` to `matched`

**Add These Fields:**

| Field | Value |
|-------|-------|
| qbo_purchase_id | `{{ $('Post to QBO').item.json.Purchase.Id }}` |
| qbo_vendor_id | `{{ $('Merge Vendor Result').item.json.vendor_id }}` |
| status | `matched` |
| matched_at | `{{ new Date().toISOString() }}` |

**Why track vendor_id:**
- Future orphan processing can suggest vendors based on past bank transactions
- Useful for recurring vendor analytics

---

### 3F: Add Error Handling Branch

**Node Type:** IF
**Node Name:** `IF QBO Success`
**Position:** After "Post to QBO"

**Condition:**
```
{{ $json.Purchase && $json.Purchase.Id ? true : false }}
```

**True Branch:** Continue to Upload Receipt → Update Bank Transaction
**False Branch:** Route to Teams Notification with error details

---

## Step 4: Test Sequence

### Test 1: Single Expense (Non-COS)

1. Submit Zoho expense report with:
   - Category: "Office Supplies" (non-COS)
   - Course Location tag: "Other"
   - Amount: $25.00
   - Merchant: Test vendor

2. Expected Result:
   - QBO Purchase created with ClassRef = NC (Admin)
   - Receipt attached (if present)
   - Bank transaction updated with qbo_purchase_id

### Test 2: Single Expense (COS)

1. Submit Zoho expense report with:
   - Category: "Fuel - COS"
   - Course Location tag: "California"
   - Amount: $50.00

2. Expected Result:
   - QBO Purchase created with ClassRef = CA
   - Receipt attached

### Test 3: No Bank Match

1. Submit Zoho expense where no bank transaction exists

2. Expected Result:
   - Flagged for review (is_reimbursement = true)
   - No QBO posting
   - Teams notification sent

### Test 4: Multi-Expense Report

1. Submit report with 3 expenses in different states

2. Expected Result:
   - All 3 processed with correct ClassRef
   - Each gets its own QBO Purchase record

---

## OAuth2 Credential Setup

If not already configured, the QBO OAuth2 credential in n8n needs:

| Setting | Value |
|---------|-------|
| Grant Type | Authorization Code |
| Authorization URL | https://appcenter.intuit.com/connect/oauth2 |
| Access Token URL | https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer |
| Client ID | (from Intuit Developer) |
| Client Secret | (from Intuit Developer) |
| Scope | `com.intuit.quickbooks.accounting` |
| Auth URI Query Parameters | `response_type=code` |

**Realm ID (Company ID):** 123146088634019

---

## Rollback Plan

If QBO posting causes issues:

1. **Immediate:** Disable "Post to QBO" node (right-click → Disable)
2. **Fallback:** Mock Post QBO node is preserved (disabled, not deleted)
3. **Recovery:** Re-enable Mock Post QBO, disable Post to QBO

---

## State Mapping Reference

| Zoho "Course Location" Tag | State Code | QBO Class Name |
|---------------------------|------------|----------------|
| California | CA | California |
| Texas | TX | Texas |
| Colorado | CO | Colorado |
| Washington | WA | Washington |
| New Jersey | NJ | New Jersey |
| Florida | FL | Florida |
| Montana | MT | Montana |
| Other | NC | Admin |
| (empty/null) | NC | Admin |

---

## QBO API Reference

### Comparison: Our Integration vs Zoho Native

| Feature | Zoho Native QBO Sync | Our n8n Integration |
|---------|---------------------|---------------------|
| Creates Purchase | ✅ Yes | ✅ Yes |
| Vendor matching | ✅ Auto-match/create | ✅ Query + Create (Node 3A) |
| Receipt attachment | ✅ Via Attachable API | ✅ Via Attachable API (Node 3D) |
| Payment account mapping | ✅ "Paid Through" → QBO account | ✅ AMEX → 99, Wells Fargo → 49 |
| Expense account | ✅ Category → QBO account | ✅ Via qbo_accounts table |
| State tracking | ✅ Imports QBO Classes | ✅ ClassRef from qbo_classes table |
| Bank feed matching | ✅ QBO suggests matches | ✅ Same (EntityRef improves) |

**Result:** Our integration matches Zoho's native feature set while maintaining bank_transactions as source of truth.

---

### API Endpoints Used

#### 1. Query Vendor
```
GET https://quickbooks.api.intuit.com/v3/company/{realmId}/query?query=SELECT * FROM Vendor WHERE DisplayName = 'MerchantName'&minorversion=65
```

#### 2. Create Vendor
```
POST https://quickbooks.api.intuit.com/v3/company/{realmId}/vendor?minorversion=65
Body: { "DisplayName": "MerchantName" }
```

#### 3. Create Purchase
```
POST https://quickbooks.api.intuit.com/v3/company/{realmId}/purchase?minorversion=65
```

#### 4. Upload Attachment
```
POST https://quickbooks.api.intuit.com/v3/company/{realmId}/upload?minorversion=65
Content-Type: multipart/form-data
```

---

### Purchase API Required Fields

| Field | Type | Example | Notes |
|-------|------|---------|-------|
| PaymentType | TEXT | "CreditCard" or "Check" | CreditCard for AMEX, Check for Wells Fargo |
| AccountRef.value | TEXT | "99" or "49" | Payment account QBO ID |
| TxnDate | DATE | "2024-12-06" | Transaction date (YYYY-MM-DD) |
| Line[].Amount | NUMBER | 52.96 | Expense amount |
| Line[].AccountBasedExpenseLineDetail.AccountRef.value | TEXT | "76" | Expense account QBO ID |
| Line[].AccountBasedExpenseLineDetail.ClassRef.value | TEXT | "1000000004" | Class ID for state (CA, TX, etc.) |

### Purchase API Optional Fields

| Field | Type | Example | Notes |
|-------|------|---------|-------|
| EntityRef.value | TEXT | "123" | Vendor ID (improves bank feed matching) |
| PrivateNote | TEXT | "Zoho: 123 \| CA \| Chevron" | Internal memo (not shown on reports) |
| Memo | TEXT | "Fuel for course" | Public memo (shown on reports) |

---

### Attachable API Multipart Format

**Part 1: file_metadata_0 (JSON)**
```json
{
  "AttachableRef": [{
    "EntityRef": {
      "type": "Purchase",
      "value": "456"
    }
  }],
  "FileName": "receipt_123.jpg",
  "ContentType": "image/jpeg"
}
```

**Part 2: file_content_0 (Binary)**
- The actual receipt image binary data
- Must match ContentType specified in metadata

---

### API Documentation Links

- **Vendor API:** https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/vendor
- **Purchase API:** https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/purchase
- **Attachable API:** https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/attachable
- **Query Syntax:** https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api/data-queries
- **Zoho QBO Integration (for comparison):** https://www.zoho.com/us/expense/help/integrations/quickbooks-online/

---

## Checklist

### Before Going Live
- [x] 8 Classes created in QBO (CA, TX, CO, WA, NJ, FL, MT, NC)
- [x] Class IDs populated in qbo_classes table
- [ ] OAuth2 credential configured and tested
- [x] Lookup QBO Class node added
- [ ] Query Vendor node added (Node 3A.1)
- [ ] Create Vendor node added (Node 3A.2)
- [ ] Merge Vendor Result code node added
- [ ] Post to QBO HTTP Request configured (with EntityRef + ClassRef)
- [ ] Upload Receipt node configured (multipart/form-data)
- [ ] Update Bank Transaction updated (with qbo_vendor_id)
- [ ] Error handling branch added
- [ ] Mock Post QBO disabled (not deleted)

### Testing
- [ ] Test 1: Non-COS expense with "Other" tag → NC class
- [ ] Test 2: COS expense with state tag → correct class
- [ ] Test 3: No bank match → flagged
- [ ] Test 4: Multi-expense report → all processed
- [ ] Test 5: No receipt → posting succeeds without attachment

### Post-Go-Live
- [ ] Monitor first 10 expenses
- [ ] Verify Classes appear in QBO reports
- [ ] Check receipt attachments viewable in QBO
- [ ] Confirm bank_transactions.qbo_purchase_id populated

---

*End of QBO Live Implementation Guide*
