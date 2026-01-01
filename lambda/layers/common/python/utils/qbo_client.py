"""
QuickBooks Online API Client
============================

Handles all QBO API operations including vendor lookup/creation,
Purchase creation, and receipt attachment.
"""

import os
import re
from typing import Optional, Any
from datetime import datetime

import httpx
from aws_lambda_powertools import Logger

from .token_manager import get_qbo_access_token

logger = Logger()

# QBO API configuration
QBO_BASE_URL = "https://quickbooks.api.intuit.com/v3"
QBO_COMPANY_ID = os.environ.get("QBO_COMPANY_ID", "123146088634019")
QBO_MINOR_VERSION = 65

# Payment account IDs (from CLAUDE.md)
PAYMENT_ACCOUNTS = {
    "amex": 99,
    "wells_fargo": 49,
}

# State to QBO Class ID mapping (from CLAUDE.md)
STATE_CLASS_IDS = {
    "CA": "1000000004",
    "TX": "1000000006",
    "CO": "1000000007",
    "WA": "1000000008",
    "NJ": "1000000009",
    "FL": "1000000010",
    "MT": "1000000011",
    "NC": "1000000012",
}


class QBOClient:
    """
    QuickBooks Online API client with automatic token management.

    Handles:
    - Vendor lookup and creation
    - Purchase transaction creation
    - Receipt attachment upload
    """

    def __init__(self, company_id: Optional[str] = None):
        self.company_id = company_id or QBO_COMPANY_ID
        self.base_url = f"{QBO_BASE_URL}/company/{self.company_id}"

    def _get_headers(self) -> dict:
        """Get headers with current access token."""
        access_token = get_qbo_access_token()
        return {
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        }

    def _make_request(
        self,
        method: str,
        endpoint: str,
        data: Optional[dict] = None,
        params: Optional[dict] = None
    ) -> dict:
        """
        Make an API request to QBO.

        Handles token refresh on 401 errors.
        """
        url = f"{self.base_url}/{endpoint}"

        # Add minor version to params
        params = params or {}
        params["minorversion"] = QBO_MINOR_VERSION

        with httpx.Client(timeout=60.0) as client:
            # First attempt
            response = client.request(
                method=method,
                url=url,
                headers=self._get_headers(),
                json=data,
                params=params
            )

            # Handle token expiry
            if response.status_code == 401:
                logger.info("Received 401, refreshing token and retrying...")
                get_qbo_access_token(force_refresh=True)

                response = client.request(
                    method=method,
                    url=url,
                    headers=self._get_headers(),
                    json=data,
                    params=params
                )

            if response.status_code not in (200, 201):
                logger.error(f"QBO API error: {response.status_code} - {response.text}")
                raise QBOAPIError(
                    f"QBO API returned {response.status_code}",
                    status_code=response.status_code,
                    response_body=response.text
                )

            return response.json()

    # =========================================================================
    # VENDOR OPERATIONS
    # =========================================================================

    def lookup_vendor(self, vendor_name: str) -> Optional[dict]:
        """
        Search for a vendor by name.

        Uses LIKE query for fuzzy matching.
        Handles special characters (apostrophes) in vendor names.

        Args:
            vendor_name: Vendor display name to search

        Returns:
            Vendor dict if found, None otherwise
        """
        # Escape special characters for QBO query
        safe_name = self._escape_vendor_name(vendor_name)

        query = f"SELECT * FROM Vendor WHERE DisplayName LIKE '%{safe_name}%'"

        try:
            result = self._make_request(
                method="GET",
                endpoint="query",
                params={"query": query}
            )

            vendors = result.get("QueryResponse", {}).get("Vendor", [])

            if vendors:
                logger.info(f"Found vendor: {vendors[0].get('DisplayName')}")
                return vendors[0]

            logger.info(f"No vendor found for: {vendor_name}")
            return None

        except QBOAPIError as e:
            logger.error(f"Vendor lookup failed: {e}")
            return None

    def create_vendor(self, vendor_name: str) -> dict:
        """
        Create a new vendor in QBO.

        Args:
            vendor_name: Display name for the vendor

        Returns:
            Created vendor data
        """
        # Clean vendor name
        clean_name = vendor_name.strip()[:100]  # QBO limit is 100 chars

        data = {
            "DisplayName": clean_name,
            "CompanyName": clean_name,
            "Active": True
        }

        try:
            result = self._make_request(
                method="POST",
                endpoint="vendor",
                data=data
            )

            vendor = result.get("Vendor", {})
            logger.info(f"Created vendor: {vendor.get('DisplayName')} (ID: {vendor.get('Id')})")
            return vendor

        except QBOAPIError as e:
            # Check for "Duplicate Name Exists" error
            if "Duplicate Name Exists" in str(e.response_body) or "6240" in str(e.response_body):
                # Extract vendor ID from error: "Id=1248"
                import re
                id_match = re.search(r'Id=(\d+)', e.response_body)
                if id_match:
                    vendor_id = id_match.group(1)
                    logger.info(f"Vendor already exists, fetching by ID: {vendor_id}")
                    return self.get_vendor_by_id(vendor_id)
            raise

    def get_vendor_by_id(self, vendor_id: str) -> dict:
        """
        Get vendor by ID.

        Args:
            vendor_id: QBO Vendor ID

        Returns:
            Vendor data
        """
        result = self._make_request(
            method="GET",
            endpoint=f"vendor/{vendor_id}"
        )
        return result.get("Vendor", {})

    def get_or_create_vendor(self, vendor_name: str) -> dict:
        """
        Get existing vendor or create a new one.

        Args:
            vendor_name: Vendor display name

        Returns:
            Vendor data (existing or newly created)
        """
        vendor = self.lookup_vendor(vendor_name)

        if vendor:
            return vendor

        return self.create_vendor(vendor_name)

    def _escape_vendor_name(self, name: str) -> str:
        """
        Escape special characters for QBO query.

        Handles ASCII and Unicode quote variants that appear in vendor names
        like "Peet's", "Love's", "Buc-ee's", etc.
        """
        if not name:
            return name

        # Unicode quote variants that appear in vendor names
        # All of these get escaped to double single quotes for SQL
        quote_chars = [
            "'",   # ASCII apostrophe (U+0027) - most common
            "'",   # Right single quotation mark (U+2019)
            "'",   # Left single quotation mark (U+2018)
            "`",   # Grave accent (U+0060)
            "´",   # Acute accent (U+00B4)
        ]

        result = name
        for char in quote_chars:
            result = result.replace(char, "''")

        return result

    # =========================================================================
    # PURCHASE OPERATIONS
    # =========================================================================

    def create_purchase(
        self,
        vendor_id: str,
        amount: float,
        txn_date: str,
        expense_account_id: str,
        payment_account_id: str,
        payment_type: str,
        class_id: Optional[str] = None,
        memo: Optional[str] = None,
        private_note: Optional[str] = None
    ) -> dict:
        """
        Create a Purchase transaction in QBO.

        Args:
            vendor_id: QBO Vendor ID
            amount: Transaction amount
            txn_date: Transaction date (YYYY-MM-DD)
            expense_account_id: Expense account ID for line item
            payment_account_id: Payment account ID (AMEX or Wells Fargo)
            payment_type: "CreditCard" or "Check"
            class_id: Optional QBO Class ID for state tracking
            memo: Optional memo for the line item
            private_note: Optional private note (visible in QBO)

        Returns:
            Created Purchase data including Id
        """
        # Build line item
        line_item = {
            "DetailType": "AccountBasedExpenseLineDetail",
            "Amount": amount,
            "AccountBasedExpenseLineDetail": {
                "AccountRef": {"value": expense_account_id}
            }
        }

        # Add class if provided (for state tracking)
        if class_id:
            line_item["AccountBasedExpenseLineDetail"]["ClassRef"] = {"value": class_id}

        # Add memo if provided
        if memo:
            line_item["Description"] = memo

        # Build purchase data
        data = {
            "PaymentType": payment_type,
            "AccountRef": {"value": payment_account_id},
            "EntityRef": {"value": vendor_id, "type": "Vendor"},
            "TxnDate": txn_date,
            "Line": [line_item],
            "TotalAmt": amount,
        }

        # Add private note if provided
        if private_note:
            data["PrivateNote"] = private_note

        import json
        logger.info(f"QBO Purchase request payload: {json.dumps(data, indent=2)}")

        result = self._make_request(
            method="POST",
            endpoint="purchase",
            data=data
        )

        purchase = result.get("Purchase", {})
        purchase_id = purchase.get("Id")
        logger.info(f"Created QBO Purchase: {purchase_id} for ${amount}")

        return purchase

    # =========================================================================
    # ATTACHMENT OPERATIONS
    # =========================================================================

    def upload_receipt(
        self,
        purchase_id: str,
        receipt_content: bytes,
        filename: str,
        content_type: str = "image/jpeg"
    ) -> dict:
        """
        Upload a receipt and attach to a Purchase.

        Uses multipart/form-data as required by QBO API.

        Args:
            purchase_id: QBO Purchase ID to attach to
            receipt_content: Receipt file content as bytes
            filename: Original filename
            content_type: MIME type (default image/jpeg)

        Returns:
            Attachable response data
        """
        url = f"{self.base_url}/upload?minorversion={QBO_MINOR_VERSION}"

        # Prepare metadata
        metadata = {
            "AttachableRef": [{
                "EntityRef": {
                    "type": "Purchase",
                    "value": purchase_id
                }
            }],
            "FileName": filename,
            "ContentType": content_type
        }

        # Build multipart form
        files = {
            "file_metadata_01": (None, str(metadata).replace("'", '"'), "application/json"),
            "file_content_01": (filename, receipt_content, content_type)
        }

        access_token = get_qbo_access_token()
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/json",
        }

        with httpx.Client(timeout=120.0) as client:
            response = client.post(url, headers=headers, files=files)

            if response.status_code not in (200, 201):
                logger.error(f"Receipt upload failed: {response.status_code} - {response.text}")
                raise QBOAPIError(
                    f"Receipt upload failed: {response.status_code}",
                    status_code=response.status_code,
                    response_body=response.text
                )

            result = response.json()
            attachable = result.get("AttachableResponse", [{}])[0].get("Attachable", {})
            logger.info(f"Uploaded receipt as Attachable: {attachable.get('Id')}")

            return attachable

    # =========================================================================
    # HELPER METHODS
    # =========================================================================

    @staticmethod
    def get_payment_account_id(source: str) -> str:
        """
        Get payment account ID from bank source.

        Args:
            source: Bank source (amex, wells_fargo)

        Returns:
            QBO account ID as string
        """
        source_lower = source.lower().replace(" ", "_")

        if "amex" in source_lower:
            return str(PAYMENT_ACCOUNTS["amex"])
        elif "wells" in source_lower:
            return str(PAYMENT_ACCOUNTS["wells_fargo"])
        else:
            logger.warning(f"Unknown payment source: {source}, defaulting to AMEX")
            return str(PAYMENT_ACCOUNTS["amex"])

    @staticmethod
    def get_payment_type(source: str) -> str:
        """
        Get payment type from bank source.

        Args:
            source: Bank source

        Returns:
            "CreditCard" or "Check"
        """
        source_lower = source.lower()

        if "amex" in source_lower or "credit" in source_lower:
            return "CreditCard"
        else:
            return "Check"

    @staticmethod
    def get_class_id(state_code: str) -> Optional[str]:
        """
        Get QBO Class ID for state tracking.

        Args:
            state_code: Two-letter state code (CA, TX, etc.)

        Returns:
            QBO Class ID or None if not found
        """
        return STATE_CLASS_IDS.get(state_code.upper())


class QBOAPIError(Exception):
    """Raised when QBO API returns an error."""

    def __init__(self, message: str, status_code: int = 0, response_body: str = ""):
        super().__init__(message)
        self.status_code = status_code
        self.response_body = response_body
