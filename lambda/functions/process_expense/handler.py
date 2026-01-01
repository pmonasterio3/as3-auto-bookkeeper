"""
Process Expense Lambda Handler
==============================

Main Lambda entry point for processing newly approved Zoho expenses.
Triggered by API Gateway from Supabase pg_net webhook.
"""

import json
import hashlib
import os
from datetime import datetime
from typing import Any

import boto3
from aws_lambda_powertools import Logger, Metrics, Tracer
from aws_lambda_powertools.metrics import MetricUnit
from aws_lambda_powertools.utilities.typing import LambdaContext

from utils.supabase_client import SupabaseClient
from models import Expense, ProcessingResult, ProcessingDecision

from agent import run_expense_agent

# Initialize AWS Lambda Powertools
logger = Logger()
metrics = Metrics()
tracer = Tracer()

# DynamoDB for idempotency
dynamodb = boto3.resource("dynamodb")
idempotency_table = dynamodb.Table(os.environ.get("IDEMPOTENCY_TABLE", "as3-idempotency-prod"))


@logger.inject_lambda_context
@metrics.log_metrics
@tracer.capture_lambda_handler
def lambda_handler(event: dict, context: LambdaContext) -> dict:
    """
    Main Lambda handler for processing expenses.

    Expected payload (from Supabase pg_net):
    {
        "expense_id": "uuid",
        "zoho_expense_id": "string",
        "retry_count": 0
    }
    """
    logger.info("Received expense processing request", extra={"event": event})

    try:
        # Parse request body
        body = _parse_request_body(event)
        expense_id = body.get("expense_id")
        retry_count = body.get("retry_count", 0)

        if not expense_id:
            return _error_response(400, "Missing expense_id in request body")

        # Idempotency check
        idempotency_key = _generate_idempotency_key(expense_id, retry_count)
        if _is_duplicate_request(idempotency_key):
            logger.info(f"Duplicate request detected for {expense_id}")
            return _success_response({"message": "Already processed", "expense_id": expense_id})

        # Process the expense
        result = process_expense(expense_id, retry_count)

        # Record idempotency
        _record_idempotency(idempotency_key, result)

        # Record metrics
        _record_metrics(result)

        return _success_response({
            "expense_id": expense_id,
            "success": result.success,
            "decision": result.decision.value,
            "confidence": result.confidence,
            "qbo_purchase_id": result.qbo_purchase_id,
            "message": result.to_summary()
        })

    except Exception as e:
        logger.exception(f"Unhandled error processing expense: {e}")
        metrics.add_metric(name="ProcessingErrors", unit=MetricUnit.Count, value=1)
        return _error_response(500, str(e))


@tracer.capture_method
def process_expense(expense_id: str, retry_count: int = 0) -> ProcessingResult:
    """
    Process a single expense through the AI agent.

    Steps:
    1. Fetch expense from Supabase
    2. Update status to 'processing'
    3. Run AI agent for processing
    4. Update expense with results
    5. Return processing result
    """
    result = ProcessingResult(expense_id=expense_id)
    result.started_at = datetime.utcnow()

    supabase = SupabaseClient()

    try:
        # Step 1: Fetch expense
        logger.info(f"Fetching expense {expense_id}")
        expense_data = supabase.get_expense(expense_id)

        if not expense_data:
            result.success = False
            result.decision = ProcessingDecision.FLAGGED
            result.error_message = f"Expense {expense_id} not found"
            result.flag_reason = "expense_not_found"
            return result

        expense = Expense.from_dict(expense_data)
        result.zoho_expense_id = expense.zoho_expense_id

        logger.info(f"Processing expense: {expense.vendor_name} ${expense.amount}")

        # GUARDRAIL: Receipt MUST exist - Zoho expenses are created FROM receipts
        # If receipt_storage_path is null, the system failed to fetch it from Zoho API
        if not expense.receipt_storage_path:
            error_msg = "SYSTEM FAILURE: Receipt not fetched from Zoho API. The edge function stored the expense but did not fetch the receipt document."
            logger.error(f"Expense {expense_id}: {error_msg}")

            result.success = False
            result.decision = ProcessingDecision.FLAGGED
            result.error_message = error_msg
            result.flag_reason = "receipt_not_fetched"
            result.confidence = 0

            supabase.update_expense(expense_id, {
                "status": "error",
                "flag_reason": "Receipt not fetched from Zoho API during intake. Check edge function logs.",
                "last_error": error_msg
            })

            # This is a hard failure - do not process
            raise ValueError(error_msg)

        # Step 2: Update status to processing
        supabase.update_expense_status(expense_id, "processing")
        expense.processing_attempts += 1

        # Step 3: Run AI agent
        logger.info("Starting AI agent processing")
        result = run_expense_agent(expense, supabase, retry_count)
        result.expense_id = expense_id
        result.zoho_expense_id = expense.zoho_expense_id

        # Step 4: Update expense with results
        if result.success:
            _update_expense_success(supabase, expense_id, result)
        else:
            _update_expense_failure(supabase, expense_id, result)

        # Step 5: Record learning data if corrections were made
        if result.was_corrected:
            _record_corrections(supabase, expense_id, result)

    except Exception as e:
        logger.exception(f"Error processing expense {expense_id}: {e}")
        result.success = False
        result.decision = ProcessingDecision.FLAGGED
        result.error_message = str(e)
        result.flag_reason = "processing_error"

        # Update expense to flagged state
        try:
            supabase.update_expense(expense_id, {
                "status": "flagged",
                "flag_reason": f"Processing error: {str(e)[:200]}",
                "last_error": str(e)[:500]
            })
        except Exception as update_error:
            logger.error(f"Failed to update expense status: {update_error}")

    finally:
        result.completed_at = datetime.utcnow()
        if result.started_at:
            delta = result.completed_at - result.started_at
            result.duration_ms = int(delta.total_seconds() * 1000)

    return result


def _update_expense_success(supabase: SupabaseClient, expense_id: str, result: ProcessingResult) -> None:
    """Update expense after successful processing."""
    update_data = {
        "status": "posted",
        "bank_transaction_id": result.bank_transaction_id,
        "match_confidence": result.match_confidence,
        "qbo_purchase_id": result.qbo_purchase_id,
        "monday_event_id": result.monday_event_id,
        "monday_subitem_id": result.monday_subitem_id,
        "processed_at": datetime.utcnow().isoformat(),
        "flag_reason": None,
        "last_error": None
    }

    # Add correction data if any
    if result.corrections:
        # Store original values and apply corrections
        for correction in result.corrections:
            if correction.field_name == "amount":
                update_data["original_amount"] = correction.original_value
            elif correction.field_name == "expense_date":
                update_data["original_expense_date"] = correction.original_value
                # Also update the expense_date to the corrected value
                update_data["expense_date"] = correction.corrected_value
                logger.info(f"Date auto-corrected: {correction.original_value} -> {correction.corrected_value}")

    supabase.update_expense(expense_id, update_data)

    # Update bank transaction as matched
    if result.bank_transaction_id:
        supabase.update_bank_transaction(result.bank_transaction_id, {
            "status": "matched",
            "matched_expense_id": expense_id,
            "matched_by": "agent",
            "matched_at": datetime.utcnow().isoformat(),
            "match_confidence": result.match_confidence,
            "qbo_purchase_id": result.qbo_purchase_id
        })

    logger.info(f"Expense {expense_id} posted successfully")


def _update_expense_failure(supabase: SupabaseClient, expense_id: str, result: ProcessingResult) -> None:
    """Update expense after failed processing."""
    if result.decision == ProcessingDecision.NEEDS_REVIEW:
        status = "flagged"  # Shows in review queue (zoho_expenses with status='flagged')
    elif result.decision == ProcessingDecision.DUPLICATE:
        status = "duplicate"
    else:
        status = "flagged"

    update_data = {
        "status": status,
        "flag_reason": result.flag_reason or result.error_message,
        "last_error": result.error_message
    }

    supabase.update_expense(expense_id, update_data)
    logger.info(f"Expense {expense_id} marked as {status}: {result.flag_reason}")


def _record_corrections(supabase: SupabaseClient, expense_id: str, result: ProcessingResult) -> None:
    """Record corrections for AI learning."""
    corrections_data = []
    for correction in result.corrections:
        corrections_data.append({
            "field": correction.field_name,
            "original": correction.original_value,
            "corrected": correction.corrected_value,
            "reason": correction.reason,
            "source": correction.source,
            "confidence": correction.confidence
        })

    supabase.update_expense(expense_id, {
        "corrections": json.dumps(corrections_data)
    })

    logger.info(f"Recorded {len(corrections_data)} corrections for learning")


def _generate_idempotency_key(expense_id: str, retry_count: int) -> str:
    """Generate idempotency key for deduplication."""
    key_data = f"{expense_id}:{retry_count}"
    return hashlib.sha256(key_data.encode()).hexdigest()[:32]


def _is_duplicate_request(idempotency_key: str) -> bool:
    """Check if this request was already processed."""
    try:
        response = idempotency_table.get_item(Key={"id": idempotency_key})
        return "Item" in response
    except Exception as e:
        logger.warning(f"Idempotency check failed: {e}")
        return False


def _record_idempotency(idempotency_key: str, result: ProcessingResult) -> None:
    """Record request for idempotency."""
    try:
        idempotency_table.put_item(Item={
            "id": idempotency_key,
            "success": result.success,
            "decision": result.decision.value,
            "processed_at": datetime.utcnow().isoformat(),
            "expiration": int(datetime.utcnow().timestamp()) + 86400  # 24 hour TTL
        })
    except Exception as e:
        logger.warning(f"Failed to record idempotency: {e}")


def _record_metrics(result: ProcessingResult) -> None:
    """Record CloudWatch metrics."""
    metrics.add_metric(name="ExpensesProcessed", unit=MetricUnit.Count, value=1)

    if result.success:
        metrics.add_metric(name="ExpensesPosted", unit=MetricUnit.Count, value=1)
    else:
        metrics.add_metric(name="ExpensesFailed", unit=MetricUnit.Count, value=1)

    if result.decision == ProcessingDecision.NEEDS_REVIEW:
        metrics.add_metric(name="ExpensesNeedingReview", unit=MetricUnit.Count, value=1)

    if result.was_corrected:
        metrics.add_metric(name="SelfCorrections", unit=MetricUnit.Count, value=1)

    metrics.add_metric(name="Confidence", unit=MetricUnit.Count, value=result.confidence)
    metrics.add_metric(name="ToolCalls", unit=MetricUnit.Count, value=result.tool_call_count)

    if result.duration_ms:
        metrics.add_metric(name="ProcessingDuration", unit=MetricUnit.Milliseconds, value=result.duration_ms)


def _parse_request_body(event: dict) -> dict:
    """Parse request body from API Gateway event."""
    body = event.get("body", "{}")
    if isinstance(body, str):
        return json.loads(body)
    return body


def _success_response(data: dict) -> dict:
    """Create success API Gateway response."""
    return {
        "statusCode": 200,
        "headers": {
            "Content-Type": "application/json"
        },
        "body": json.dumps(data)
    }


def _error_response(status_code: int, message: str) -> dict:
    """Create error API Gateway response."""
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json"
        },
        "body": json.dumps({"error": message})
    }
