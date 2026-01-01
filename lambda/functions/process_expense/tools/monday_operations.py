"""
Monday.com Operations Tool
==========================

Creates expense subitems in Course Revenue Tracker.
"""

from typing import Any

from aws_lambda_powertools import Logger

logger = Logger()


def create_monday_subitem(input_args: dict, context: Any) -> dict:
    """
    Create expense subitem in Monday.com Course Revenue Tracker.

    Only for COS (Cost of Sales) expenses that need to be tracked
    against course events.

    Args:
        input_args: Tool input with expense_date, state_code, item_name, category, amount
        context: ToolContext with Monday client

    Returns:
        Created subitem details
    """
    expense_date = input_args.get("expense_date")
    state_code = input_args.get("state_code")
    item_name = input_args.get("item_name")
    category = input_args.get("category")
    amount = input_args.get("amount")

    if not all([expense_date, item_name, category, amount]):
        missing = []
        if not expense_date:
            missing.append("expense_date")
        if not item_name:
            missing.append("item_name")
        if not category:
            missing.append("category")
        if not amount:
            missing.append("amount")
        return {"success": False, "error": f"Missing required fields: {', '.join(missing)}"}

    logger.info(f"Creating Monday subitem: {item_name} ${amount} on {expense_date}")

    try:
        # First find the event in Training Calendar
        event = context.monday.get_event_for_expense(
            expense_date=expense_date,
            state_code=state_code,
            buffer_days=2
        )

        if not event:
            return {
                "success": False,
                "error": f"No Monday event found for date {expense_date}",
                "note": "COS expense cannot be linked without matching event"
            }

        event_id = event.get("id")
        event_name = event.get("name")

        logger.info(f"Found event: {event_name} ({event_id})")

        # Find corresponding Revenue Tracker item
        revenue_item = context.monday.get_revenue_item_for_event(event_id)

        if not revenue_item:
            logger.warning(f"No Revenue Tracker item for event {event_id}")
            return {
                "success": False,
                "error": f"No Revenue Tracker item linked to event '{event_name}'",
                "event": {
                    "id": event_id,
                    "name": event_name
                }
            }

        parent_item_id = revenue_item.get("id")

        # Create the subitem
        subitem_id = context.monday.create_expense_subitem(
            parent_item_id=parent_item_id,
            item_name=item_name,
            concept=category,
            date=expense_date,
            amount=amount
        )

        if subitem_id:
            context.result.monday_event_id = event_id
            context.result.monday_subitem_id = subitem_id

            logger.info(f"Created Monday subitem: {subitem_id}")

            return {
                "success": True,
                "subitem": {
                    "id": subitem_id,
                    "name": item_name,
                    "parent_id": parent_item_id
                },
                "event": {
                    "id": event_id,
                    "name": event_name
                }
            }

        return {
            "success": False,
            "error": "Failed to create subitem (no ID returned)"
        }

    except Exception as e:
        logger.error(f"Monday subitem creation error: {e}")
        return {"success": False, "error": str(e)}
