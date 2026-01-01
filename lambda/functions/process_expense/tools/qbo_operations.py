"""
QuickBooks Online Operations Tools
==================================

Vendor lookup/creation, Purchase creation, and receipt attachment.
"""

from typing import Any

import httpx
from aws_lambda_powertools import Logger

from utils.qbo_client import QBOClient

logger = Logger()


def lookup_qbo_expense_account(input_args: dict, context: Any) -> dict:
    """
    Look up the QBO expense account ID for a Zoho category.

    Uses the qbo_accounts table to map Zoho categories to QBO account IDs.
    This is REQUIRED before calling create_qbo_purchase.

    Args:
        input_args: Tool input with category_name
        context: ToolContext with Supabase client

    Returns:
        QBO account ID and details
    """
    category_name = input_args.get("category_name")

    if not category_name:
        return {"success": False, "error": "Missing category_name"}

    logger.info(f"Looking up QBO expense account for category: {category_name}")

    try:
        account = context.supabase.get_qbo_account_for_category(category_name)

        if account:
            qbo_id = account.get("qbo_id")
            account_name = account.get("name")

            logger.info(f"Found QBO account: {account_name} (ID: {qbo_id})")

            return {
                "success": True,
                "found": True,
                "account": {
                    "qbo_id": qbo_id,
                    "name": account_name,
                    "account_type": account.get("account_type"),
                    "is_cogs": account.get("is_cogs", False)
                }
            }

        # No exact match - return default and flag
        logger.warning(f"No QBO account found for category: {category_name}")
        return {
            "success": True,
            "found": False,
            "message": f"No QBO account mapped for category '{category_name}'. Use 'Ask My Accountant' (ID: 20) as fallback.",
            "fallback_account": {
                "qbo_id": "20",
                "name": "Ask My Accountant"
            }
        }

    except Exception as e:
        logger.error(f"QBO account lookup error: {e}")
        return {"success": False, "error": str(e)}


def lookup_qbo_vendor(input_args: dict, context: Any) -> dict:
    """
    Search for a vendor in QuickBooks Online.

    Args:
        input_args: Tool input with vendor_name
        context: ToolContext with QBO client

    Returns:
        Vendor details if found, or not_found status
    """
    vendor_name = input_args.get("vendor_name")

    if not vendor_name:
        return {"success": False, "error": "Missing vendor_name"}

    logger.info(f"Looking up QBO vendor: {vendor_name}")

    try:
        vendor = context.qbo.lookup_vendor(vendor_name)

        if vendor:
            vendor_id = vendor.get("Id")
            display_name = vendor.get("DisplayName")

            context.result.qbo_vendor_id = vendor_id
            context.result.qbo_vendor_name = display_name
            context.result.qbo_vendor_created = False

            return {
                "success": True,
                "found": True,
                "vendor": {
                    "id": vendor_id,
                    "display_name": display_name,
                    "company_name": vendor.get("CompanyName"),
                    "active": vendor.get("Active", True)
                }
            }

        return {
            "success": True,
            "found": False,
            "message": f"No vendor found matching '{vendor_name}'"
        }

    except Exception as e:
        logger.error(f"QBO vendor lookup error: {e}")
        return {"success": False, "error": str(e)}


def create_qbo_vendor(input_args: dict, context: Any) -> dict:
    """
    Create a new vendor in QuickBooks Online.

    Args:
        input_args: Tool input with vendor_name
        context: ToolContext with QBO client

    Returns:
        Created vendor details
    """
    vendor_name = input_args.get("vendor_name")

    if not vendor_name:
        return {"success": False, "error": "Missing vendor_name"}

    logger.info(f"Creating QBO vendor: {vendor_name}")

    try:
        vendor = context.qbo.create_vendor(vendor_name)

        vendor_id = vendor.get("Id")
        display_name = vendor.get("DisplayName")

        context.result.qbo_vendor_id = vendor_id
        context.result.qbo_vendor_name = display_name
        context.result.qbo_vendor_created = True

        return {
            "success": True,
            "created": True,
            "vendor": {
                "id": vendor_id,
                "display_name": display_name
            }
        }

    except Exception as e:
        logger.error(f"QBO vendor creation error: {e}")
        return {"success": False, "error": str(e)}


def create_qbo_purchase(input_args: dict, context: Any) -> dict:
    """
    Create a Purchase transaction in QuickBooks Online.

    This is the final posting step that records the expense in QBO.

    Args:
        input_args: Tool input with vendor_id, amount, date, accounts, etc.
        context: ToolContext with QBO client

    Returns:
        Created purchase details
    """
    vendor_id = input_args.get("vendor_id")
    amount = input_args.get("amount")
    txn_date = input_args.get("txn_date")
    expense_account_id = input_args.get("expense_account_id")
    state_code = input_args.get("state_code")
    payment_source = input_args.get("payment_source", "amex")
    memo = input_args.get("memo")

    # Validate required fields
    if not all([vendor_id, amount, txn_date, expense_account_id]):
        missing = []
        if not vendor_id:
            missing.append("vendor_id")
        if not amount:
            missing.append("amount")
        if not txn_date:
            missing.append("txn_date")
        if not expense_account_id:
            missing.append("expense_account_id")
        return {"success": False, "error": f"Missing required fields: {', '.join(missing)}"}

    logger.info(f"Creating QBO Purchase: ${amount} for vendor {vendor_id}")

    try:
        # Get payment account and type from source
        payment_account_id = QBOClient.get_payment_account_id(payment_source)
        payment_type = QBOClient.get_payment_type(payment_source)

        # Get class ID for state tracking
        class_id = None
        if state_code:
            class_id = QBOClient.get_class_id(state_code)

        # Build memo with Zoho reference
        full_memo = memo or ""
        if context.expense.zoho_expense_id:
            if full_memo:
                full_memo += " | "
            full_memo += f"Zoho: {context.expense.zoho_expense_id}"

        # Create the purchase
        purchase = context.qbo.create_purchase(
            vendor_id=vendor_id,
            amount=amount,
            txn_date=txn_date,
            expense_account_id=expense_account_id,
            payment_account_id=payment_account_id,
            payment_type=payment_type,
            class_id=class_id,
            memo=full_memo,
            private_note=f"Auto-posted by AS3 Bookkeeper Agent"
        )

        purchase_id = purchase.get("Id")
        context.result.qbo_purchase_id = purchase_id

        logger.info(f"Created QBO Purchase: {purchase_id}")

        return {
            "success": True,
            "purchase": {
                "id": purchase_id,
                "total_amount": purchase.get("TotalAmt"),
                "txn_date": purchase.get("TxnDate"),
                "payment_type": purchase.get("PaymentType")
            }
        }

    except Exception as e:
        logger.error(f"QBO purchase creation error: {e}")
        return {"success": False, "error": str(e)}


def upload_receipt_to_qbo(input_args: dict, context: Any) -> dict:
    """
    Upload receipt and attach to QBO Purchase.

    Args:
        input_args: Tool input with purchase_id, receipt_url, filename
        context: ToolContext with QBO client

    Returns:
        Attachment result
    """
    purchase_id = input_args.get("purchase_id")
    receipt_url = input_args.get("receipt_url")
    filename = input_args.get("filename", "receipt.jpg")

    if not purchase_id or not receipt_url:
        return {"success": False, "error": "Missing purchase_id or receipt_url"}

    logger.info(f"Uploading receipt to QBO Purchase {purchase_id}")

    try:
        # Fetch receipt image
        with httpx.Client(timeout=30.0) as client:
            response = client.get(receipt_url)
            response.raise_for_status()
            receipt_content = response.content
            content_type = response.headers.get("content-type", "image/jpeg")

        # Determine filename extension
        if "png" in content_type.lower():
            if not filename.endswith(".png"):
                filename = filename.rsplit(".", 1)[0] + ".png"
        elif "pdf" in content_type.lower():
            if not filename.endswith(".pdf"):
                filename = filename.rsplit(".", 1)[0] + ".pdf"
        else:
            if not filename.endswith((".jpg", ".jpeg")):
                filename = filename.rsplit(".", 1)[0] + ".jpg"

        # Upload to QBO
        attachable = context.qbo.upload_receipt(
            purchase_id=purchase_id,
            receipt_content=receipt_content,
            filename=filename,
            content_type=content_type
        )

        attachable_id = attachable.get("Id")
        context.result.qbo_attachable_id = attachable_id

        logger.info(f"Attached receipt as Attachable {attachable_id}")

        return {
            "success": True,
            "attachable": {
                "id": attachable_id,
                "filename": attachable.get("FileName"),
                "size": attachable.get("Size")
            }
        }

    except httpx.HTTPError as e:
        logger.error(f"Failed to fetch receipt: {e}")
        return {"success": False, "error": f"Failed to fetch receipt: {e}"}

    except Exception as e:
        logger.error(f"QBO receipt upload error: {e}")
        return {"success": False, "error": str(e)}
