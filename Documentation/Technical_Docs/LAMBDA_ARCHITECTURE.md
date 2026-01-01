# Lambda-Based Expense Automation Architecture

**Version:** 1.0 | **Updated:** December 31, 2025

---

## System Overview

The AS3 Auto Bookkeeper processes expense reports from Zoho Expense and posts them to QuickBooks Online (QBO). The system uses:

- **Supabase Edge Functions** - Webhook handling, Zoho API integration
- **AWS Lambda** - Core expense processing logic
- **Supabase Database** - Data storage and queue management
- **Supabase Storage** - Receipt file storage

```
┌─────────────┐     ┌─────────────────────┐     ┌─────────────┐
│    Zoho     │────>│  Edge Function      │────>│  Supabase   │
│   Expense   │     │  receive-zoho-      │     │  Database   │
│  (webhook)  │     │  webhook            │     │             │
└─────────────┘     └─────────────────────┘     └──────┬──────┘
                              │                        │
                              │ (fetch receipt)        │ (trigger)
                              v                        v
                    ┌─────────────────────┐     ┌─────────────┐
                    │  Supabase Storage   │     │  pg_net     │
                    │  (expense-receipts) │     │  HTTP call  │
                    └─────────────────────┘     └──────┬──────┘
                                                       │
                                                       v
                                               ┌─────────────┐
                                               │ AWS Lambda  │
                                               │ process-    │
                                               │ expense     │
                                               └──────┬──────┘
                                                      │
                              ┌────────────────┬──────┴──────┬────────────────┐
                              v                v             v                v
                      ┌─────────────┐  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
                      │ Match Bank  │  │ AI Category │ │ Create QBO  │ │ Upload      │
                      │ Transaction │  │ Assignment  │ │ Purchase    │ │ Receipt     │
                      └─────────────┘  └─────────────┘ └─────────────┘ └─────────────┘
```

---

## Component Details

### 1. Supabase Edge Function: `receive-zoho-webhook`

**Location:** `supabase/functions/receive-zoho-webhook/index.ts`

**Responsibilities:**
- Receive Zoho expense report webhooks
- Authenticate with Zoho OAuth to fetch receipts
- Upload receipts to Supabase Storage
- Insert expense records into `zoho_expenses` table
- Trigger downstream processing via database trigger

**Key Configuration:**
| Secret | Purpose |
|--------|---------|
| `ZOHO_CLIENT_ID` | OAuth app client ID |
| `ZOHO_CLIENT_SECRET` | OAuth app client secret |
| `ZOHO_REFRESH_TOKEN` | Long-lived refresh token |
| `ZOHO_ORGANIZATION_ID` | Zoho Expense org ID |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key for storage |

**Zoho Receipt API:**
```
GET https://www.zohoapis.com/expense/v1/expenses/{expense_id}/receipt
Headers:
  Authorization: Zoho-oauthtoken {access_token}
  X-com-zoho-expense-organizationid: {org_id}
```

**Critical Notes:**
- Organization ID goes in HEADER, not URL path
- Content-Type from Zoho includes charset suffix (e.g., `image/jpeg;charset=UTF-8`) - must strip before uploading to Supabase Storage

---

### 2. Database Trigger: `trigger_queue_on_insert`

**Location:** Supabase database trigger on `zoho_expenses` table

**Function:** `process_expense_queue()`

**What it does:**
- Fires when new expense is inserted with `status = 'pending'`
- Calls Lambda via `pg_net.http_post()`
- Passes expense ID and metadata to Lambda

**Lambda Endpoint:**
```
POST https://7lvn2u8z5l.execute-api.us-east-1.amazonaws.com/prod/process-expense
Headers:
  Content-Type: application/json
  x-api-key: {api_key}
Body:
  { "expense_id": "uuid-here" }
```

---

### 3. AWS Lambda: `process-expense`

**Location:** `lambda/functions/process_expense/handler.py`

**Responsibilities:**
1. Fetch expense from Supabase
2. Validate receipt exists (REQUIRED - fails if missing)
3. Match to bank transaction (within date range, amount tolerance)
4. Determine QBO category via AI or rules
5. Determine state from Zoho tag or Monday.com event
6. Create QBO Purchase transaction
7. Upload receipt to QBO
8. Update Supabase with results

**Idempotency:** Uses DynamoDB table `as3-idempotency-prod` to prevent duplicate processing

**Key Dependencies (Lambda Layer):**
- `utils/qbo_client.py` - QBO API operations
- `utils/supabase_client.py` - Supabase operations
- `utils/token_manager.py` - QBO OAuth token management
- `utils/secrets.py` - AWS Secrets Manager integration

---

### 4. Supabase Storage: `expense-receipts`

**Bucket:** `expense-receipts`

**Path Format:** `receipts/{YYYY}/{MM}/{zoho_expense_id}.{ext}`

**Example:** `receipts/2025/12/5647323000001110005.jpg`

**Access:** Service role key required for uploads; signed URLs for downloads

---

## Data Flow

### Happy Path (Automatic Processing)

1. **Zoho** sends webhook when expense report is approved
2. **Edge Function** receives webhook, fetches receipt from Zoho API
3. **Edge Function** uploads receipt to Supabase Storage
4. **Edge Function** inserts expense into `zoho_expenses` with `status: pending`
5. **Database Trigger** fires, calls Lambda via pg_net
6. **Lambda** processes expense:
   - Matches to bank transaction
   - Gets AI categorization
   - Creates QBO Purchase
   - Uploads receipt to QBO
7. **Lambda** updates expense `status: posted`

### Flagged Path (Human Review Required)

If Lambda cannot automatically process (no bank match, low confidence, etc.):

1. Lambda sets `status: flagged` with `flag_reason`
2. Expense appears in web app's Exception Dashboard
3. Human reviews and makes corrections
4. Human approves → Lambda reprocesses with overrides
5. Expense posts to QBO

---

## Key Tables

| Table | Purpose |
|-------|---------|
| `zoho_expenses` | Main expense records |
| `zoho_expense_reports` | Report metadata |
| `bank_transactions` | Bank feed data for matching |
| `qbo_accounts` | Category → QBO account mapping |
| `qbo_classes` | State → QBO class mapping |

---

## Monitoring & Debugging

### Edge Function Logs
- Supabase Dashboard → Edge Functions → `receive-zoho-webhook` → Logs

### Lambda Logs
- AWS CloudWatch → Log Groups → `/aws/lambda/process-expense`

### Database Queries
```sql
-- Recent expenses with status
SELECT zoho_expense_id, merchant_name, amount, status,
       receipt_storage_path, qbo_purchase_id, flag_reason
FROM zoho_expenses
ORDER BY created_at DESC
LIMIT 20;

-- Failed expenses
SELECT * FROM zoho_expenses
WHERE status = 'flagged'
ORDER BY created_at DESC;
```

---

## Common Issues

See `TROUBLESHOOTING.md` for detailed solutions.

| Issue | Likely Cause |
|-------|--------------|
| "Receipt not fetched" | Zoho OAuth token expired/invalid |
| "mime type not supported" | Content-Type has charset suffix |
| "No bank transaction match" | Transaction not imported or date mismatch |
| "invalid_code" from Zoho | Refresh token is invalid |

---

## Deployment

### Edge Function
1. Edit in Supabase Dashboard → Edge Functions
2. Copy code from `supabase/functions/receive-zoho-webhook/index.ts`
3. Save and deploy

### Lambda
```bash
cd lambda
sam build
sam deploy --guided
```

### Secrets
- **Supabase:** Project Settings → Edge Functions → Secrets
- **AWS:** Secrets Manager → `as3-bookkeeper/prod`

---

*Last updated: December 31, 2025 - Lambda system fully operational*
