"""
Recover Stuck Expenses Lambda Handler
=====================================

Scheduled function that runs every 15 minutes to recover
expenses stuck in 'processing' state for more than 10 minutes.
"""

import json
from datetime import datetime, timedelta

from aws_lambda_powertools import Logger, Metrics, Tracer
from aws_lambda_powertools.metrics import MetricUnit
from aws_lambda_powertools.utilities.typing import LambdaContext

from utils.supabase_client import SupabaseClient

logger = Logger()
metrics = Metrics()
tracer = Tracer()

# Stuck threshold in minutes
STUCK_THRESHOLD_MINUTES = 10
MAX_RETRY_ATTEMPTS = 3


@logger.inject_lambda_context
@metrics.log_metrics
@tracer.capture_lambda_handler
def lambda_handler(event: dict, context: LambdaContext) -> dict:
    """
    Recover stuck expenses.

    Triggered by CloudWatch Events schedule (every 15 minutes).
    Finds expenses in 'processing' state for more than 10 minutes
    and either retries them or flags for review.
    """
    logger.info("Starting stuck expense recovery")

    supabase = SupabaseClient()

    try:
        # Find stuck expenses
        stuck_expenses = supabase.get_stuck_expenses(
            minutes_threshold=STUCK_THRESHOLD_MINUTES
        )

        if not stuck_expenses:
            logger.info("No stuck expenses found")
            return {"statusCode": 200, "body": json.dumps({"recovered": 0})}

        logger.info(f"Found {len(stuck_expenses)} stuck expenses")

        recovered = 0
        flagged = 0

        for expense in stuck_expenses:
            expense_id = expense.get("id")
            attempts = expense.get("processing_attempts", 0)

            if attempts < MAX_RETRY_ATTEMPTS:
                # Reset to pending for retry
                supabase.update_expense(expense_id, {
                    "status": "pending",
                    "processing_attempts": attempts + 1,
                    "last_error": f"Recovered from stuck state (attempt {attempts + 1})"
                })
                recovered += 1
                logger.info(f"Reset expense {expense_id} for retry (attempt {attempts + 1})")

            else:
                # Max retries exceeded - flag for review
                supabase.update_expense(expense_id, {
                    "status": "flagged",
                    "flag_reason": f"Max retry attempts ({MAX_RETRY_ATTEMPTS}) exceeded",
                    "last_error": "Processing repeatedly failed - manual review required"
                })
                flagged += 1
                logger.warning(f"Flagged expense {expense_id} - max retries exceeded")

        metrics.add_metric(name="StuckExpensesRecovered", unit=MetricUnit.Count, value=recovered)
        metrics.add_metric(name="StuckExpensesFlagged", unit=MetricUnit.Count, value=flagged)

        return {
            "statusCode": 200,
            "body": json.dumps({
                "recovered": recovered,
                "flagged": flagged,
                "total_found": len(stuck_expenses)
            })
        }

    except Exception as e:
        logger.exception(f"Error in stuck recovery: {e}")
        return {
            "statusCode": 500,
            "body": json.dumps({"error": str(e)})
        }
