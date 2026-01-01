"""
Review Flagging Tool
====================

Flags expenses for human review when confidence is low or ambiguous.
"""

from typing import Any

from aws_lambda_powertools import Logger

from models import ProcessingDecision

logger = Logger()


def flag_for_review(input_args: dict, context: Any) -> dict:
    """
    Flag the expense for human review.

    Use when:
    - Confidence is below threshold
    - Ambiguous state determination
    - Multiple potential bank matches
    - Receipt validation fails
    - Any other situation requiring human judgment

    Args:
        input_args: Tool input with reason, confidence, suggestions
        context: ToolContext with result tracking

    Returns:
        Confirmation of flagging
    """
    reason = input_args.get("reason")
    confidence = input_args.get("confidence", 0)
    suggestions = input_args.get("suggestions", [])

    if not reason:
        return {"success": False, "error": "Missing reason for flagging"}

    logger.info(f"Flagging expense for review: {reason} (confidence: {confidence}%)")

    # Update result tracking
    context.result.success = False
    context.result.decision = ProcessingDecision.NEEDS_REVIEW
    context.result.confidence = confidence
    context.result.flag_reason = reason

    # Build detailed flag message
    flag_message = f"AI flagged for review: {reason}"
    if suggestions:
        flag_message += f"\n\nSuggestions:\n- " + "\n- ".join(suggestions)

    # Update expense in database - set to 'flagged' so it appears in review queue
    try:
        context.supabase.update_expense(context.expense.id, {
            "status": "flagged",  # Shows in review queue (zoho_expenses with status='flagged')
            "flag_reason": flag_message[:500],  # Truncate if too long
            "match_confidence": confidence,
            "last_error": None  # Clear any previous error
        })
        logger.info(f"Expense {context.expense.id} flagged for review")
    except Exception as e:
        logger.error(f"Failed to update expense status: {e}")

    return {
        "success": True,
        "flagged": True,
        "reason": reason,
        "confidence": confidence,
        "suggestions": suggestions,
        "message": "Expense has been flagged for human review in the web dashboard"
    }
