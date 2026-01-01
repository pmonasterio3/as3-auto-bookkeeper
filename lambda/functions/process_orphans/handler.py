"""
Process Orphan Transactions Lambda Handler
==========================================

Scheduled function that processes bank transactions without
expense matches after a waiting period (5+ days old).

Uses AI to determine expense category and state based on
vendor patterns and historical data.
"""

import json
from datetime import datetime, timedelta
from typing import Any

import anthropic
from aws_lambda_powertools import Logger, Metrics, Tracer
from aws_lambda_powertools.metrics import MetricUnit
from aws_lambda_powertools.utilities.typing import LambdaContext

from utils.supabase_client import SupabaseClient
from utils.qbo_client import QBOClient
from models import BankTransaction

logger = Logger()
metrics = Metrics()
tracer = Tracer()

# Configuration
ORPHAN_AGE_DAYS = 5  # Only process transactions older than this
MAX_ORPHANS_PER_RUN = 20  # Limit per invocation
ANTHROPIC_MODEL = "claude-sonnet-4-20250514"


@logger.inject_lambda_context
@metrics.log_metrics
@tracer.capture_lambda_handler
def lambda_handler(event: dict, context: LambdaContext) -> dict:
    """
    Process orphan bank transactions.

    Triggered by CloudWatch Events schedule (daily).
    Finds unmatched transactions older than 5 days and
    processes them directly to QBO based on AI categorization.
    """
    logger.info("Starting orphan transaction processing")

    supabase = SupabaseClient()

    try:
        # Get orphan transactions
        cutoff_date = (datetime.now() - timedelta(days=ORPHAN_AGE_DAYS)).strftime("%Y-%m-%d")
        orphans = supabase.get_orphan_transactions(
            before_date=cutoff_date,
            limit=MAX_ORPHANS_PER_RUN
        )

        if not orphans:
            logger.info("No orphan transactions found")
            return {"statusCode": 200, "body": json.dumps({"processed": 0})}

        logger.info(f"Found {len(orphans)} orphan transactions to process")

        # Get categorization history for AI context
        history = supabase.get_categorization_history(limit=50)

        processed = 0
        errors = 0

        for txn_data in orphans:
            txn = BankTransaction.from_dict(txn_data)

            try:
                result = process_orphan_transaction(txn, supabase, history)

                if result.get("success"):
                    processed += 1
                else:
                    errors += 1

            except Exception as e:
                logger.error(f"Error processing orphan {txn.id}: {e}")
                errors += 1

        metrics.add_metric(name="OrphansProcessed", unit=MetricUnit.Count, value=processed)
        metrics.add_metric(name="OrphanErrors", unit=MetricUnit.Count, value=errors)

        return {
            "statusCode": 200,
            "body": json.dumps({
                "processed": processed,
                "errors": errors,
                "total_found": len(orphans)
            })
        }

    except Exception as e:
        logger.exception(f"Error in orphan processing: {e}")
        return {
            "statusCode": 500,
            "body": json.dumps({"error": str(e)})
        }


def process_orphan_transaction(
    txn: BankTransaction,
    supabase: SupabaseClient,
    history: list[dict]
) -> dict:
    """
    Process a single orphan transaction.

    Uses AI to determine:
    - Expense category
    - State assignment
    - Whether it should be excluded (personal, duplicate, etc.)
    """
    logger.info(f"Processing orphan: {txn.description} ${txn.amount}")

    # Build context for AI
    history_summary = _build_history_summary(history)

    # Call Claude for categorization
    client = anthropic.Anthropic()

    prompt = f"""Analyze this bank transaction and determine how to categorize it:

## Transaction
- Date: {txn.transaction_date.isoformat()}
- Description: {txn.description}
- Amount: ${txn.amount:.2f}
- Source: {txn.source}
- Extracted Vendor: {txn.extracted_vendor or 'Unknown'}

## Historical Patterns
{history_summary}

## Instructions
Based on the description and vendor patterns, determine:
1. Should this be PROCESSED or EXCLUDED?
   - PROCESS: Business expense that should be posted to QBO
   - EXCLUDE: Personal, duplicate, transfer, or non-expense transaction

2. If PROCESSED:
   - Category: Best matching expense category
   - State: Most likely state (CA, TX, CO, WA, NJ, FL, MT, NC)
   - Confidence: 0-100% confidence in categorization

Respond with JSON only:
{{
    "action": "PROCESS" or "EXCLUDE",
    "exclude_reason": "reason if excluded",
    "category": "expense category if processed",
    "state": "two-letter state code if processed",
    "confidence": 0-100,
    "reasoning": "brief explanation"
}}"""

    response = client.messages.create(
        model=ANTHROPIC_MODEL,
        max_tokens=500,
        messages=[{"role": "user", "content": prompt}]
    )

    # Parse response
    response_text = response.content[0].text

    try:
        import re
        json_match = re.search(r'\{[\s\S]*\}', response_text)
        if json_match:
            decision = json.loads(json_match.group())
        else:
            raise ValueError("No JSON found in response")
    except Exception as e:
        logger.error(f"Failed to parse AI response: {e}")
        return {"success": False, "error": "AI response parsing failed"}

    action = decision.get("action", "EXCLUDE")
    confidence = decision.get("confidence", 0)

    if action == "EXCLUDE":
        # Mark as excluded
        supabase.update_bank_transaction(txn.id, {
            "status": "excluded",
            "orphan_category": "excluded",
            "orphan_state": None,
            "orphan_determination_method": "ai_agent",
            "orphan_processed_at": datetime.utcnow().isoformat()
        })

        logger.info(f"Excluded orphan {txn.id}: {decision.get('exclude_reason')}")
        return {"success": True, "action": "excluded"}

    elif action == "PROCESS" and confidence >= 70:
        # Process to QBO
        category = decision.get("category", "Office Expenses")
        state = decision.get("state", "NC")

        qbo = QBOClient()

        try:
            # Get or create vendor
            vendor_name = txn.extracted_vendor or _extract_vendor_from_description(txn.description)
            vendor = qbo.get_or_create_vendor(vendor_name)

            # Get expense account for category
            expense_account = supabase.get_qbo_account_for_category(category)
            expense_account_id = expense_account.get("qbo_account_id") if expense_account else "87"

            # Create purchase
            purchase = qbo.create_purchase(
                vendor_id=vendor.get("Id"),
                amount=txn.amount,
                txn_date=txn.transaction_date.isoformat(),
                expense_account_id=expense_account_id,
                payment_account_id=qbo.get_payment_account_id(txn.source),
                payment_type=qbo.get_payment_type(txn.source),
                class_id=qbo.get_class_id(state),
                memo=f"Orphan: {txn.description[:50]}",
                private_note=f"Auto-processed orphan | AI confidence: {confidence}%"
            )

            purchase_id = purchase.get("Id")

            # Update bank transaction
            supabase.update_bank_transaction(txn.id, {
                "status": "orphan_processed",
                "orphan_category": category,
                "orphan_state": state,
                "orphan_determination_method": "ai_agent",
                "orphan_processed_at": datetime.utcnow().isoformat(),
                "qbo_purchase_id": purchase_id
            })

            # Log for learning
            supabase.log_categorization_history(
                vendor=vendor_name,
                description=txn.description,
                category=category,
                state=state,
                confidence=confidence
            )

            logger.info(f"Processed orphan {txn.id} to QBO: {purchase_id}")
            return {"success": True, "action": "processed", "qbo_purchase_id": purchase_id}

        except Exception as e:
            logger.error(f"Failed to post orphan to QBO: {e}")
            return {"success": False, "error": str(e)}

    else:
        # Low confidence - mark for manual review
        supabase.update_bank_transaction(txn.id, {
            "status": "pending_review",
            "orphan_category": decision.get("category"),
            "orphan_state": decision.get("state"),
            "orphan_determination_method": "ai_low_confidence"
        })

        logger.info(f"Flagged orphan {txn.id} for review (confidence: {confidence}%)")
        return {"success": True, "action": "flagged_for_review"}


def _build_history_summary(history: list[dict]) -> str:
    """Build summary of historical categorizations for AI context."""
    if not history:
        return "No historical data available."

    lines = ["Recent categorization patterns:"]
    for item in history[:20]:
        vendor = item.get("vendor", "Unknown")
        category = item.get("category", "Unknown")
        state = item.get("state", "NC")
        lines.append(f"- {vendor}: {category} ({state})")

    return "\n".join(lines)


def _extract_vendor_from_description(description: str) -> str:
    """Extract likely vendor name from bank description."""
    if not description:
        return "Unknown Vendor"

    # Remove common prefixes
    prefixes = ["PURCHASE ", "POS ", "DEBIT ", "ACH ", "CHECKCARD "]
    for prefix in prefixes:
        if description.upper().startswith(prefix):
            description = description[len(prefix):]

    # Take first few words
    words = description.split()[:3]
    vendor = " ".join(words)

    # Clean up
    vendor = vendor.strip("*#0123456789").strip()

    return vendor if vendor else "Unknown Vendor"
