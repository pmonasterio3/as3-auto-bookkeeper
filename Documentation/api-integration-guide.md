# AS3 Expense Automation - API Integration Guide

**Version:** 1.0
**Last Updated:** December 6, 2025

---

## Table of Contents

1. [Overview](#overview)
2. [Zoho Expense API](#zoho-expense-api)
3. [QuickBooks Online API](#quickbooks-online-api)
4. [Monday.com API](#mondaycom-api)
5. [Supabase API](#supabase-api)
6. [Microsoft Teams API](#microsoft-teams-api)
7. [Authentication Summary](#authentication-summary)
8. [Error Handling](#error-handling)

---

## Overview

The AS3 Expense Automation system integrates with five external APIs:

| API | Purpose | Auth Method | Rate Limits |
|-----|---------|-------------|-------------|
| Zoho Expense | Receive expense reports, fetch receipts | OAuth 2.0 | 1000/day |
| QuickBooks Online | Create Purchase records | OAuth 2.0 | 500/min |
| Monday.com | Get events, create expense subitems | API Token | 1000/min |
| Supabase | Database operations | API Key | Unlimited* |
| Microsoft Teams | Send notifications | OAuth 2.0 | 30/min |

---

## Zoho Expense API

### Configuration

| Setting | Value |
|---------|-------|
| Base URL | `https://www.zohoapis.com/expense/v1` |
| Organization ID | `867260975` |
| OAuth Scope | `ZohoExpense.expensereport.READ, ZohoExpense.expense.READ` |

### Webhook Configuration

**Endpoint:** `https://as3driving.app.n8n.cloud/webhook/491d3c57-4d67-4689-995d-e0070cb726a9`

**Trigger:** When expense report is approved

**Payload Structure:**
```json
{
    "body": {
        "expense_report": {
            "report_id": "5647323000000867001",
            "report_name": "C24 - ACADS - CL - Aug 12-13",
            "report_number": "ER-00123",
            "user_name": "Pablo Ortiz-Monasterio",
            "user_email": "pablo@as3.com",
            "start_date": "2024-08-12",
            "end_date": "2024-08-13",
            "total_amount": 542.96,
            "status": "approved",
            "approved_by": "Ashley",
            "approved_date": "2024-08-15",
            "expenses": [
                {
                    "expense_id": "5647323000000867498",
                    "amount": 52.96,
                    "merchant_name": "Aho LLC",
                    "date": "2024-08-12",
                    "category_id": "5647323000000000123",
                    "category_name": "Fuel - COS",
                    "description": "Fuel for course vehicle",
                    "paid_through_account_id": "5647323000000000456",
                    "paid_through_account_name": "AMEX Business 61002",
                    "is_reimbursable": false,
                    "line_items": [
                        {
                            "line_item_id": "5647323000000867499",
                            "tags": [
                                {
                                    "tag_id": "5647323000000000789",
                                    "tag_name": "Course Location",
                                    "tag_option_id": "5647323000000000790",
                                    "tag_option_name": "California"
                                }
                            ]
                        }
                    ],
                    "documents": [
                        {
                            "document_id": "5647323000000867500",
                            "file_name": "receipt.jpg",
                            "file_type": "image/jpeg",
                            "file_size": 245678
                        }
                    ]
                }
            ]
        }
    }
}
```

### Fetch Receipt Image

**Endpoint:** `GET /expenses/{expense_id}/receipt`

**Request:**
```http
GET https://www.zohoapis.com/expense/v1/expenses/5647323000000867498/receipt
Authorization: Zoho-oauthtoken {access_token}
X-com-zoho-expense-organizationid: 867260975
```

**Response:** Binary image data (JPEG/PNG)

### Key Data Extraction

```javascript
// Extract state from Course Location tag
const state = expense.line_items[0]?.tags
    .find(t => t.tag_name === "Course Location")
    ?.tag_option_name || null;

// Extract receipt document ID
const receiptDocId = expense.documents[0]?.document_id;

// Determine if COS (Course-related)
const isCOS = expense.category_name?.endsWith("- COS");
```

---

## QuickBooks Online API

### Configuration

| Setting | Value |
|---------|-------|
| Base URL | `https://quickbooks.api.intuit.com/v3` |
| Company ID | `123146088634019` |
| Minor Version | `65` |
| OAuth Scope | `com.intuit.quickbooks.accounting` |

### Create Purchase (Expense)

**Endpoint:** `POST /company/{companyId}/purchase`

**Request:**
```http
POST https://quickbooks.api.intuit.com/v3/company/123146088634019/purchase?minorversion=65
Authorization: Bearer {access_token}
Content-Type: application/json
Accept: application/json
```

**Request Body:**
```json
{
    "AccountRef": {
        "value": "99",
        "name": "AMEX Business 61002"
    },
    "PaymentType": "CreditCard",
    "TxnDate": "2024-08-12",
    "PrivateNote": "Zoho ID: 5647323000000867498 | Event: ACADS - CL - Aug 12-13 | CA",
    "Line": [
        {
            "Amount": 52.96,
            "DetailType": "AccountBasedExpenseLineDetail",
            "Description": "Aho LLC - Fuel - COS - CA",
            "AccountBasedExpenseLineDetail": {
                "AccountRef": {
                    "value": "76",
                    "name": "Fuel - COS"
                }
            }
        }
    ]
}
```

**Response:**
```json
{
    "Purchase": {
        "Id": "12345",
        "SyncToken": "0",
        "TxnDate": "2024-08-12",
        "TotalAmt": 52.96,
        "AccountRef": {
            "value": "99",
            "name": "AMEX Business 61002"
        },
        "PaymentType": "CreditCard",
        "Line": [...]
    }
}
```

### Check for Duplicate Purchase

**Endpoint:** `GET /company/{companyId}/query`

**Request:**
```http
GET https://quickbooks.api.intuit.com/v3/company/123146088634019/query?query=SELECT * FROM Purchase WHERE TotalAmt = '52.96' AND TxnDate = '2024-08-12'&minorversion=65
Authorization: Bearer {access_token}
Accept: application/json
```

**Response:**
```json
{
    "QueryResponse": {
        "Purchase": [
            { "Id": "12345", "TotalAmt": 52.96, "TxnDate": "2024-08-12" }
        ],
        "startPosition": 1,
        "maxResults": 1
    }
}
```

### Account ID Reference

**Payment Accounts:**

| Account Name | QBO ID | PaymentType |
|--------------|--------|-------------|
| AMEX Business 61002 | 99 | CreditCard |
| Wells Fargo AS3 Driver Training (3170) | 49 | Check |

**COGS (Cost of Sales) Accounts:**

| Category | QBO ID |
|----------|--------|
| Cost of Labor - COS | 78 |
| Course Catering/Meals - COS | 82 |
| Fuel - COS | 76 |
| Supplies & Materials - COS | 77 |
| Track Rental - COS | 79 |
| Travel - Courses COS | 83 |
| Vehicle (Rent/Wash) - COS | 81 |
| Parking and Tolls - COS | 1150040006 |

**Admin Expense Accounts:**

| Category | QBO ID |
|----------|--------|
| Office Supplies & Software | 12 |
| Rent & Lease | 14 |
| Legal & Professional Services | 9 |
| Advertising & Marketing | 3 |
| Travel - General Business (Non-Course) | 1150040002 |
| Travel - Employee Meals | 60 |

### OAuth Token Refresh

QBO access tokens expire after 60 minutes. n8n handles refresh automatically when using the QuickBooks credential.

**Manual Refresh (if needed):**
```http
POST https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer
Content-Type: application/x-www-form-urlencoded
Authorization: Basic {base64(client_id:client_secret)}

grant_type=refresh_token&refresh_token={refresh_token}
```

---

## Monday.com API

### Configuration

| Setting | Value |
|---------|-------|
| API URL | `https://api.monday.com/v2` |
| Board ID | `8294758830` |
| Group ID | `new_group_mkmpatep` |
| Auth | API Token (Bearer) |

### Query Events (Items)

**GraphQL Query:**
```graphql
query {
    boards(ids: [8294758830]) {
        items_page(limit: 100) {
            items {
                id
                name
                column_values {
                    id
                    value
                    text
                }
            }
        }
    }
}
```

**Request:**
```http
POST https://api.monday.com/v2
Authorization: Bearer {api_token}
Content-Type: application/json

{
    "query": "query { boards(ids: [8294758830]) { items_page(limit: 100) { items { id name column_values { id value text } } } } }"
}
```

**Response:**
```json
{
    "data": {
        "boards": [
            {
                "items_page": {
                    "items": [
                        {
                            "id": "12345678",
                            "name": "ACADS - CL - Aug 12-13 - Client Name",
                            "column_values": [
                                { "id": "date4", "value": "2024-08-12", "text": "Aug 12, 2024" },
                                { "id": "date_1", "value": "2024-08-13", "text": "Aug 13, 2024" },
                                { "id": "status", "value": "{\"index\":1}", "text": "Confirmed" }
                            ]
                        }
                    ]
                }
            }
        ]
    }
}
```

### Create Expense Subitem

**GraphQL Mutation:**
```graphql
mutation {
    create_subitem(
        parent_item_id: "12345678",
        item_name: "Fuel - Aho LLC - $52.96",
        column_values: "{\"numbers\": \"52.96\", \"date4\": \"2024-08-12\", \"status\": {\"label\": \"CA\"}}"
    ) {
        id
        name
    }
}
```

**Column Mapping for Subitems:**

| Column | ID | Type | Purpose |
|--------|-----|------|---------|
| Amount | numbers | Number | Expense amount |
| Date | date4 | Date | Transaction date |
| State | status | Status | State code |
| Zoho ID | text | Text | Reference to Zoho |
| QBO ID | text_1 | Text | Reference to QBO |

### Caching Strategy

To reduce API calls, sync Monday events to Supabase `monday_events` table:

```sql
-- Daily sync job (run via n8n scheduled workflow)
-- Fetch events from Monday.com, upsert to monday_events
```

**Sync Query:**
```graphql
query {
    boards(ids: [8294758830]) {
        items_page(limit: 500) {
            cursor
            items {
                id
                name
                group { id title }
                column_values {
                    id
                    value
                    text
                }
            }
        }
    }
}
```

---

## Supabase API

### Configuration

| Setting | Value |
|---------|-------|
| Project URL | `https://{project-id}.supabase.co` |
| API URL | `https://{project-id}.supabase.co/rest/v1` |
| Auth | API Key (anon or service_role) |

### Authentication Headers

```http
apikey: {SUPABASE_ANON_KEY}
Authorization: Bearer {SUPABASE_ANON_KEY}
Content-Type: application/json
Prefer: return=representation
```

### Common Operations

#### Insert Bank Transaction

```http
POST https://{project-id}.supabase.co/rest/v1/bank_transactions
apikey: {key}
Authorization: Bearer {key}
Content-Type: application/json
Prefer: return=representation

{
    "source": "amex",
    "transaction_date": "2024-08-12",
    "post_date": "2024-08-13",
    "description": "AHO LLC FUEL",
    "amount": 52.96,
    "card_last_four": "1002",
    "reference_number": "1234567890",
    "status": "unmatched"
}
```

#### Query Unmatched Transactions

```http
GET https://{project-id}.supabase.co/rest/v1/bank_transactions?status=eq.unmatched&transaction_date=gte.2024-08-01&transaction_date=lte.2024-08-31&order=transaction_date.desc
apikey: {key}
Authorization: Bearer {key}
```

#### Update Transaction (Match)

```http
PATCH https://{project-id}.supabase.co/rest/v1/bank_transactions?id=eq.{uuid}
apikey: {key}
Authorization: Bearer {key}
Content-Type: application/json
Prefer: return=representation

{
    "status": "matched",
    "matched_expense_id": "5647323000000867498",
    "matched_at": "2024-08-15T10:30:00Z",
    "matched_by": "agent"
}
```

#### Query with Filters (Review Queue)

```http
GET https://{project-id}.supabase.co/rest/v1/expense_queue?status=eq.pending&order=created_at.desc&limit=50
apikey: {key}
Authorization: Bearer {key}
```

### n8n Supabase Node Configuration

```json
{
    "credentials": {
        "supabaseApi": {
            "host": "https://{project-id}.supabase.co",
            "serviceRole": "{service_role_key}"
        }
    }
}
```

---

## Microsoft Teams API

### Configuration

| Setting | Value |
|---------|-------|
| Team ID | `f0613636-3fad-41a9-bbb7-5bae893b0557` |
| Channel ID | `19:d522b5c7e9814e2cb085c7dfff760e61@thread.tacv2` |
| Channel Name | Expense-Approvals |
| Auth | OAuth 2.0 (Azure AD) |

### Send Channel Message

**Endpoint:** `POST /teams/{team-id}/channels/{channel-id}/messages`

**Request:**
```http
POST https://graph.microsoft.com/v1.0/teams/f0613636-3fad-41a9-bbb7-5bae893b0557/channels/19:d522b5c7e9814e2cb085c7dfff760e61@thread.tacv2/messages
Authorization: Bearer {access_token}
Content-Type: application/json

{
    "body": {
        "contentType": "html",
        "content": "<h3>EXPENSE FLAGGED FOR REVIEW</h3><p><strong>Vendor:</strong> Aho LLC<br><strong>Amount:</strong> $52.96<br><strong>Date:</strong> Aug 12, 2024<br><strong>Reason:</strong> No bank transaction match found<br><strong>AI Prediction:</strong> Fuel - COS, California, 78% confidence</p><p>Please approve or correct in the dashboard.</p>"
    }
}
```

### Message Format Template

```html
<h3>EXPENSE FLAGGED FOR REVIEW</h3>
<p>
    <strong>Vendor:</strong> {{vendor_name}}<br>
    <strong>Amount:</strong> ${{amount}}<br>
    <strong>Date:</strong> {{expense_date}}<br>
    <strong>Reason:</strong> {{flag_reason}}<br>
    <strong>AI Prediction:</strong> {{category}}, {{state}}, {{confidence}}% confidence
</p>
<p>Please <a href="{{dashboard_url}}/review">review in the dashboard</a>.</p>
```

---

## Authentication Summary

### OAuth 2.0 Tokens

| Service | Token Location | Refresh Strategy |
|---------|---------------|------------------|
| Zoho Expense | n8n credential store | Auto-refresh by n8n |
| QuickBooks | n8n credential store | Auto-refresh by n8n |
| Microsoft Teams | n8n credential store | Auto-refresh by n8n |

### API Keys

| Service | Key Type | Storage |
|---------|----------|---------|
| Supabase | Anon Key | Web app env vars |
| Supabase | Service Role Key | n8n credential store |
| Monday.com | API Token | n8n credential store |

### Environment Variables

```env
# Web App (.env)
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJI...

# n8n (credential store, not env vars)
# - Zoho OAuth
# - QuickBooks OAuth
# - Microsoft Teams OAuth
# - Supabase (service role)
# - Monday.com API Token
```

---

## Error Handling

### Common Error Codes

| Code | Service | Meaning | Action |
|------|---------|---------|--------|
| 401 | All | Unauthorized | Refresh token |
| 403 | All | Forbidden | Check permissions |
| 429 | All | Rate limited | Wait and retry |
| 500 | All | Server error | Retry with backoff |

### Retry Strategy

```javascript
async function retryWithBackoff(fn, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fn();
        } catch (error) {
            if (i === maxRetries - 1) throw error;
            if (error.status === 429 || error.status >= 500) {
                await sleep(Math.pow(2, i) * 1000); // 1s, 2s, 4s
            } else {
                throw error;
            }
        }
    }
}
```

### Error Logging

All API errors should be logged to `workflow_errors` table:

```sql
INSERT INTO workflow_errors (
    workflow_id,
    execution_id,
    node_name,
    error_type,
    error_message,
    expense_id,
    input_data
) VALUES (
    'ZZPC3jm6mXbLrp3u',
    'exec_123',
    'post_to_qbo',
    'API_ERROR',
    'Rate limit exceeded',
    '5647323000000867498',
    '{"amount": 52.96, ...}'
);
```

---

## Rate Limiting

### Service Limits

| Service | Limit | Window | Handling |
|---------|-------|--------|----------|
| Zoho Expense | 1000 | Day | Unlikely to hit |
| QuickBooks | 500 | Minute | Batch if needed |
| Monday.com | 1000 | Minute | Cache events |
| Teams | 30 | Minute | Batch notifications |
| Supabase | Unlimited* | - | N/A |

### Batching Strategy

For high-volume processing:
1. Queue expenses in `expense_queue` with `status = 'pending_post'`
2. Run batch job every 5 minutes to post to QBO (max 50/batch)
3. Update status to `posted` on success

---

*End of API Integration Guide*
