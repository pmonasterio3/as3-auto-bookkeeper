# Implementation Action Plan: Queue-Based Architecture v3.0

**Version:** 1.0
**Created:** December 11, 2025
**Owner:** Pablo Ortiz-Monasterio + Claude AI
**Target Completion:** December 18, 2025

---

## Executive Summary

This document outlines the step-by-step implementation plan for transitioning from the current loop-based n8n workflow to a queue-based architecture that solves memory exhaustion issues with large expense reports.

### Problem Statement
- n8n Cloud ran out of memory processing a 23-expense report
- Root cause: Binary data (receipts) duplicated at each loop iteration (~188MB total)
- Current architecture is fundamentally incompatible with binary data at scale

### Solution
- **Supabase-First Ingestion**: Zoho webhook → Edge Function → Database
- **Queue-Based Processing**: Database triggers n8n to process one expense at a time
- **Memory Isolation**: Each n8n execution has fresh memory

---

## Phase 1: Database Infrastructure (Day 1)

### 1.1 Enable pg_net Extension

**Location:** Supabase SQL Editor

```sql
-- Enable pg_net for async HTTP calls from triggers
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
```

**Verification:**
```sql
SELECT * FROM pg_extension WHERE extname = 'pg_net';
```

### 1.2 Create zoho_expenses Table

**Location:** Supabase SQL Editor

```sql
CREATE TABLE zoho_expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Zoho identifiers
    zoho_expense_id TEXT UNIQUE NOT NULL,
    zoho_report_id TEXT NOT NULL,
    zoho_report_name TEXT,

    -- Raw payload
    raw_payload JSONB NOT NULL,

    -- Extracted expense details
    expense_date DATE NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    merchant_name TEXT,
    category_name TEXT,
    state_tag TEXT,
    paid_through TEXT,

    -- Receipt storage
    receipt_storage_path TEXT,
    receipt_content_type TEXT,

    -- Processing status
    status TEXT DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'matched', 'posted', 'flagged', 'error')),
    processing_attempts INT DEFAULT 0,
    processing_started_at TIMESTAMPTZ,
    last_error TEXT,

    -- Matching results
    bank_transaction_id UUID REFERENCES bank_transactions(id),
    match_confidence INT CHECK (match_confidence >= 0 AND match_confidence <= 100),

    -- QBO posting results
    qbo_purchase_id TEXT,
    qbo_posted_at TIMESTAMPTZ,

    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    processed_at TIMESTAMPTZ
);

-- Indexes for queue operations
CREATE INDEX idx_zoho_expenses_status ON zoho_expenses(status);
CREATE INDEX idx_zoho_expenses_pending ON zoho_expenses(status, created_at)
    WHERE status = 'pending';
CREATE INDEX idx_zoho_expenses_processing ON zoho_expenses(status, processing_started_at)
    WHERE status = 'processing';
CREATE INDEX idx_zoho_expenses_bank_txn ON zoho_expenses(bank_transaction_id);
CREATE INDEX idx_zoho_expenses_date ON zoho_expenses(expense_date);

-- RLS
ALTER TABLE zoho_expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated read" ON zoho_expenses
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Service role full access" ON zoho_expenses
    FOR ALL USING (auth.role() = 'service_role');
```

**Verification:**
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'zoho_expenses';
```

### 1.3 Create Queue Controller Function

**Location:** Supabase SQL Editor

```sql
CREATE OR REPLACE FUNCTION process_expense_queue()
RETURNS TRIGGER AS $$
DECLARE
    processing_count INT;
    next_expense RECORD;
    slots_available INT;
    max_concurrent CONSTANT INT := 5;
BEGIN
    -- Only act on relevant events
    IF TG_OP = 'UPDATE' THEN
        IF NEW.status NOT IN ('posted', 'error', 'flagged') THEN
            RETURN NEW;
        END IF;
    END IF;

    -- Count currently processing
    SELECT COUNT(*) INTO processing_count
    FROM zoho_expenses
    WHERE status = 'processing';

    slots_available := max_concurrent - processing_count;

    WHILE slots_available > 0 LOOP
        UPDATE zoho_expenses
        SET
            status = 'processing',
            processing_started_at = NOW(),
            processing_attempts = processing_attempts + 1
        WHERE id = (
            SELECT id FROM zoho_expenses
            WHERE status = 'pending'
            ORDER BY created_at ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
        )
        RETURNING * INTO next_expense;

        IF next_expense IS NULL THEN
            EXIT;
        END IF;

        -- Call n8n webhook
        PERFORM net.http_post(
            url := 'https://n8n.as3drivertraining.com/webhook/process-expense',
            body := jsonb_build_object('expense_id', next_expense.id)::text,
            headers := jsonb_build_object('Content-Type', 'application/json')
        );

        slots_available := slots_available - 1;
    END LOOP;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

### 1.4 Create Triggers

**Location:** Supabase SQL Editor

```sql
-- Trigger on INSERT (new expense arrives)
CREATE TRIGGER trigger_queue_on_insert
    AFTER INSERT ON zoho_expenses
    FOR EACH ROW
    EXECUTE FUNCTION process_expense_queue();

-- Trigger on UPDATE (expense finishes)
CREATE TRIGGER trigger_queue_on_completion
    AFTER UPDATE OF status ON zoho_expenses
    FOR EACH ROW
    WHEN (NEW.status IN ('posted', 'error', 'flagged'))
    EXECUTE FUNCTION process_expense_queue();
```

**Verification:**
```sql
SELECT trigger_name, event_manipulation, action_statement
FROM information_schema.triggers
WHERE event_object_table = 'zoho_expenses';
```

### 1.5 Create Supabase Storage Bucket

**Location:** Supabase Dashboard → Storage

1. Create bucket: `expense-receipts`
2. Public: No (private bucket)
3. File size limit: 10MB
4. Allowed MIME types: `image/jpeg, image/png, application/pdf`

**Verification (via API or Dashboard):**
```sql
-- Check bucket exists via storage.buckets table
SELECT * FROM storage.buckets WHERE name = 'expense-receipts';
```

---

## Phase 2: Edge Function (Day 2)

### 2.1 Create Edge Function

**Location:** `supabase/functions/receive-zoho-webhook/index.ts`

```typescript
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const payload = await req.json()
    console.log('Received Zoho webhook:', JSON.stringify(payload).substring(0, 500))

    const report = payload.expense_report
    if (!report || !report.expenses) {
      return new Response(
        JSON.stringify({ error: 'Invalid payload: missing expense_report or expenses' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const expenses = report.expenses
    let insertedCount = 0
    let skippedCount = 0

    for (const expense of expenses) {
      // Extract state tag from line items
      const stateTag = expense.line_items?.[0]?.tags
        ?.find((t: any) => t.tag_name === 'Course Location')
        ?.tag_option_name || null

      // Download and store receipt if available
      let receiptPath: string | null = null
      let receiptContentType: string | null = null

      if (expense.documents?.[0]?.download_url) {
        try {
          const receiptResponse = await fetch(expense.documents[0].download_url)
          if (receiptResponse.ok) {
            const receiptBlob = await receiptResponse.blob()
            receiptContentType = receiptResponse.headers.get('content-type') || 'image/jpeg'

            const extension = receiptContentType.split('/')[1] || 'jpg'
            const filename = `${expense.expense_id}.${extension}`
            receiptPath = `${report.report_id}/${filename}`

            const { error: uploadError } = await supabase.storage
              .from('expense-receipts')
              .upload(receiptPath, receiptBlob, {
                contentType: receiptContentType,
                upsert: true
              })

            if (uploadError) {
              console.error('Receipt upload error:', uploadError)
              receiptPath = null
            }
          }
        } catch (receiptError) {
          console.error('Receipt download error:', receiptError)
        }
      }

      // Insert expense (upsert with ON CONFLICT)
      const { error: insertError } = await supabase
        .from('zoho_expenses')
        .upsert({
          zoho_expense_id: expense.expense_id,
          zoho_report_id: report.report_id,
          zoho_report_name: report.report_name,
          raw_payload: expense,
          expense_date: expense.date,
          amount: expense.total,
          merchant_name: expense.merchant_name,
          category_name: expense.category_name,
          state_tag: stateTag,
          paid_through: expense.paid_through_account_name,
          receipt_storage_path: receiptPath,
          receipt_content_type: receiptContentType,
          status: 'pending'
        }, {
          onConflict: 'zoho_expense_id',
          ignoreDuplicates: true  // Don't update if exists
        })

      if (insertError) {
        console.error('Insert error:', insertError)
        skippedCount++
      } else {
        insertedCount++
      }
    }

    console.log(`Processed ${expenses.length} expenses: ${insertedCount} inserted, ${skippedCount} skipped`)

    return new Response(
      JSON.stringify({
        success: true,
        report_id: report.report_id,
        total: expenses.length,
        inserted: insertedCount,
        skipped: skippedCount
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Edge Function error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
```

### 2.2 Deploy Edge Function

**Location:** Terminal (requires Supabase CLI)

```bash
# Navigate to project root
cd supabase

# Login to Supabase
supabase login

# Link to project (if not already linked)
supabase link --project-ref YOUR_PROJECT_REF

# Deploy the function
supabase functions deploy receive-zoho-webhook --no-verify-jwt
```

### 2.3 Test Edge Function

```bash
# Test with curl
curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/receive-zoho-webhook \
  -H "Content-Type: application/json" \
  -d '{
    "expense_report": {
      "report_id": "TEST-001",
      "report_name": "Test Report",
      "expenses": [{
        "expense_id": "EXP-TEST-001",
        "date": "2025-12-11",
        "total": 123.45,
        "merchant_name": "Test Merchant",
        "category_name": "Travel - Courses COS",
        "paid_through_account_name": "AMEX Business 61002",
        "line_items": [{
          "tags": [{"tag_name": "Course Location", "tag_option_name": "CA"}]
        }]
      }]
    }
  }'
```

### 2.4 Update Zoho Webhook URL

**Location:** Zoho Expense → Settings → Workflow Rules

1. Find existing webhook rule for approved expense reports
2. Update webhook URL from:
   - `https://n8n.as3drivertraining.com/webhook/zoho-expense-approved`
3. To:
   - `https://YOUR_PROJECT.supabase.co/functions/v1/receive-zoho-webhook`

---

## Phase 3: n8n Workflow Rebuild (Day 3-4)

### 3.1 Create New Webhook Trigger

**Node Type:** Webhook
**Path:** `/process-expense`
**Method:** POST
**Response Mode:** Last Node

### 3.2 Add Fetch Expense Node

**Node Type:** Supabase → Get Row
**Table:** `zoho_expenses`
**Filter:** `id = {{ $json.expense_id }}`

### 3.3 Add Status Check Node

**Node Type:** IF
**Condition:** `{{ $json.status }} = 'processing'`
- If true: Continue
- If false: Exit (already processed)

### 3.4 Add Fetch Receipt Node

**Node Type:** HTTP Request
**Method:** GET
**URL:** `{{ $env.SUPABASE_URL }}/storage/v1/object/expense-receipts/{{ $json.receipt_storage_path }}`
**Authentication:** Header → `Authorization: Bearer {{ $env.SUPABASE_SERVICE_KEY }}`
**Response:** Binary (store as file)

### 3.5 Add Parallel Reference Fetch

Execute in parallel:
1. **Fetch bank_transactions** (unmatched, ±3 days of expense_date)
2. **Fetch qbo_accounts** (all active)
3. **Fetch qbo_classes** (all)

### 3.6 Add AI Agent Node

**Model:** Claude 3.5 Haiku (or preferred model)
**System Prompt:** See `n8n-workflow-spec.md` for full prompt
**Tools:** None (all data pre-fetched)
**Output:** JSON with match result

### 3.7 Add QBO Integration Nodes

1. **Lookup/Create Vendor**
2. **Create Purchase**
3. **Upload Receipt** (Attachable API)

### 3.8 Add Final Update Nodes

**Success Path:**
```sql
UPDATE zoho_expenses
SET status = 'posted',
    bank_transaction_id = '{{ matched_id }}',
    qbo_purchase_id = '{{ purchase_id }}',
    qbo_posted_at = NOW(),
    processed_at = NOW()
WHERE id = '{{ expense_id }}'
```

**Error Path:**
```sql
UPDATE zoho_expenses
SET status = 'error',
    last_error = '{{ error_message }}',
    processed_at = NOW()
WHERE id = '{{ expense_id }}'
```

### 3.9 Add Error Handler

**Node Type:** Error Trigger
**Actions:**
1. Update expense status to 'error'
2. Send Teams notification

---

## Phase 4: Integration Testing (Day 5)

### 4.1 Test Queue Controller

```sql
-- Insert test expense (triggers queue)
INSERT INTO zoho_expenses (
    zoho_expense_id, zoho_report_id, raw_payload,
    expense_date, amount, merchant_name,
    category_name, state_tag, paid_through
) VALUES (
    'TEST-001', 'REPORT-TEST', '{}',
    '2025-12-11', 50.00, 'Test Merchant',
    'Fuel - COS', 'CA', 'AMEX Business 61002'
);

-- Verify it was claimed
SELECT id, status, processing_started_at
FROM zoho_expenses
WHERE zoho_expense_id = 'TEST-001';
```

### 4.2 Test Concurrent Limit

```sql
-- Insert 10 expenses rapidly
INSERT INTO zoho_expenses (zoho_expense_id, zoho_report_id, raw_payload, expense_date, amount, merchant_name, category_name, state_tag, paid_through)
SELECT
    'BATCH-' || generate_series,
    'REPORT-BATCH',
    '{}',
    '2025-12-11',
    50.00,
    'Batch Merchant',
    'Fuel - COS',
    'CA',
    'AMEX Business 61002'
FROM generate_series(1, 10);

-- Check: should see max 5 in 'processing'
SELECT status, COUNT(*)
FROM zoho_expenses
WHERE zoho_expense_id LIKE 'BATCH-%'
GROUP BY status;
```

### 4.3 Test Error Recovery

```sql
-- Simulate stuck expense
UPDATE zoho_expenses
SET status = 'processing',
    processing_started_at = NOW() - INTERVAL '20 minutes'
WHERE zoho_expense_id = 'BATCH-1';

-- Run recovery
UPDATE zoho_expenses
SET status = 'pending', last_error = 'Reset: stuck'
WHERE status = 'processing'
  AND processing_started_at < NOW() - INTERVAL '15 minutes';

-- Verify queue picks it up
SELECT id, status, processing_attempts
FROM zoho_expenses
WHERE zoho_expense_id = 'BATCH-1';
```

### 4.4 End-to-End Test with Real Zoho Report

1. Submit a real expense report in Zoho (1-2 expenses)
2. Approve the report
3. Monitor:
   - Edge Function logs (Supabase Dashboard)
   - zoho_expenses table (check status progression)
   - n8n executions (should see single-expense runs)
   - QBO (verify Purchase was created)

---

## Phase 5: Production Cutover (Day 6)

### 5.1 Disable Old n8n Webhook

1. In n8n, deactivate the "Zoho Expense Approved" workflow
2. Keep it saved for rollback if needed

### 5.2 Update Zoho Webhook

1. Change Zoho webhook URL to Edge Function
2. Test with small expense report

### 5.3 Monitor First Production Run

Watch for:
- Edge Function errors in Supabase logs
- Queue controller behavior (check `processing` counts)
- n8n memory usage (should stay low)
- QBO postings (verify success)

### 5.4 Document Any Issues

Create tickets for:
- Edge cases discovered
- Performance optimizations needed
- UI improvements for queue monitoring

---

## Phase 6: Hardening (Day 7+)

### 6.1 Add Queue Monitoring Dashboard

Web app enhancement:
- Show pending/processing/posted/error counts
- List recent expenses with status
- Allow manual retry for errors
- Show processing duration metrics

### 6.2 Create Scheduled Cleanup Job

```sql
-- Reset stuck expenses (run every 15 minutes via pg_cron or n8n)
UPDATE zoho_expenses
SET status = 'pending',
    last_error = 'Auto-reset: stuck in processing'
WHERE status = 'processing'
  AND processing_started_at < NOW() - INTERVAL '15 minutes'
  AND processing_attempts < 3;

-- Flag expenses that failed 3+ times
UPDATE zoho_expenses
SET status = 'flagged',
    last_error = 'Max retries exceeded'
WHERE status = 'processing'
  AND processing_started_at < NOW() - INTERVAL '15 minutes'
  AND processing_attempts >= 3;
```

### 6.3 Add Alerting

Teams notification when:
- 5+ expenses stuck in 'error' status
- 10+ expenses in 'pending' for >1 hour
- Any expense with 3+ processing attempts

---

## Rollback Plan

If critical issues arise:

### Immediate Rollback (< 5 minutes)

1. **Change Zoho webhook back to n8n:**
   - URL: `https://n8n.as3drivertraining.com/webhook/zoho-expense-approved`

2. **Reactivate old n8n workflow**

3. **Document what went wrong**

### Partial Rollback (Queue works, n8n fails)

1. Keep Edge Function active (stores expenses safely)
2. Fix n8n workflow issues
3. Reset stuck expenses to 'pending' when ready

### Data Recovery

All expenses are stored in `zoho_expenses` table with `raw_payload` JSONB.
Re-process any failed expenses by resetting status to 'pending'.

---

## Success Metrics

### Week 1 Targets
- [ ] Process 23+ expense report without memory error
- [ ] All expenses processed within 5 minutes of webhook
- [ ] Zero duplicate QBO postings
- [ ] Queue self-heals after n8n errors

### Week 2 Targets
- [ ] Queue monitoring dashboard operational
- [ ] Automated stuck-expense recovery running
- [ ] Documentation complete and accurate
- [ ] Team trained on new architecture

---

## Dependencies

### External Services
- Supabase project (already exists)
- n8n Cloud instance (already exists)
- Zoho Expense (webhook configuration access)
- QuickBooks Online (existing integration)

### Required Permissions
- Supabase: Service role key for Edge Function
- n8n: Webhook creation, Supabase integration
- Zoho: Admin access to modify webhook URL

### Technical Prerequisites
- pg_net extension enabled
- Supabase Storage bucket created
- n8n webhook URL configured

---

## Owner Assignment

| Task | Owner | Deadline |
|------|-------|----------|
| Phase 1: Database Infrastructure | Claude + Pablo | Day 1 |
| Phase 2: Edge Function | Claude + Pablo | Day 2 |
| Phase 3: n8n Workflow | Pablo (with Claude guidance) | Day 3-4 |
| Phase 4: Integration Testing | Pablo | Day 5 |
| Phase 5: Production Cutover | Pablo | Day 6 |
| Phase 6: Hardening | Claude + Pablo | Day 7+ |

---

*End of Implementation Action Plan*
