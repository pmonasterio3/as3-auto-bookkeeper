"""
Expense Data Model
==================

Represents a Zoho expense with all processing fields.
"""

from dataclasses import dataclass, field
from datetime import date, datetime
from enum import Enum
from typing import Optional, Any


class ExpenseStatus(str, Enum):
    """Expense processing status."""
    PENDING = "pending"
    PROCESSING = "processing"
    POSTED = "posted"
    FLAGGED = "flagged"
    ERROR = "error"
    DUPLICATE = "duplicate"


@dataclass
class Expense:
    """
    Represents a Zoho expense in the processing pipeline.

    Maps to the zoho_expenses database table.
    """

    # Primary identifiers
    id: str  # Supabase UUID
    zoho_expense_id: str
    zoho_report_id: Optional[str] = None

    # Core expense data
    expense_date: Optional[date] = None
    amount: float = 0.0
    vendor_name: Optional[str] = None
    category_name: Optional[str] = None
    description: Optional[str] = None

    # State tracking
    state_tag: Optional[str] = None  # Original Zoho tag (e.g., "California - CA")
    state: Optional[str] = None  # Extracted state code (e.g., "CA")

    # Payment info
    paid_through: Optional[str] = None  # e.g., "AMEX", "Wells Fargo Debit"

    # Receipt
    receipt_storage_path: Optional[str] = None
    receipt_content_type: Optional[str] = None

    # Processing status
    status: ExpenseStatus = ExpenseStatus.PENDING
    processing_attempts: int = 0
    flag_reason: Optional[str] = None
    last_error: Optional[str] = None

    # Match results
    bank_transaction_id: Optional[str] = None
    match_confidence: Optional[int] = None

    # QBO results
    qbo_purchase_id: Optional[str] = None

    # Monday.com results
    monday_event_id: Optional[str] = None
    monday_subitem_id: Optional[str] = None

    # Corrections (for AI learning)
    original_amount: Optional[float] = None
    original_expense_date: Optional[date] = None

    # Timestamps
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    processed_at: Optional[datetime] = None

    @classmethod
    def from_dict(cls, data: dict) -> "Expense":
        """Create Expense from database row dictionary."""
        return cls(
            id=data.get("id", ""),
            zoho_expense_id=data.get("zoho_expense_id", ""),
            zoho_report_id=data.get("zoho_report_id"),
            expense_date=cls._parse_date(data.get("expense_date")),
            amount=float(data.get("amount", 0)),
            vendor_name=data.get("vendor_name"),
            category_name=data.get("category_name"),
            description=data.get("description"),
            state_tag=data.get("state_tag"),
            state=data.get("state"),
            paid_through=data.get("paid_through"),
            receipt_storage_path=data.get("receipt_storage_path"),
            receipt_content_type=data.get("receipt_content_type"),
            status=ExpenseStatus(data.get("status", "pending")),
            processing_attempts=int(data.get("processing_attempts", 0)),
            flag_reason=data.get("flag_reason"),
            last_error=data.get("last_error"),
            bank_transaction_id=data.get("bank_transaction_id"),
            match_confidence=data.get("match_confidence"),
            qbo_purchase_id=data.get("qbo_purchase_id"),
            monday_event_id=data.get("monday_event_id"),
            monday_subitem_id=data.get("monday_subitem_id"),
            original_amount=data.get("original_amount"),
            original_expense_date=cls._parse_date(data.get("original_expense_date")),
            created_at=cls._parse_datetime(data.get("created_at")),
            updated_at=cls._parse_datetime(data.get("updated_at")),
            processed_at=cls._parse_datetime(data.get("processed_at")),
        )

    @staticmethod
    def _parse_date(value: Any) -> Optional[date]:
        """Parse date from various formats."""
        if value is None:
            return None
        if isinstance(value, date):
            return value
        if isinstance(value, str):
            try:
                return datetime.strptime(value[:10], "%Y-%m-%d").date()
            except ValueError:
                return None
        return None

    @staticmethod
    def _parse_datetime(value: Any) -> Optional[datetime]:
        """Parse datetime from various formats."""
        if value is None:
            return None
        if isinstance(value, datetime):
            return value
        if isinstance(value, str):
            try:
                # Handle ISO format with or without timezone
                return datetime.fromisoformat(value.replace("Z", "+00:00"))
            except ValueError:
                return None
        return None

    @property
    def is_cos(self) -> bool:
        """Check if this is a Cost of Sales expense."""
        if self.category_name:
            return self.category_name.endswith("- COS")
        return False

    @property
    def extracted_state(self) -> Optional[str]:
        """Extract state code from state_tag if not already extracted."""
        if self.state:
            return self.state

        if not self.state_tag:
            return None

        # Handle "Other" → NC (admin/home office)
        if self.state_tag.lower() == "other":
            return "NC"

        # Parse "California - CA" format
        if " - " in self.state_tag:
            parts = self.state_tag.split(" - ")
            if len(parts) == 2 and len(parts[1]) == 2:
                return parts[1].upper()

        # Try to match state name
        state_map = {
            "california": "CA",
            "texas": "TX",
            "colorado": "CO",
            "washington": "WA",
            "new jersey": "NJ",
            "florida": "FL",
            "montana": "MT",
            "north carolina": "NC",
        }

        tag_lower = self.state_tag.lower()
        for name, code in state_map.items():
            if name in tag_lower:
                return code

        return None

    @property
    def payment_source(self) -> str:
        """Normalize payment source to bank key."""
        if not self.paid_through:
            return "amex"  # Default

        paid_lower = self.paid_through.lower()

        if "amex" in paid_lower:
            return "amex"
        elif "wells" in paid_lower:
            return "wells_fargo"
        else:
            return "amex"

    def to_dict(self) -> dict:
        """Convert to dictionary for database operations."""
        return {
            "id": self.id,
            "zoho_expense_id": self.zoho_expense_id,
            "zoho_report_id": self.zoho_report_id,
            "expense_date": self.expense_date.isoformat() if self.expense_date else None,
            "amount": self.amount,
            "vendor_name": self.vendor_name,
            "category_name": self.category_name,
            "description": self.description,
            "state_tag": self.state_tag,
            "state": self.state,
            "paid_through": self.paid_through,
            "receipt_storage_path": self.receipt_storage_path,
            "receipt_content_type": self.receipt_content_type,
            "status": self.status.value,
            "processing_attempts": self.processing_attempts,
            "flag_reason": self.flag_reason,
            "last_error": self.last_error,
            "bank_transaction_id": self.bank_transaction_id,
            "match_confidence": self.match_confidence,
            "qbo_purchase_id": self.qbo_purchase_id,
            "monday_event_id": self.monday_event_id,
            "monday_subitem_id": self.monday_subitem_id,
            "original_amount": self.original_amount,
            "original_expense_date": self.original_expense_date.isoformat() if self.original_expense_date else None,
        }
