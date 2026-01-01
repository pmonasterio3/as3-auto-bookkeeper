# AS3 Auto Bookkeeper - Lambda Deployment Guide

**Version:** 1.0
**Created:** December 30, 2025
**AWS Account:** 918167424163
**Region:** us-east-1 (recommended)

---

## Prerequisites Checklist

| Prerequisite | Status | Notes |
|--------------|--------|-------|
| AWS CLI installed | ✅ Ready | v2.28.14 |
| AWS credentials configured | ✅ Ready | User: pom@as3.mx |
| SAM CLI installed | ❌ Needed | Install via winget/chocolatey |
| Python 3.12 | ❓ Check | Required for local testing |
| Docker (optional) | ❓ Check | For local Lambda testing |

---

## Phase 1: Environment Setup

### Task 1.1: Install AWS SAM CLI

**Windows (via winget - Recommended):**
```powershell
winget install Amazon.SAM-CLI
```

**Windows (via MSI):**
Download from: https://github.com/aws/aws-sam-cli/releases/latest

**Verify installation:**
```bash
sam --version
```

### Task 1.2: Verify Python 3.12

```bash
python --version
# Should be 3.12.x
```

If not installed:
```powershell
winget install Python.Python.3.12
```

### Task 1.3: Set AWS Region

```bash
aws configure set region us-east-1
```

---

## Phase 2: Create AWS Resources

### Task 2.1: Create Secrets Manager Secret

Create a secret with all required credentials:

```bash
aws secretsmanager create-secret \
    --name as3-bookkeeper \
    --description "AS3 Auto Bookkeeper credentials" \
    --secret-string '{
        "SUPABASE_URL": "https://your-project.supabase.co",
        "SUPABASE_KEY": "your-service-role-key",
        "SUPABASE_ANON_KEY": "your-anon-key",
        "ANTHROPIC_API_KEY": "sk-ant-api...",
        "QBO_CLIENT_ID": "your-qbo-client-id",
        "QBO_CLIENT_SECRET": "your-qbo-client-secret",
        "QBO_COMPANY_ID": "123146088634019",
        "MONDAY_API_KEY": "your-monday-api-key"
    }'
```

**Values to collect:**
| Secret | Source | Current Value Location |
|--------|--------|------------------------|
| SUPABASE_URL | Supabase Dashboard → Settings → API | Project URL |
| SUPABASE_KEY | Supabase Dashboard → Settings → API | service_role key |
| SUPABASE_ANON_KEY | Supabase Dashboard → Settings → API | anon key |
| ANTHROPIC_API_KEY | console.anthropic.com | API Keys |
| QBO_CLIENT_ID | developer.intuit.com | Your App |
| QBO_CLIENT_SECRET | developer.intuit.com | Your App |
| QBO_COMPANY_ID | 123146088634019 | Fixed |
| MONDAY_API_KEY | monday.com → Admin → API | Personal API Token |

### Task 2.2: Create DynamoDB Table for QBO Tokens

```bash
aws dynamodb create-table \
    --table-name qbo-oauth-tokens \
    --attribute-definitions AttributeName=pk,AttributeType=S \
    --key-schema AttributeName=pk,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST \
    --tags Key=Project,Value=as3-bookkeeper
```

### Task 2.3: Seed Initial QBO OAuth Tokens

Get current tokens from your existing system (n8n or stored credentials):

```bash
aws dynamodb put-item \
    --table-name qbo-oauth-tokens \
    --item '{
        "pk": {"S": "QBO_TOKEN"},
        "access_token": {"S": "YOUR_CURRENT_ACCESS_TOKEN"},
        "refresh_token": {"S": "YOUR_CURRENT_REFRESH_TOKEN"},
        "access_token_expires_at": {"N": "1735600000"},
        "refresh_token_expires_at": {"N": "1751152000"},
        "version": {"N": "1"},
        "updated_at": {"S": "2025-12-30T00:00:00Z"}
    }'
```

**To get current QBO tokens:**
1. Check n8n QBO credential node
2. Or use QBO OAuth Playground to generate fresh tokens

### Task 2.4: Create SNS Topic for Alerts

```bash
aws sns create-topic --name as3-bookkeeper-alerts

# Get the topic ARN from output, then create email subscription:
aws sns subscribe \
    --topic-arn arn:aws:sns:us-east-1:918167424163:as3-bookkeeper-alerts \
    --protocol email \
    --notification-endpoint pmonasterio@as3drivertraining.com
```

---

## Phase 3: Build and Deploy Lambda

### Task 3.1: Navigate to Lambda Directory

```bash
cd "C:\Users\pom\OneDrive - AS3 Driver Training\Python Projects\as3_reports\GitHub Repo\as3-auto-bookkeeper\lambda"
```

### Task 3.2: Build the SAM Application

```bash
sam build
```

This will:
- Install Python dependencies
- Package Lambda functions
- Prepare CloudFormation template

### Task 3.3: Deploy to AWS (First Time)

```bash
sam deploy --guided
```

**Guided prompts - use these values:**

| Prompt | Value |
|--------|-------|
| Stack Name | as3-bookkeeper |
| AWS Region | us-east-1 |
| Confirm changes before deploy | Y |
| Allow SAM CLI IAM role creation | Y |
| Disable rollback | N |
| Save arguments to configuration file | Y |
| SAM configuration file | samconfig.toml |
| SAM configuration environment | default |

### Task 3.4: Note the Outputs

After deployment, SAM will output:
- **ApiEndpoint**: The API Gateway URL (e.g., `https://abc123.execute-api.us-east-1.amazonaws.com/prod`)
- **ApiKey**: The API key for authentication

Save these for Phase 5.

---

## Phase 4: Verify Deployment

### Task 4.1: Check Lambda Functions

```bash
aws lambda list-functions --query "Functions[?starts_with(FunctionName, 'as3-')].FunctionName"
```

Expected output:
```json
[
    "as3-process-expense",
    "as3-human-approved",
    "as3-recover-stuck",
    "as3-process-orphans"
]
```

### Task 4.2: Check API Gateway

```bash
aws apigateway get-rest-apis --query "items[?name=='as3-bookkeeper-api']"
```

### Task 4.3: Get API Key

```bash
aws apigateway get-api-keys --include-values --query "items[?name=='as3-bookkeeper-api-key'].value"
```

### Task 4.4: Test the API Endpoint

```bash
# Replace with your actual values
API_URL="https://YOUR_API_ID.execute-api.us-east-1.amazonaws.com/prod"
API_KEY="YOUR_API_KEY"

curl -X POST "$API_URL/process-expense" \
    -H "Content-Type: application/json" \
    -H "x-api-key: $API_KEY" \
    -d '{"expense_id": "test-123", "retry_count": 0}'
```

Expected: 400 error (expense not found) - this confirms the API is working.

---

## Phase 5: Configure Supabase Trigger

### Task 5.1: Get Current Trigger Function

In Supabase SQL Editor, run:

```sql
-- View current function
SELECT prosrc FROM pg_proc WHERE proname = 'process_expense_queue';
```

### Task 5.2: Update Trigger URL

```sql
-- Update the webhook URL to point to Lambda
CREATE OR REPLACE FUNCTION process_expense_queue()
RETURNS trigger AS $$
BEGIN
    -- Call AWS Lambda API Gateway
    PERFORM net.http_post(
        url := 'https://YOUR_API_ID.execute-api.us-east-1.amazonaws.com/prod/process-expense',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-api-key', 'YOUR_API_KEY'
        ),
        body := jsonb_build_object(
            'expense_id', NEW.id::text,
            'zoho_expense_id', NEW.zoho_expense_id,
            'retry_count', 0
        )
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

### Task 5.3: Update Web App Webhook URL

In `expense-dashboard/src/features/review/services/reviewActions.ts`, update:

```typescript
const HUMAN_APPROVED_URL = 'https://YOUR_API_ID.execute-api.us-east-1.amazonaws.com/prod/human-approved';
const HUMAN_APPROVED_API_KEY = 'YOUR_API_KEY';
```

---

## Phase 6: Testing & Validation

### Task 6.1: Test with Real Expense

1. Approve a test expense in Zoho
2. Monitor CloudWatch logs:
```bash
aws logs tail /aws/lambda/as3-process-expense --follow
```

### Task 6.2: Verify QBO Posting

Check QuickBooks Online for the new Purchase transaction.

### Task 6.3: Monitor Metrics

```bash
aws cloudwatch get-metric-statistics \
    --namespace AS3Bookkeeper \
    --metric-name ExpensesProcessed \
    --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ) \
    --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
    --period 300 \
    --statistics Sum
```

---

## Phase 7: Cutover Checklist

| Task | Status | Notes |
|------|--------|-------|
| All Lambda functions deployed | ☐ | |
| Secrets Manager configured | ☐ | |
| DynamoDB table with QBO tokens | ☐ | |
| API Gateway accessible | ☐ | |
| Supabase trigger updated | ☐ | |
| Web app webhook updated | ☐ | |
| Test expense processed successfully | ☐ | |
| QBO Purchase created correctly | ☐ | |
| Monday subitem created (for COS) | ☐ | |
| 24-hour monitoring passed | ☐ | |
| n8n workflows disabled | ☐ | |

---

## Rollback Procedure

If issues arise, rollback to n8n:

### Immediate Rollback (Supabase Trigger)

```sql
-- Revert to n8n webhook
CREATE OR REPLACE FUNCTION process_expense_queue()
RETURNS trigger AS $$
BEGIN
    PERFORM net.http_post(
        url := 'https://n8n.as3drivertraining.com/webhook/process-expense',
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body := jsonb_build_object(
            'expense_id', NEW.id::text,
            'zoho_expense_id', NEW.zoho_expense_id
        )
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

### Delete Lambda Stack

```bash
sam delete --stack-name as3-bookkeeper
```

---

## Maintenance Commands

### Update Lambda Code

```bash
cd lambda
sam build
sam deploy
```

### View Logs

```bash
# Process expense function
aws logs tail /aws/lambda/as3-process-expense --follow

# Human approved function
aws logs tail /aws/lambda/as3-human-approved --follow

# All functions
aws logs tail /aws/lambda/as3-process-expense --follow &
aws logs tail /aws/lambda/as3-human-approved --follow &
```

### Update Secrets

```bash
aws secretsmanager update-secret \
    --secret-id as3-bookkeeper \
    --secret-string '{"KEY": "NEW_VALUE", ...}'
```

### Refresh QBO Tokens Manually

```bash
# Get current tokens
aws dynamodb get-item \
    --table-name qbo-oauth-tokens \
    --key '{"pk": {"S": "QBO_TOKEN"}}'

# Update with new tokens
aws dynamodb put-item \
    --table-name qbo-oauth-tokens \
    --item '{
        "pk": {"S": "QBO_TOKEN"},
        "access_token": {"S": "NEW_ACCESS_TOKEN"},
        "refresh_token": {"S": "NEW_REFRESH_TOKEN"},
        "access_token_expires_at": {"N": "EXPIRY_TIMESTAMP"},
        "version": {"N": "2"}
    }'
```

---

## Troubleshooting

### Lambda Timeout

If processing times out (>5 min):
1. Check CloudWatch logs for where it's stuck
2. Consider increasing timeout in template.yaml
3. Check if AI agent is looping

### QBO 401 Errors

Token expired or invalid:
1. Check DynamoDB for token expiry
2. Manually refresh tokens using QBO OAuth Playground
3. Update DynamoDB with fresh tokens

### No Bank Match Found

1. Verify bank transactions are imported
2. Check date range tolerance
3. Look for amount discrepancies (tips, taxes)

### Supabase Connection Issues

1. Verify SUPABASE_URL and SUPABASE_KEY in Secrets Manager
2. Check if service_role key (not anon key) is used
3. Verify RLS policies allow service_role access

---

## Cost Estimation

| Service | Estimated Monthly Cost |
|---------|----------------------|
| Lambda (1000 invocations) | ~$5 |
| API Gateway | ~$3 |
| DynamoDB | ~$1 |
| Secrets Manager | ~$1 |
| CloudWatch Logs | ~$2 |
| SNS | <$1 |
| **Total** | **~$13/month** |

vs. n8n Cloud: ~$99/month

---

## Support Contacts

- **AWS Issues**: AWS Support Console
- **QBO API**: developer.intuit.com/support
- **Anthropic API**: support@anthropic.com
- **Internal**: pmonasterio@as3drivertraining.com
