"""
Receipt Validation Tool
=======================

Uses Claude vision to validate receipts against expense data.
"""

import base64
from datetime import datetime
from typing import Any

import anthropic
import httpx
from aws_lambda_powertools import Logger

logger = Logger()

# Vision model for receipt analysis
VISION_MODEL = "claude-sonnet-4-20250514"


def validate_receipt(input_args: dict, context: Any) -> dict:
    """
    Validate receipt image against expense data.

    Uses Claude vision to extract receipt details and compare
    against expected values. Detects discrepancies for self-correction.

    Args:
        input_args: Tool input with receipt_url, expected_amount, etc.
        context: ToolContext with expense and clients

    Returns:
        Validation result with extracted details and match status
    """
    receipt_url = input_args.get("receipt_url")
    expected_amount = input_args.get("expected_amount")
    expected_merchant = input_args.get("expected_merchant")
    expected_date = input_args.get("expected_date")

    if not receipt_url:
        return {"success": False, "error": "Missing receipt_url"}

    logger.info(f"Validating receipt: {receipt_url[:50]}...")

    try:
        # Fetch receipt image
        image_data, content_type = _fetch_receipt_image(receipt_url)

        if not image_data:
            return {
                "success": False,
                "error": "Failed to fetch receipt image",
                "validated": False
            }

        # Use Claude vision to analyze receipt
        extracted = _analyze_receipt_with_vision(image_data, content_type)

        if not extracted.get("success"):
            return {
                "success": False,
                "error": extracted.get("error", "Vision analysis failed"),
                "validated": False
            }

        # Compare extracted values with expected
        validation = _compare_receipt_data(
            extracted,
            expected_amount,
            expected_merchant,
            expected_date
        )

        # Update result tracking
        context.result.receipt_validated = validation["validated"]
        context.result.receipt_amount = extracted.get("amount")
        context.result.receipt_date = extracted.get("date")
        context.result.receipt_merchant = extracted.get("merchant")
        context.result.receipt_validation_notes = validation.get("notes")

        # Record corrections if amounts differ
        if validation.get("amount_differs") and extracted.get("amount"):
            context.result.add_correction(
                field_name="amount",
                original_value=expected_amount,
                corrected_value=extracted["amount"],
                reason=f"Receipt shows different amount: ${extracted['amount']}",
                confidence=validation.get("confidence", 85),
                source="receipt"
            )

        # Record date corrections
        if validation.get("date_differs") and extracted.get("date"):
            context.result.add_correction(
                field_name="expense_date",
                original_value=expected_date,
                corrected_value=extracted["date"],
                reason=f"Receipt shows different date: {extracted['date']}",
                confidence=validation.get("confidence", 80),
                source="receipt"
            )

        return {
            "success": True,
            "validated": validation["validated"],
            "confidence": validation.get("confidence", 0),
            "extracted": {
                "amount": extracted.get("amount"),
                "date": extracted.get("date"),
                "merchant": extracted.get("merchant"),
                "items": extracted.get("items", [])
            },
            "discrepancies": validation.get("discrepancies", []),
            "notes": validation.get("notes"),
            "suggested_corrections": validation.get("suggested_corrections", {})
        }

    except Exception as e:
        logger.error(f"Receipt validation error: {e}")
        return {
            "success": False,
            "error": str(e),
            "validated": False
        }


def _fetch_receipt_image(url: str) -> tuple[bytes | None, str]:
    """Fetch receipt image from signed URL."""
    try:
        with httpx.Client(timeout=30.0) as client:
            response = client.get(url)
            response.raise_for_status()

            content_type = response.headers.get("content-type", "image/jpeg")
            return response.content, content_type

    except Exception as e:
        logger.error(f"Failed to fetch receipt: {e}")
        return None, ""


def _analyze_receipt_with_vision(image_data: bytes, content_type: str) -> dict:
    """Use Claude vision to extract receipt details."""
    try:
        client = anthropic.Anthropic()

        # Determine media type
        if "png" in content_type.lower():
            media_type = "image/png"
        elif "pdf" in content_type.lower():
            media_type = "application/pdf"
        else:
            media_type = "image/jpeg"

        # Encode image to base64
        image_b64 = base64.b64encode(image_data).decode("utf-8")

        # Build vision request
        response = client.messages.create(
            model=VISION_MODEL,
            max_tokens=1024,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": media_type,
                                "data": image_b64
                            }
                        },
                        {
                            "type": "text",
                            "text": """Analyze this receipt and extract the following information.
Return ONLY a JSON object with these fields:

{
    "merchant": "Business name on receipt",
    "date": "YYYY-MM-DD format (use US date format MM/DD/YYYY)",
    "subtotal": numeric amount before tax,
    "tax": numeric tax amount if shown,
    "total": numeric total amount,
    "tip": numeric tip amount if shown,
    "items": ["list of line items if visible"],
    "payment_method": "credit card type if shown",
    "confidence": 0-100 confidence in extraction
}

Important:
- For dates, assume US format (MM/DD/YYYY) unless clearly European
- If tip is included, note the pre-tip subtotal
- Return null for fields you cannot determine
- Be precise with amounts"""
                        }
                    ]
                }
            ]
        )

        # Parse response
        response_text = response.content[0].text

        # Try to extract JSON from response
        import json
        import re

        # Find JSON in response
        json_match = re.search(r'\{[\s\S]*\}', response_text)
        if json_match:
            extracted = json.loads(json_match.group())
            extracted["success"] = True

            # Normalize amount to "amount" field
            if extracted.get("total"):
                extracted["amount"] = extracted["total"]
            elif extracted.get("subtotal"):
                extracted["amount"] = extracted["subtotal"]

            return extracted

        return {
            "success": False,
            "error": "Could not parse receipt data"
        }

    except Exception as e:
        logger.error(f"Vision analysis error: {e}")
        return {"success": False, "error": str(e)}


def _compare_receipt_data(
    extracted: dict,
    expected_amount: float | None,
    expected_merchant: str | None,
    expected_date: str | None
) -> dict:
    """Compare extracted receipt data with expected values."""
    discrepancies = []
    confidence = 100
    validated = True
    suggested_corrections = {}

    # Compare amounts
    receipt_amount = extracted.get("amount")
    amount_differs = False

    if receipt_amount and expected_amount:
        amount_diff = abs(receipt_amount - expected_amount)

        # Check for exact match
        if amount_diff < 0.01:
            pass  # Exact match
        # Check for tip scenario (15-25% over)
        elif receipt_amount > expected_amount:
            tip_ratio = receipt_amount / expected_amount
            if 1.15 <= tip_ratio <= 1.25:
                discrepancies.append(f"Receipt total (${receipt_amount}) includes tip. Pre-tip may be ${expected_amount}")
                confidence -= 5
            else:
                discrepancies.append(f"Amount mismatch: receipt ${receipt_amount}, expected ${expected_amount}")
                amount_differs = True
                validated = False
                confidence -= 20
                suggested_corrections["amount"] = receipt_amount
        else:
            discrepancies.append(f"Amount mismatch: receipt ${receipt_amount}, expected ${expected_amount}")
            amount_differs = True
            validated = False
            confidence -= 20
            suggested_corrections["amount"] = receipt_amount

    # Compare dates
    receipt_date = extracted.get("date")
    date_differs = False

    if receipt_date and expected_date:
        if receipt_date != expected_date:
            # Check for date inversion (DD/MM vs MM/DD)
            try:
                expected_dt = datetime.strptime(expected_date, "%Y-%m-%d")
                receipt_dt = datetime.strptime(receipt_date, "%Y-%m-%d")

                day_diff = abs((receipt_dt - expected_dt).days)

                if day_diff == 0:
                    pass  # Same date
                elif day_diff <= 3:
                    discrepancies.append(f"Date slightly off: receipt {receipt_date}, expected {expected_date}")
                    confidence -= 5
                else:
                    # Check for month/day swap
                    if (expected_dt.day == receipt_dt.month and
                        expected_dt.month == receipt_dt.day):
                        discrepancies.append(f"Possible date inversion (DD/MM): receipt {receipt_date}, expected {expected_date}")
                        date_differs = True
                        confidence -= 15
                        suggested_corrections["expense_date"] = receipt_date
                    else:
                        discrepancies.append(f"Date mismatch: receipt {receipt_date}, expected {expected_date}")
                        date_differs = True
                        validated = False
                        confidence -= 25
                        suggested_corrections["expense_date"] = receipt_date
            except ValueError:
                discrepancies.append(f"Could not parse dates for comparison")
                confidence -= 10

    # Compare merchants
    receipt_merchant = extracted.get("merchant")

    if receipt_merchant and expected_merchant:
        merchant_match = _fuzzy_merchant_match(receipt_merchant, expected_merchant)
        if not merchant_match:
            discrepancies.append(f"Merchant: receipt '{receipt_merchant}', expected '{expected_merchant}'")
            confidence -= 10

    notes = "; ".join(discrepancies) if discrepancies else "All fields match"

    return {
        "validated": validated,
        "confidence": max(0, confidence),
        "discrepancies": discrepancies,
        "notes": notes,
        "amount_differs": amount_differs,
        "date_differs": date_differs,
        "suggested_corrections": suggested_corrections
    }


def _fuzzy_merchant_match(receipt_merchant: str, expected_merchant: str) -> bool:
    """Check if merchant names match (fuzzy)."""
    receipt_words = set(w.upper() for w in receipt_merchant.split() if len(w) >= 4)
    expected_words = set(w.upper() for w in expected_merchant.split() if len(w) >= 4)

    # Match if any significant word overlaps
    return bool(receipt_words & expected_words)
