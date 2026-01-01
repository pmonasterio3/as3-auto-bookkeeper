-- AS3 Auto Bookkeeper - Diagnostic Queries
-- ==========================================
-- Run these queries to identify system health and failure points.
-- Date: December 31, 2025

-- ============================================================
-- SECTION 1: EXPENSE STATUS OVERVIEW
-- ============================================================

-- 1.1 Overall expense status distribution
SELECT
    status,
    COUNT(*) as count,
    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 2) as percentage,
    MAX(created_at) as latest_record
FROM zoho_expenses
GROUP BY status
ORDER BY count DESC;

-- 1.2 Expenses missing receipts (CRITICAL - should be 0)
SELECT
    COUNT(*) as missing_receipts,
    STRING_AGG(vendor_name, ', ' ORDER BY created_at DESC) as vendors
FROM zoho_expenses
WHERE receipt_storage_path IS NULL;

-- 1.3 Detailed view of expenses missing receipts
SELECT
    id,
    zoho_expense_id,
    vendor_name,
    amount,
    status,
    flag_reason,
    created_at
FROM zoho_expenses
WHERE receipt_storage_path IS NULL
ORDER BY created_at DESC
LIMIT 20;

-- ============================================================
-- SECTION 2: ERROR ANALYSIS
-- ============================================================

-- 2.1 Processing errors by type
SELECT
    CASE
        WHEN error_message LIKE '%parsing query%' THEN 'QBO SQL Parse Error'
        WHEN error_message LIKE '%AccountRef%' THEN 'Missing QBO Account'
        WHEN error_message LIKE '%DisplayName%' THEN 'Vendor Name Error'
        WHEN error_message LIKE '%invalid_grant%' THEN 'OAuth Token Expired'
        ELSE 'Other'
    END as error_type,
    COUNT(*) as count
FROM processing_errors
GROUP BY 1
ORDER BY count DESC;

-- 2.2 Recent processing errors
SELECT
    id,
    expense_id,
    error_node,
    LEFT(error_message, 200) as error_preview,
    status,
    created_at
FROM processing_errors
ORDER BY created_at DESC
LIMIT 15;

-- 2.3 Unresolved errors
SELECT
    expense_id,
    error_node,
    LEFT(error_message, 200) as error_preview,
    retry_count,
    created_at
FROM processing_errors
WHERE status NOT IN ('resolved', 'ignored')
ORDER BY created_at DESC;

-- ============================================================
-- SECTION 3: QBO ACCOUNT MAPPING GAPS
-- ============================================================

-- 3.1 Categories used in expenses that have no QBO mapping
SELECT DISTINCT
    ze.category_name,
    COUNT(*) as expense_count,
    SUM(ze.amount) as total_amount
FROM zoho_expenses ze
WHERE NOT EXISTS (
    SELECT 1 FROM qbo_accounts qa
    WHERE qa.zoho_category_match = ze.category_name
)
AND ze.category_name IS NOT NULL
GROUP BY ze.category_name
ORDER BY expense_count DESC;

-- 3.2 QBO accounts with their mapped categories
SELECT
    name as qbo_account_name,
    qbo_id,
    zoho_category_match,
    is_cogs,
    times_used
FROM qbo_accounts
WHERE zoho_category_match IS NOT NULL
ORDER BY times_used DESC;

-- ============================================================
-- SECTION 4: BANK TRANSACTION MATCHING
-- ============================================================

-- 4.1 Bank transaction status overview
SELECT
    status,
    source,
    COUNT(*) as count
FROM bank_transactions
GROUP BY status, source
ORDER BY source, status;

-- 4.2 Unmatched bank transactions by age
SELECT
    CASE
        WHEN transaction_date >= CURRENT_DATE - INTERVAL '7 days' THEN 'Last 7 days'
        WHEN transaction_date >= CURRENT_DATE - INTERVAL '30 days' THEN 'Last 30 days'
        WHEN transaction_date >= CURRENT_DATE - INTERVAL '90 days' THEN 'Last 90 days'
        ELSE 'Older than 90 days'
    END as age_bucket,
    COUNT(*) as unmatched_count,
    SUM(amount) as total_amount
FROM bank_transactions
WHERE status = 'unmatched'
GROUP BY 1
ORDER BY 1;

-- 4.3 Expenses flagged for "no_bank_match"
SELECT
    id,
    zoho_expense_id,
    vendor_name,
    amount,
    expense_date,
    flag_reason
FROM zoho_expenses
WHERE flag_reason LIKE '%bank%' OR flag_reason LIKE '%match%'
ORDER BY created_at DESC
LIMIT 20;

-- ============================================================
-- SECTION 5: RECEIPT VALIDATION STATUS
-- ============================================================

-- 5.1 Receipt validation success rate
SELECT
    CASE
        WHEN amounts_match = true AND merchant_match = true THEN 'Full Match'
        WHEN amounts_match = true THEN 'Amount Only'
        WHEN merchant_match = true THEN 'Merchant Only'
        ELSE 'No Match'
    END as match_type,
    COUNT(*) as count,
    AVG(confidence) as avg_confidence
FROM receipt_validations
GROUP BY 1
ORDER BY count DESC;

-- 5.2 Receipt validations with issues
SELECT
    rv.id,
    rv.expense_id,
    rv.merchant_extracted,
    rv.amount_extracted,
    rv.confidence,
    rv.issues,
    ze.vendor_name as original_vendor,
    ze.amount as original_amount
FROM receipt_validations rv
JOIN zoho_expenses ze ON rv.expense_id = ze.id
WHERE rv.amounts_match = false OR rv.merchant_match = false
ORDER BY rv.created_at DESC
LIMIT 20;

-- ============================================================
-- SECTION 6: VENDOR RULES EFFECTIVENESS
-- ============================================================

-- 6.1 Most used vendor rules
SELECT
    vendor_pattern,
    vendor_name_clean,
    default_state,
    match_count,
    last_matched_at
FROM vendor_rules
WHERE is_active = true
ORDER BY match_count DESC
LIMIT 20;

-- 6.2 Vendor names that might need escaping (contain apostrophes)
SELECT DISTINCT vendor_name
FROM zoho_expenses
WHERE vendor_name LIKE '%''%'
   OR vendor_name LIKE '%'%'  -- Unicode right single quote
   OR vendor_name LIKE '%'%'  -- Unicode left single quote
ORDER BY vendor_name;

-- ============================================================
-- SECTION 7: MONDAY.COM INTEGRATION
-- ============================================================

-- 7.1 COS expenses with Monday.com subitems
SELECT
    COUNT(*) as total_cos_expenses,
    COUNT(monday_subitem_id) as with_subitem,
    COUNT(*) - COUNT(monday_subitem_id) as missing_subitem
FROM zoho_expenses
WHERE category_name LIKE '%COS%';

-- 7.2 COS expenses missing Monday subitems
SELECT
    id,
    zoho_expense_id,
    vendor_name,
    amount,
    status,
    monday_event_id,
    monday_subitem_id
FROM zoho_expenses
WHERE category_name LIKE '%COS%'
AND monday_subitem_id IS NULL
AND status = 'posted'
ORDER BY created_at DESC
LIMIT 20;

-- ============================================================
-- SECTION 8: SYSTEM HEALTH METRICS
-- ============================================================

-- 8.1 Processing success rate by day
SELECT
    DATE_TRUNC('day', created_at)::date as day,
    COUNT(*) as total,
    COUNT(*) FILTER (WHERE status = 'posted') as posted,
    COUNT(*) FILTER (WHERE status IN ('error', 'flagged')) as failed,
    ROUND(
        COUNT(*) FILTER (WHERE status = 'posted') * 100.0 / NULLIF(COUNT(*), 0),
        1
    ) as success_rate_pct
FROM zoho_expenses
WHERE created_at >= CURRENT_DATE - INTERVAL '14 days'
GROUP BY 1
ORDER BY 1 DESC;

-- 8.2 Average processing time (from pending to posted)
SELECT
    AVG(EXTRACT(EPOCH FROM (processed_at - created_at))/60) as avg_minutes,
    MIN(EXTRACT(EPOCH FROM (processed_at - created_at))/60) as min_minutes,
    MAX(EXTRACT(EPOCH FROM (processed_at - created_at))/60) as max_minutes
FROM zoho_expenses
WHERE status = 'posted' AND processed_at IS NOT NULL;

-- ============================================================
-- SECTION 9: DATA INTEGRITY CHECKS
-- ============================================================

-- 9.1 Orphaned records in categorization_history
SELECT COUNT(*) as orphaned_history_records
FROM categorization_history ch
WHERE NOT EXISTS (
    SELECT 1 FROM zoho_expenses ze
    WHERE ze.zoho_expense_id = ch.zoho_expense_id
);

-- 9.2 Expenses with bank_transaction_id but bank transaction not matched
SELECT
    ze.id,
    ze.vendor_name,
    ze.bank_transaction_id,
    bt.status as bank_txn_status
FROM zoho_expenses ze
JOIN bank_transactions bt ON ze.bank_transaction_id = bt.id
WHERE ze.status = 'posted' AND bt.status != 'matched';

-- 9.3 Receipt validations count vs expenses count
SELECT
    (SELECT COUNT(*) FROM zoho_expenses WHERE receipt_storage_path IS NOT NULL) as expenses_with_receipts,
    (SELECT COUNT(*) FROM receipt_validations) as validations,
    (SELECT COUNT(*) FROM zoho_expenses WHERE receipt_storage_path IS NOT NULL)
        - (SELECT COUNT(*) FROM receipt_validations) as missing_validations;
