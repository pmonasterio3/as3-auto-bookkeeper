"""
Bank Transaction Matching Tool
==============================

Finds matching bank transactions for expenses.
"""

from typing import Any
from datetime import datetime, timedelta

from aws_lambda_powertools import Logger

from models import BankTransaction

logger = Logger()


def match_bank_transaction(input_args: dict, context: Any) -> dict:
    """
    Find a matching bank transaction for the expense.

    Uses amount, date range, and optional merchant matching.
    Returns best match with confidence score.

    Args:
        input_args: Tool input with amount, date, source, tolerances
        context: ToolContext with supabase client

    Returns:
        Match result with transaction details and confidence
    """
    amount = input_args.get("amount")
    expense_date = input_args.get("date")
    merchant_name = input_args.get("merchant_name")
    source = input_args.get("source", "amex")
    amount_tolerance = input_args.get("amount_tolerance", 0.50)
    date_tolerance_days = input_args.get("date_tolerance_days", 3)

    if not amount or not expense_date:
        return {"success": False, "error": "Missing required fields: amount and date"}

    logger.info(f"Searching bank transactions: ${amount} on {expense_date} from {source}")

    try:
        # Calculate date range
        date_obj = datetime.strptime(expense_date, "%Y-%m-%d").date()
        start_date = (date_obj - timedelta(days=date_tolerance_days)).isoformat()
        end_date = (date_obj + timedelta(days=date_tolerance_days)).isoformat()

        # Query unmatched transactions in date range
        candidates = context.supabase.get_unmatched_bank_transactions(
            source=source,
            start_date=start_date,
            end_date=end_date
        )

        if not candidates:
            logger.info("No unmatched transactions in date range")
            return {
                "success": True,
                "found": False,
                "message": f"No unmatched {source} transactions found between {start_date} and {end_date}"
            }

        # Score each candidate
        best_match = None
        best_score = 0
        best_match_type = "no_match"

        for txn_data in candidates:
            txn = BankTransaction.from_dict(txn_data)

            is_match, score, match_type = txn.matches_expense(
                expense_amount=amount,
                expense_date=date_obj,
                merchant_name=merchant_name,
                amount_tolerance=amount_tolerance,
                date_tolerance_days=date_tolerance_days
            )

            if is_match and score > best_score:
                best_match = txn
                best_score = score
                best_match_type = match_type

        if best_match:
            logger.info(f"Found match: {best_match.id} with confidence {best_score}")

            # Update result tracking
            context.result.bank_transaction_id = best_match.id
            context.result.match_confidence = best_score
            context.result.match_type = best_match_type

            return {
                "success": True,
                "found": True,
                "transaction": {
                    "id": best_match.id,
                    "date": best_match.transaction_date.isoformat(),
                    "amount": best_match.amount,
                    "description": best_match.description,
                    "extracted_vendor": best_match.extracted_vendor,
                    "source": best_match.source
                },
                "confidence": best_score,
                "match_type": best_match_type
            }

        # No match found - try date inversion (DD/MM vs MM/DD confusion)
        # Only try if day <= 12 (can be valid month) and month != day
        inverted_match = _try_date_inversion_match(
            context, candidates, amount, date_obj, merchant_name,
            amount_tolerance, date_tolerance_days, source, expense_date
        )
        if inverted_match:
            return inverted_match

        # No exact match - check for restaurant with tip scenario
        tip_match = _find_tip_match(candidates, amount, date_obj, merchant_name)
        if tip_match:
            context.result.bank_transaction_id = tip_match["id"]
            context.result.match_confidence = tip_match["confidence"]
            context.result.match_type = "restaurant_with_tip"

            # Record correction for the amount difference
            context.result.add_correction(
                field_name="amount",
                original_value=amount,
                corrected_value=tip_match["amount"],
                reason=f"Bank transaction ${tip_match['amount']} includes tip (original expense ${amount})",
                confidence=tip_match["confidence"],
                source="bank_transaction"
            )

            return {
                "success": True,
                "found": True,
                "transaction": tip_match,
                "confidence": tip_match["confidence"],
                "match_type": "restaurant_with_tip",
                "note": f"Bank amount ${tip_match['amount']} likely includes tip on ${amount} subtotal"
            }

        logger.info("No matching transaction found")
        return {
            "success": True,
            "found": False,
            "message": f"No matching transaction found for ${amount}",
            "candidates_checked": len(candidates)
        }

    except Exception as e:
        logger.error(f"Bank matching error: {e}")
        return {"success": False, "error": str(e)}


def _try_date_inversion_match(
    context: Any,
    candidates: list[dict],
    amount: float,
    original_date,
    merchant_name: str | None,
    amount_tolerance: float,
    date_tolerance_days: int,
    source: str,
    original_date_str: str
) -> dict | None:
    """
    Try matching with inverted date (DD/MM swapped to MM/DD or vice versa).

    This handles cases where Zoho received a date like "11/03" and interpreted it
    as March 11 when it was actually November 3rd (or vice versa).

    Only attempts inversion if:
    - Day value is <= 12 (could be a valid month)
    - Month != Day (otherwise inversion produces same date)
    """
    day = original_date.day
    month = original_date.month

    # Can only invert if day could be a valid month (1-12) and they differ
    if day > 12 or day == month:
        return None

    # Create inverted date (swap month and day)
    try:
        inverted_date = original_date.replace(month=day, day=month)
        inverted_date_str = inverted_date.isoformat()
    except ValueError:
        # Invalid date after inversion (e.g., Feb 30)
        return None

    logger.info(f"Trying date inversion: {original_date_str} -> {inverted_date_str}")

    # Calculate new date range for inverted date
    start_date = (inverted_date - timedelta(days=date_tolerance_days)).isoformat()
    end_date = (inverted_date + timedelta(days=date_tolerance_days)).isoformat()

    # Query transactions for inverted date range
    inverted_candidates = context.supabase.get_unmatched_bank_transactions(
        source=source,
        start_date=start_date,
        end_date=end_date
    )

    if not inverted_candidates:
        logger.info("No transactions found with inverted date range")
        return None

    # Score candidates with inverted date
    best_match = None
    best_score = 0
    best_match_type = "no_match"

    for txn_data in inverted_candidates:
        txn = BankTransaction.from_dict(txn_data)

        is_match, score, match_type = txn.matches_expense(
            expense_amount=amount,
            expense_date=inverted_date,
            merchant_name=merchant_name,
            amount_tolerance=amount_tolerance,
            date_tolerance_days=date_tolerance_days
        )

        if is_match and score > best_score:
            best_match = txn
            best_score = score
            best_match_type = match_type

    if best_match:
        logger.info(f"Found match with INVERTED date: {best_match.id} confidence {best_score}")
        logger.info(f"Date correction: {original_date_str} -> {inverted_date_str}")

        # Update result tracking
        context.result.bank_transaction_id = best_match.id
        context.result.match_confidence = best_score
        context.result.match_type = f"{best_match_type}_date_corrected"

        # Record the date correction for audit trail
        context.result.add_correction(
            field_name="expense_date",
            original_value=original_date_str,
            corrected_value=inverted_date_str,
            reason=f"Date inversion detected (DD/MM vs MM/DD). Original {original_date_str} corrected to {inverted_date_str} to match bank transaction.",
            confidence=best_score,
            source="bank_transaction_matching"
        )

        return {
            "success": True,
            "found": True,
            "transaction": {
                "id": best_match.id,
                "date": best_match.transaction_date.isoformat(),
                "amount": best_match.amount,
                "description": best_match.description,
                "extracted_vendor": best_match.extracted_vendor,
                "source": best_match.source
            },
            "confidence": best_score,
            "match_type": f"{best_match_type}_date_corrected",
            "date_correction": {
                "original": original_date_str,
                "corrected": inverted_date_str,
                "reason": "DD/MM vs MM/DD inversion detected and auto-corrected"
            }
        }

    return None


def _find_tip_match(
    candidates: list[dict],
    expense_amount: float,
    expense_date,
    merchant_name: str | None
) -> dict | None:
    """Find a transaction that matches expense + tip (15-25%)."""
    for txn_data in candidates:
        txn_amount = float(txn_data.get("amount", 0))

        if expense_amount <= 0:
            continue

        tip_ratio = txn_amount / expense_amount

        # Check for 15-25% tip range
        if 1.15 <= tip_ratio <= 1.25:
            txn_date = txn_data.get("transaction_date", "")
            if isinstance(txn_date, str):
                try:
                    txn_date = datetime.strptime(txn_date[:10], "%Y-%m-%d").date()
                except ValueError:
                    continue

            # Date must be close
            if abs((txn_date - expense_date).days) <= 3:
                logger.info(f"Found tip match: ${txn_amount} is {tip_ratio:.1%} of ${expense_amount}")

                return {
                    "id": txn_data.get("id"),
                    "date": txn_date.isoformat() if hasattr(txn_date, "isoformat") else str(txn_date),
                    "amount": txn_amount,
                    "description": txn_data.get("description", ""),
                    "extracted_vendor": txn_data.get("extracted_vendor"),
                    "source": txn_data.get("source", ""),
                    "confidence": 75
                }

    return None
