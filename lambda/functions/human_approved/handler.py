"""
Human Approved Processor Lambda Handler
=======================================

Processes expenses after human review and approval.
Uses the same AI agent but with human-provided context.
"""

import json
from datetime import datetime
from typing import Any

import boto3
from aws_lambda_powertools import Logger, Metrics, Tracer
from aws_lambda_powertools.metrics import MetricUnit
from aws_lambda_powertools.utilities.typing import LambdaContext

from utils.supabase_client import SupabaseClient
from utils.qbo_client import QBOClient
from utils.monday_client import MondayClient
from models import Expense, ProcessingResult, ProcessingDecision

logger = Logger()
metrics = Metrics()
tracer = Tracer()

# State name to code mapping
STATE_NAME_TO_CODE = {
    "california": "CA",
    "texas": "TX",
    "colorado": "CO",
    "washington": "WA",
    "new jersey": "NJ",
    "florida": "FL",
    "montana": "MT",
    "north carolina": "NC",
    "other": "NC",  # Default for "Other" tag
}


def _normalize_state(state: str | None) -> str | None:
    """Normalize state name to 2-letter code."""
    if not state:
        return None

    # Already a 2-letter code
    if len(state) == 2:
        return state.upper()

    # Look up full name
    state_lower = state.lower().strip()
    return STATE_NAME_TO_CODE.get(state_lower)


@logger.inject_lambda_context
@metrics.log_metrics
@tracer.capture_lambda_handler
def lambda_handler(event: dict, context: LambdaContext) -> dict:
    """
    Process a human-approved expense.

    Expected payload from web app:
    {
        "expense_id": "uuid",
        "bank_transaction_id": "uuid",  # Human-selected match
        "state": "CA",  # Human-confirmed state
        "corrections": {
            "amount": 45.67,  # Optional corrected amount
            "expense_date": "2025-12-15"  # Optional corrected date
        }
    }
    """
    # Handle CORS preflight
    http_method = event.get("httpMethod") or event.get("requestContext", {}).get("http", {}).get("method", "")
    if http_method == "OPTIONS":
        return _cors_preflight_response()

    logger.info("Received human-approved expense", extra={"event": event})

    try:
        body = _parse_request_body(event)

        expense_id = body.get("expense_id")
        bank_transaction_id = body.get("bank_transaction_id")
        state = body.get("state")
        corrections = body.get("corrections", {})

        if not expense_id:
            return _error_response(400, "Missing expense_id")

        if not bank_transaction_id:
            return _error_response(400, "Missing bank_transaction_id")

        result = process_human_approved(
            expense_id=expense_id,
            bank_transaction_id=bank_transaction_id,
            state=state,
            corrections=corrections
        )

        metrics.add_metric(name="HumanApprovedProcessed", unit=MetricUnit.Count, value=1)

        if result.success:
            return _success_response({
                "success": True,
                "expense_id": expense_id,
                "qbo_purchase_id": result.qbo_purchase_id,
                "message": "Expense posted to QBO successfully"
            })
        else:
            return _error_response(500, result.error_message or "Processing failed")

    except Exception as e:
        logger.exception(f"Error processing human-approved expense: {e}")
        return _error_response(500, str(e))


@tracer.capture_method
def process_human_approved(
    expense_id: str,
    bank_transaction_id: str,
    state: str | None,
    corrections: dict
) -> ProcessingResult:
    """
    Process a human-approved expense with pre-selected bank transaction.

    Since human has already reviewed:
    - Skip bank matching (use provided transaction)
    - Skip state determination (use provided state)
    - Apply any corrections
    - Create QBO Purchase directly
    """
    result = ProcessingResult(expense_id=expense_id)
    result.started_at = datetime.utcnow()

    supabase = SupabaseClient()
    qbo = QBOClient()
    monday = MondayClient()

    try:
        # Fetch expense
        expense_data = supabase.get_expense(expense_id)
        if not expense_data:
            result.error_message = "Expense not found"
            return result

        expense = Expense.from_dict(expense_data)

        # Apply corrections if provided
        if corrections.get("amount"):
            result.add_correction(
                field_name="amount",
                original_value=expense.amount,
                corrected_value=corrections["amount"],
                reason="Human correction",
                confidence=100,
                source="human"
            )
            expense.amount = corrections["amount"]

        if corrections.get("expense_date"):
            result.add_correction(
                field_name="expense_date",
                original_value=expense.expense_date.isoformat() if expense.expense_date else None,
                corrected_value=corrections["expense_date"],
                reason="Human correction",
                confidence=100,
                source="human"
            )
            expense.expense_date = datetime.strptime(corrections["expense_date"], "%Y-%m-%d").date()

        # Get bank transaction details
        bank_txn = supabase.get_bank_transaction(bank_transaction_id)
        if not bank_txn:
            result.error_message = "Bank transaction not found"
            return result

        result.bank_transaction_id = bank_transaction_id
        result.match_confidence = 100  # Human confirmed
        result.match_type = "human_approved"

        # Use provided state or determine from expense (normalize to 2-letter code)
        normalized_state = _normalize_state(state) if state else None
        final_state = normalized_state or expense.extracted_state or "NC"
        result.determined_state = final_state
        result.state_source = "human" if state else "zoho_tag"

        # Get or create QBO vendor
        vendor = qbo.get_or_create_vendor(expense.vendor_name or "Unknown Vendor")
        result.qbo_vendor_id = vendor.get("Id")
        result.qbo_vendor_name = vendor.get("DisplayName")

        # Get expense account from category mapping
        expense_account = supabase.get_qbo_account_for_category(expense.category_name)
        expense_account_id = expense_account.get("qbo_id") if expense_account else "87"  # Default

        logger.info(f"Expense account lookup - category: {expense.category_name}, result: {expense_account}, expense_account_id: {expense_account_id}")

        # Prepare QBO purchase parameters for logging
        payment_account_id = qbo.get_payment_account_id(expense.payment_source)
        payment_type = qbo.get_payment_type(expense.payment_source)
        class_id = qbo.get_class_id(final_state)
        txn_date = expense.expense_date.isoformat() if expense.expense_date else datetime.now().strftime("%Y-%m-%d")

        logger.info(f"QBO Purchase params - vendor_id: {result.qbo_vendor_id}, amount: {expense.amount}, "
                   f"txn_date: {txn_date}, expense_account_id: {expense_account_id}, "
                   f"payment_account_id: {payment_account_id}, payment_type: {payment_type}, "
                   f"class_id: {class_id}, state: {final_state}, payment_source: {expense.payment_source}")

        # Create QBO Purchase
        purchase = qbo.create_purchase(
            vendor_id=result.qbo_vendor_id,
            amount=expense.amount,
            txn_date=txn_date,
            expense_account_id=expense_account_id,
            payment_account_id=payment_account_id,
            payment_type=payment_type,
            class_id=class_id,
            memo=f"{expense.vendor_name} | {expense.category_name}",
            private_note=f"Human-approved via web dashboard | Zoho: {expense.zoho_expense_id}"
        )

        result.qbo_purchase_id = purchase.get("Id")

        # Upload receipt if available
        if expense.receipt_storage_path:
            try:
                receipt_url = supabase.get_receipt_signed_url(expense.receipt_storage_path)
                if receipt_url:
                    import httpx
                    with httpx.Client(timeout=30.0) as client:
                        response = client.get(receipt_url)
                        if response.status_code == 200:
                            attachable = qbo.upload_receipt(
                                purchase_id=result.qbo_purchase_id,
                                receipt_content=response.content,
                                filename=f"receipt_{expense_id}.jpg",
                                content_type=expense.receipt_content_type or "image/jpeg"
                            )
                            result.qbo_attachable_id = attachable.get("Id")
            except Exception as e:
                logger.warning(f"Failed to upload receipt: {e}")

        # Create Monday subitem for COS expenses
        if expense.is_cos and final_state:
            try:
                event = monday.get_event_for_expense(
                    expense_date=expense.expense_date.isoformat() if expense.expense_date else datetime.now().strftime("%Y-%m-%d"),
                    state_code=final_state
                )
                if event:
                    revenue_item = monday.get_revenue_item_for_event(event.get("id"))
                    if revenue_item:
                        subitem_id = monday.create_expense_subitem(
                            parent_item_id=revenue_item.get("id"),
                            item_name=f"{expense.vendor_name} - {expense.category_name}",
                            concept=expense.category_name or "Expense",
                            date=expense.expense_date.isoformat() if expense.expense_date else datetime.now().strftime("%Y-%m-%d"),
                            amount=expense.amount
                        )
                        result.monday_event_id = event.get("id")
                        result.monday_subitem_id = subitem_id
            except Exception as e:
                logger.warning(f"Failed to create Monday subitem: {e}")

        # Update expense status
        update_data = {
            "status": "posted",
            "bank_transaction_id": bank_transaction_id,
            "match_confidence": 100,
            "qbo_purchase_id": result.qbo_purchase_id,
            "processed_at": datetime.utcnow().isoformat(),
            "flag_reason": None,
            "last_error": None
        }

        if result.corrections:
            for correction in result.corrections:
                if correction.field_name == "amount":
                    update_data["original_amount"] = correction.original_value
                    update_data["amount"] = correction.corrected_value
                elif correction.field_name == "expense_date":
                    update_data["original_expense_date"] = correction.original_value

        supabase.update_expense(expense_id, update_data)

        # Update bank transaction
        supabase.update_bank_transaction(bank_transaction_id, {
            "status": "matched",
            "matched_expense_id": expense_id,
            "matched_by": "human",
            "matched_at": datetime.utcnow().isoformat(),
            "match_confidence": 100,
            "qbo_purchase_id": result.qbo_purchase_id
        })

        result.success = True
        result.decision = ProcessingDecision.AUTO_POST
        result.confidence = 100

        logger.info(f"Human-approved expense {expense_id} posted to QBO: {result.qbo_purchase_id}")

    except Exception as e:
        logger.exception(f"Error processing human-approved expense: {e}")
        result.error_message = str(e)
        result.success = False

    finally:
        result.completed_at = datetime.utcnow()

    return result


def _parse_request_body(event: dict) -> dict:
    """Parse request body from API Gateway event."""
    body = event.get("body", "{}")
    if isinstance(body, str):
        return json.loads(body)
    return body


CORS_HEADERS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-Api-Key, x-api-key",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
}


def _cors_preflight_response() -> dict:
    """Handle CORS preflight OPTIONS request."""
    return {
        "statusCode": 200,
        "headers": CORS_HEADERS,
        "body": ""
    }


def _success_response(data: dict) -> dict:
    """Create success API Gateway response."""
    return {
        "statusCode": 200,
        "headers": CORS_HEADERS,
        "body": json.dumps(data)
    }


def _error_response(status_code: int, message: str) -> dict:
    """Create error API Gateway response."""
    return {
        "statusCode": status_code,
        "headers": CORS_HEADERS,
        "body": json.dumps({"error": message})
    }
