# AS3 Auto Bookkeeper - System Management Guide

**Version:** 1.0
**Last Updated:** December 31, 2025
**Purpose:** Complete technical reference for all agents working on this system

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Repository Location](#2-repository-location)
3. [AWS Lambda Infrastructure](#3-aws-lambda-infrastructure)
4. [Supabase Edge Functions](#4-supabase-edge-functions)
5. [Database Schema](#5-database-schema)
6. [Secrets Management](#6-secrets-management)
7. [External API Integrations](#7-external-api-integrations)
8. [MCP Tools Available](#8-mcp-tools-available)
9. [Deployment Procedures](#9-deployment-procedures)
10. [Data Flow Architecture](#10-data-flow-architecture)
11. [Troubleshooting](#11-troubleshooting)

---

## 1. System Overview

AS3 Auto Bookkeeper is an automated expense processing system that:
- Receives approved expenses from Zoho Expense via webhooks
- Fetches and stores receipt images from Zoho API
- Uses Claude AI to validate receipts, match bank transactions, and determine state codes
- Posts Purchase transactions to QuickBooks Online
- Creates expense subitems in Monday.com for COS (Cost of Sales) tracking
- Provides a web dashboard for human review of flagged expenses

### Architecture Summary

```
Zoho Expense → Edge Function → Supabase DB → Lambda (AI Agent) → QBO + Monday.com
                    ↓
            Supabase Storage (receipts)
```

---

## 2. Repository Location

### Local Path
```
C:\Users\pom\OneDrive - AS3 Driver Training\Python Projects\as3_reports\GitHub Repo\as3-auto-bookkeeper
```

### Directory Structure
```
as3-auto-bookkeeper/
├── CLAUDE.md                          # Project conventions (READ FIRST)
├── Documentation/
│   ├── Technical_Docs/
│   │   ├── SYSTEM_MANAGEMENT_GUIDE.md # THIS FILE
│   │   ├── PROJECT_CHANGELOG.md       # Historical fixes
│   │   └── SYSTEM_BOUNDARIES.md       # Component responsibilities
│   ├── expense-automation-architecture.md
│   └── database-schema.md
├── lambda/                            # AWS Lambda functions
│   ├── template.yaml                  # SAM template
│   ├── samconfig.toml                 # SAM deployment config
│   ├── functions/                     # Lambda function code
│   └── layers/                        # Shared dependencies
├── supabase/
│   ├── functions/                     # Edge Functions
│   └── migrations/                    # Database migrations
└── expense-dashboard/                 # React web application
```

---

## 3. AWS Lambda Infrastructure

### Stack Details

| Property | Value |
|----------|-------|
| **Stack Name** | `as3-bookkeeper` |
| **Region** | `us-east-1` (verify in AWS Console) |
| **Runtime** | Python 3.13 |
| **Timeout** | 300 seconds (5 minutes) |
| **Memory** | 1024 MB |

### Lambda Functions

#### 3.1 ProcessExpenseFunction
- **Name:** `as3-process-expense-prod`
- **Path:** `lambda/functions/process_expense/`
- **Handler:** `handler.lambda_handler`
- **Trigger:** API Gateway POST `/process-expense`
- **Purpose:** Main AI agent for processing Zoho expenses

**Key Files:**
| File | Purpose |
|------|---------|
| `handler.py` | Lambda entry point, orchestrates processing |
| `agent.py` | Claude AI agent loop with tool_use |
| `tools/__init__.py` | Tool exports |
| `tools/receipt_validation.py` | `validate_receipt` tool |
| `tools/bank_matching.py` | `match_bank_transaction` tool |
| `tools/state_determination.py` | `determine_state` tool |
| `tools/qbo_operations.py` | `lookup_qbo_expense_account`, `lookup_qbo_vendor`, `create_qbo_vendor`, `create_qbo_purchase`, `upload_receipt_to_qbo` tools |
| `tools/monday_operations.py` | `create_monday_subitem` tool |
| `tools/review_flagging.py` | `flag_for_review` tool |
| `prompts/expense_processor.py` | System and user prompts |

#### 3.2 HumanApprovedFunction
- **Name:** `as3-human-approved-prod`
- **Path:** `lambda/functions/human_approved/`
- **Handler:** `handler.lambda_handler`
- **Trigger:** API Gateway POST `/human-approved`
- **Purpose:** Process human-approved expenses from review queue

#### 3.3 RecoverStuckFunction
- **Name:** `as3-recover-stuck-prod`
- **Path:** `lambda/functions/recover_stuck/`
- **Handler:** `handler.lambda_handler`
- **Trigger:** CloudWatch Events (every 5 minutes)
- **Purpose:** Reset expenses stuck in "processing" state

#### 3.4 ProcessOrphansFunction
- **Name:** `as3-process-orphans-prod`
- **Path:** `lambda/functions/process_orphans/`
- **Handler:** `handler.lambda_handler`
- **Trigger:** CloudWatch Events (daily at 6 AM UTC)
- **Purpose:** Process orphan bank transactions (Agent 2)

### Common Layer

**Path:** `lambda/layers/common/python/`

| Module | Purpose |
|--------|---------|
| `utils/supabase_client.py` | Supabase database operations |
| `utils/qbo_client.py` | QuickBooks Online API client |
| `utils/monday_client.py` | Monday.com GraphQL client |
| `utils/secrets.py` | AWS Secrets Manager access |
| `utils/token_manager.py` | QBO OAuth token management |
| `models/expense.py` | Expense data model |
| `models/bank_transaction.py` | Bank transaction model |
| `models/processing_result.py` | Processing result model |

### DynamoDB Tables

| Table | Purpose |
|-------|---------|
| `as3-qbo-tokens-prod` | QBO OAuth token storage with version locking |
| `as3-idempotency-prod` | Request deduplication (24h TTL) |

### API Gateway

- **Endpoint:** `https://{api-id}.execute-api.{region}.amazonaws.com/prod`
- **Authentication:** API Key required (`X-Api-Key` header)
- **Endpoints:**
  - `POST /process-expense` - Trigger expense processing
  - `POST /human-approved` - Process human-approved items

---

## 4. Supabase Edge Functions

### Deployment Method
**IMPORTANT:** Edge functions are deployed via **Supabase Dashboard** (not CLI).

Dashboard: https://supabase.com/dashboard → Project → Edge Functions

### Edge Functions

#### 4.1 receive-zoho-webhook
- **Path:** `supabase/functions/receive-zoho-webhook/`
- **Purpose:** Receives Zoho expense webhooks, fetches receipts from Zoho API, stores in database
- **Trigger:** Zoho Expense webhook on report approval
- **Files:** Single combined `index.ts` (includes zoho-receipt-fetcher code)

**Flow:**
1. Receives webhook payload from Zoho
2. For each expense: fetches receipt from Zoho API using OAuth
3. Uploads receipt to Supabase Storage (`expense-receipts` bucket)
4. Inserts expense record with `receipt_storage_path`
5. Sets `status: 'pending'` to trigger Lambda processing

#### 4.2 fetch-receipt
- **Path:** `supabase/functions/fetch-receipt/`
- **Purpose:** Retrieves receipt images from Supabase Storage
- **Used by:** Lambda AI agent for receipt validation

#### 4.3 validate-receipt
- **Path:** `supabase/functions/validate-receipt/`
- **Purpose:** AI-powered receipt validation (Claude vision)

#### 4.4 create-monday-subitem
- **Path:** `supabase/functions/create-monday-subitem/`
- **Purpose:** Creates expense subitems in Monday.com

#### 4.5 invite-user / accept-invite
- **Path:** `supabase/functions/invite-user/`, `supabase/functions/accept-invite/`
- **Purpose:** User invitation management for web dashboard

### Relationship: Edge Functions ↔ Lambda

```
┌─────────────────────┐     pg_net trigger     ┌─────────────────────┐
│  receive-zoho-      │ ──────────────────────→│  ProcessExpense     │
│  webhook            │   POST /process-expense│  Lambda             │
│  (Edge Function)    │                        │                     │
└─────────────────────┘                        └─────────────────────┘
         │                                              │
         ↓                                              ↓
┌─────────────────────┐                        ┌─────────────────────┐
│  Supabase Storage   │←───────────────────────│  fetch-receipt      │
│  (expense-receipts) │   Lambda calls edge fn │  (Edge Function)    │
└─────────────────────┘                        └─────────────────────┘
```

---

## 5. Database Schema

### Platform
- **Provider:** Supabase (PostgreSQL)
- **Project URL:** Stored in secrets (see Section 6)

### Core Tables

| Table | Rows | Purpose |
|-------|------|---------|
| `zoho_expenses` | 287 | Main expense records from Zoho |
| `bank_transactions` | 882 | Bank feed data (AMEX, Wells Fargo) |
| `zoho_expense_reports` | 37 | Expense report metadata |
| `qbo_accounts` | 78 | QBO expense account mappings |
| `qbo_classes` | 8 | State code → QBO Class ID mapping |
| `vendor_rules` | 56 | Vendor categorization rules |
| `receipt_validations` | 81 | AI receipt validation results |
| `processing_log` | 269 | Processing audit trail |
| `user_profiles` | 1 | Web app users |

### Key Relationships

```
zoho_expenses
  ├── bank_transaction_id → bank_transactions.id
  ├── zoho_report_id → zoho_expense_reports.zoho_report_id
  └── receipt_validation_id → receipt_validations.id
```

### QBO Class IDs (State Tracking)

| State | QBO Class ID |
|-------|--------------|
| CA | 1000000004 |
| TX | 1000000006 |
| CO | 1000000007 |
| WA | 1000000008 |
| NJ | 1000000009 |
| FL | 1000000010 |
| MT | 1000000011 |
| NC (Admin) | 1000000012 |

### Triggers

**pg_net Webhook Trigger:** When `zoho_expenses` status changes to 'pending', fires HTTP POST to Lambda API Gateway.

---

## 6. Secrets Management

### AWS Secrets Manager (Lambda)

**Secret Name:** `as3-bookkeeper-secrets`

| Key | Purpose |
|-----|---------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Supabase service role key |
| `ANTHROPIC_API_KEY` | Claude AI API key |
| `QBO_CLIENT_ID` | QuickBooks OAuth client ID |
| `QBO_CLIENT_SECRET` | QuickBooks OAuth client secret |
| `MONDAY_API_KEY` | Monday.com API token |
| `TEAMS_WEBHOOK_URL` | Microsoft Teams notifications |

**Access Pattern:**
```python
from utils.secrets import get_secret
api_key = get_secret("ANTHROPIC_API_KEY")
```

### Supabase Edge Function Secrets

Set via: Dashboard → Edge Functions → Secrets

| Key | Purpose |
|-----|---------|
| `ZOHO_CLIENT_ID` | Zoho OAuth client ID |
| `ZOHO_CLIENT_SECRET` | Zoho OAuth client secret |
| `ZOHO_REFRESH_TOKEN` | Zoho refresh token (Self Client) |
| `ZOHO_ORGANIZATION_ID` | Zoho organization: `867260975` |

**Access Pattern (Deno):**
```typescript
const clientId = Deno.env.get('ZOHO_CLIENT_ID')
```

### QBO OAuth Tokens

Stored in DynamoDB table `as3-qbo-tokens-prod` with version locking for concurrent refresh handling.

---

## 7. External API Integrations

### 7.1 Zoho Expense API

| Property | Value |
|----------|-------|
| **Base URL** | `https://www.zohoapis.com/expense/v1` |
| **Organization ID** | `867260975` |
| **Auth** | OAuth 2.0 (`Zoho-oauthtoken {access_token}`) |
| **Client Type** | Self Client (generates tokens directly) |

**Key Endpoints:**
- `GET /organizations/{org_id}/expenses/{expense_id}/receipt` - Fetch receipt

### 7.2 QuickBooks Online API

| Property | Value |
|----------|-------|
| **Base URL** | `https://quickbooks.api.intuit.com/v3` |
| **Company ID** | `123146088634019` |
| **Auth** | OAuth 2.0 Bearer token |

**Payment Account IDs:**
- AMEX: `99`
- Wells Fargo: `49`

**Key Endpoints:**
- `POST /company/{id}/purchase` - Create expense
- `POST /company/{id}/upload` - Upload attachments
- `GET /company/{id}/query` - Query entities

### 7.3 Monday.com API

| Property | Value |
|----------|-------|
| **URL** | `https://api.monday.com/v2` |
| **Auth** | API Token in `Authorization` header |
| **API Version** | `2024-10` |

**Board IDs:**
- Training Calendar: `8294758830`
- Course Revenue Tracker: `18381611621`
- Subitems Board: `18381637294`

### 7.4 Anthropic Claude API

| Property | Value |
|----------|-------|
| **Model** | `claude-sonnet-4-20250514` |
| **Max Tokens** | 4096 |
| **Max Iterations** | 15 (agent loop) |
| **Confidence Threshold** | 90% for auto-processing |

---

## 8. MCP Tools Available

### 8.1 Supabase MCP

| Tool | Purpose |
|------|---------|
| `mcp__supabase__execute_sql` | Run SQL queries |
| `mcp__supabase__list_tables` | List database tables |
| `mcp__supabase__apply_migration` | Apply DDL changes |
| `mcp__supabase__get_logs` | Get service logs |
| `mcp__supabase__list_edge_functions` | List edge functions |
| `mcp__supabase__deploy_edge_function` | Deploy edge function |

### 8.2 n8n MCP (Legacy)

| Tool | Purpose |
|------|---------|
| `mcp__n8n-mcp__search_workflows` | Search n8n workflows |
| `mcp__n8n-mcp__execute_workflow` | Execute workflow |
| `mcp__n8n-mcp__get_workflow_details` | Get workflow details |

### 8.3 Context7 MCP

| Tool | Purpose |
|------|---------|
| `mcp__context7__resolve-library-id` | Find library documentation |
| `mcp__context7__query-docs` | Query library docs |

### 8.4 Playwright MCP

Browser automation tools for testing web interfaces.

---

## 9. Deployment Procedures

### 9.1 Lambda Deployment (SAM CLI)

```bash
# Navigate to lambda directory
cd lambda

# Build the application
sam build

# Deploy (uses samconfig.toml for defaults)
sam deploy

# Deploy with parameter override
sam deploy --parameter-overrides "SupabaseUrl=https://xxx.supabase.co"

# View deployed stack
sam list stack-outputs --stack-name as3-bookkeeper
```

**If build fails with permission errors:**
```bash
rm -rf .aws-sam
sam build
```

### 9.2 Edge Function Deployment (Dashboard)

1. Go to https://supabase.com/dashboard
2. Select project → Edge Functions
3. Click function → Edit
4. Paste updated code
5. Deploy

**For multi-file functions:** Combine into single `index.ts` file.

### 9.3 Database Migrations

```bash
# Via MCP tool
mcp__supabase__apply_migration(name="add_column_xyz", query="ALTER TABLE...")

# Or via Dashboard SQL Editor
```

---

## 10. Data Flow Architecture

### Complete Flow: Zoho → QBO

```
1. ZOHO EXPENSE APPROVED
   └─→ Webhook fires to Supabase Edge Function

2. RECEIVE-ZOHO-WEBHOOK (Edge Function)
   ├─→ Fetch receipt from Zoho API (OAuth)
   ├─→ Upload receipt to Supabase Storage
   ├─→ Insert into zoho_expenses (status='pending')
   └─→ pg_net trigger fires

3. PG_NET TRIGGER
   └─→ HTTP POST to Lambda API Gateway

4. PROCESS-EXPENSE LAMBDA
   ├─→ Fetch expense from Supabase
   ├─→ Update status to 'processing'
   ├─→ Run AI Agent Loop:
   │   ├─→ validate_receipt (Claude vision)
   │   ├─→ match_bank_transaction
   │   ├─→ determine_state
   │   ├─→ lookup_qbo_expense_account
   │   ├─→ lookup_qbo_vendor / create_qbo_vendor
   │   ├─→ create_qbo_purchase
   │   ├─→ upload_receipt_to_qbo
   │   └─→ create_monday_subitem (if COS)
   └─→ Update status to 'posted' or 'flagged'

5. IF FLAGGED
   └─→ Web dashboard shows in review queue

6. IF HUMAN APPROVED
   └─→ HUMAN-APPROVED LAMBDA processes
```

### Critical Guardrails

1. **Receipt MUST exist:** If `receipt_storage_path` is null, Lambda hard fails (not flagged)
2. **Bank match required:** Every expense must match exactly one bank transaction
3. **Account lookup required:** Must call `lookup_qbo_expense_account` before `create_qbo_purchase`

---

## 11. Troubleshooting

### Common Issues

#### "Receipt not fetched from Zoho API"
- Check Edge Function secrets (ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN)
- Verify refresh token is valid (may need to regenerate via Self Client)
- Check Supabase Edge Function logs

#### Lambda timeout
- Check CloudWatch logs for stuck API calls
- Verify external APIs are responding
- Check if AI agent is looping (max 15 iterations)

#### QBO "invalid_grant"
- QBO refresh token expired (100 days lifetime)
- Regenerate via QBO OAuth flow

#### Monday.com GraphQL errors
- Check API version header (`API-Version: 2024-10`)
- Verify enum values (e.g., `lower_than_or_equal` not `less_than_or_equals`)

### Log Locations

| Component | Location |
|-----------|----------|
| Lambda | CloudWatch Logs `/aws/lambda/as3-process-expense-prod` |
| Edge Functions | Supabase Dashboard → Logs → Edge Functions |
| Database | `mcp__supabase__get_logs(service="postgres")` |

### Generating New Zoho Refresh Token

1. Go to https://api-console.zoho.com/
2. Select existing Self Client (or create new)
3. Click "Generate Code" with scope `ZohoExpense.fullaccess.all`
4. Run exchange command:
```bash
curl -X POST "https://accounts.zoho.com/oauth/v2/token" \
  -d "code=GENERATED_CODE" \
  -d "client_id=YOUR_CLIENT_ID" \
  -d "client_secret=YOUR_CLIENT_SECRET" \
  -d "grant_type=authorization_code"
```
5. Update `ZOHO_REFRESH_TOKEN` in Edge Function secrets

---

## Quick Reference Card

| Need To | Command/Action |
|---------|----------------|
| Deploy Lambda | `cd lambda && sam build && sam deploy` |
| Deploy Edge Function | Supabase Dashboard → Edge Functions |
| Check Lambda logs | CloudWatch → Log groups → `/aws/lambda/as3-*` |
| Check Edge Function logs | Supabase Dashboard → Logs |
| Query database | `mcp__supabase__execute_sql` |
| Get API Gateway URL | `sam list stack-outputs --stack-name as3-bookkeeper` |
| Test Lambda locally | `sam local invoke ProcessExpenseFunction -e event.json` |

---

*This document should be updated whenever system architecture changes.*
