"""
State Determination Tool
========================

Determines expense state using waterfall logic.
"""

from typing import Any

from aws_lambda_powertools import Logger

logger = Logger()

# State code extraction patterns
STATE_PATTERNS = {
    "CA": ["CALIFORNIA", " CA ", " CA,", "- CA"],
    "TX": ["TEXAS", " TX ", " TX,", "- TX"],
    "CO": ["COLORADO", " CO ", " CO,", "- CO"],
    "WA": ["WASHINGTON", " WA ", " WA,", "- WA"],
    "NJ": ["NEW JERSEY", " NJ ", " NJ,", "- NJ"],
    "FL": ["FLORIDA", " FL ", " FL,", "- FL"],
    "MT": ["MONTANA", " MT ", " MT,", "- MT"],
    "NC": ["NORTH CAROLINA", " NC ", " NC,", "- NC", "OTHER"],
}


def determine_state(input_args: dict, context: Any) -> dict:
    """
    Determine expense state using waterfall logic.

    Priority:
    1. Zoho Course Location tag (most reliable for non-COS)
    2. Monday.com event venue (primary for COS expenses)
    3. Vendor rules from database (fallback)
    4. Return unknown if no determination possible

    Args:
        input_args: Tool input with zoho_state_tag, expense_date, vendor_name, is_cos
        context: ToolContext with clients

    Returns:
        State determination result with source
    """
    zoho_state_tag = input_args.get("zoho_state_tag")
    expense_date = input_args.get("expense_date")
    vendor_name = input_args.get("vendor_name")
    is_cos = input_args.get("is_cos", False)

    logger.info(f"Determining state: tag={zoho_state_tag}, date={expense_date}, vendor={vendor_name}")

    # 1. Try Zoho tag first (unless COS, where Monday is preferred)
    if zoho_state_tag and not is_cos:
        state = _extract_state_from_tag(zoho_state_tag)
        if state:
            logger.info(f"State from Zoho tag: {state}")

            context.result.determined_state = state
            context.result.state_source = "zoho_tag"

            return {
                "success": True,
                "state": state,
                "source": "zoho_tag",
                "confidence": 95,
                "raw_tag": zoho_state_tag
            }

    # 2. Try Monday.com event lookup
    if expense_date:
        monday_result = _lookup_monday_event(context, expense_date, zoho_state_tag)
        if monday_result.get("state"):
            context.result.determined_state = monday_result["state"]
            context.result.state_source = "monday_event"
            context.result.monday_event_id = monday_result.get("event_id")

            return {
                "success": True,
                "state": monday_result["state"],
                "source": "monday_event",
                "confidence": 90,
                "event_name": monday_result.get("event_name"),
                "event_id": monday_result.get("event_id")
            }

    # 3. Try vendor rules
    if vendor_name:
        vendor_state = _lookup_vendor_state(context, vendor_name)
        if vendor_state:
            context.result.determined_state = vendor_state["state"]
            context.result.state_source = "vendor_rule"

            return {
                "success": True,
                "state": vendor_state["state"],
                "source": "vendor_rule",
                "confidence": vendor_state.get("confidence", 70),
                "rule_note": vendor_state.get("note")
            }

    # 4. Fall back to Zoho tag even for COS (if available)
    if zoho_state_tag:
        state = _extract_state_from_tag(zoho_state_tag)
        if state:
            context.result.determined_state = state
            context.result.state_source = "zoho_tag_fallback"

            return {
                "success": True,
                "state": state,
                "source": "zoho_tag_fallback",
                "confidence": 80,
                "note": "Fell back to Zoho tag for COS expense (no Monday event found)"
            }

    # No state determined
    logger.warning("Could not determine state")
    return {
        "success": False,
        "state": None,
        "source": "none",
        "confidence": 0,
        "message": "Unable to determine state from any source. Manual review may be needed."
    }


def _extract_state_from_tag(tag: str) -> str | None:
    """Extract state code from Zoho tag like 'California - CA'."""
    if not tag:
        return None

    tag_upper = tag.upper().strip()

    # Handle "Other" -> NC (admin/home office)
    if tag_upper == "OTHER":
        return "NC"

    # Try to match patterns
    for state_code, patterns in STATE_PATTERNS.items():
        for pattern in patterns:
            if pattern in tag_upper:
                return state_code

    # Try direct extraction from "State Name - XX" format
    if " - " in tag:
        parts = tag.split(" - ")
        if len(parts) == 2:
            code = parts[1].strip().upper()
            if len(code) == 2 and code.isalpha():
                return code

    return None


def _lookup_monday_event(context: Any, expense_date: str, state_hint: str | None) -> dict:
    """Look up Monday.com event for expense date."""
    try:
        # Extract state code from hint if available
        state_code = None
        if state_hint:
            state_code = _extract_state_from_tag(state_hint)

        event = context.monday.get_event_for_expense(
            expense_date=expense_date,
            state_code=state_code,
            buffer_days=2
        )

        if event:
            return {
                "state": event.get("state"),
                "event_name": event.get("name"),
                "event_id": event.get("id"),
                "venue": event.get("venue")
            }

    except Exception as e:
        logger.error(f"Monday event lookup error: {e}")

    return {}


def _lookup_vendor_state(context: Any, vendor_name: str) -> dict | None:
    """Look up vendor-specific state assignment rules."""
    try:
        # Check for vendor rules in database
        rules = context.supabase.get_vendor_state_rules(vendor_name)

        if rules:
            return {
                "state": rules.get("default_state"),
                "confidence": rules.get("confidence", 70),
                "note": rules.get("rule_note")
            }

        # Built-in vendor patterns
        vendor_patterns = {
            "CHEVRON": {"state": None, "note": "Gas station - needs location"},
            "SHELL": {"state": None, "note": "Gas station - needs location"},
            "STARBUCKS": {"state": None, "note": "Coffee - needs location"},
            "AMAZON": {"state": "NC", "note": "Online order - default to admin", "confidence": 60},
            "COSTCO": {"state": None, "note": "Retail - needs location"},
        }

        vendor_upper = vendor_name.upper()
        for pattern, rule in vendor_patterns.items():
            if pattern in vendor_upper:
                if rule.get("state"):
                    return rule
                break

    except Exception as e:
        logger.error(f"Vendor rule lookup error: {e}")

    return None
