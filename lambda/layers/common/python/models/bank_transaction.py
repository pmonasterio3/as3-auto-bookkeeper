"""
Bank Transaction Data Model
===========================

Represents a bank transaction (source of truth).
"""

from dataclasses import dataclass
from datetime import date, datetime
from enum import Enum
from typing import Optional, Any


class BankTransactionStatus(str, Enum):
    """Bank transaction status."""
    UNMATCHED = "unmatched"
    MATCHED = "matched"
    EXCLUDED = "excluded"
    ORPHAN_PROCESSED = "orphan_processed"
    PENDING_REVIEW = "pending_review"


@dataclass
class BankTransaction:
    """
    Represents a bank transaction.

    Bank transactions are the source of truth for all financial activity.
    Maps to the bank_transactions database table.
    """

    # Primary identifier
    id: str

    # Core transaction data
    transaction_date: date
    description: str
    amount: float
    source: str  # amex, wells_fargo

    # Extracted/normalized data
    description_normalized: Optional[str] = None
    extracted_vendor: Optional[str] = None

    # Status and matching
    status: BankTransactionStatus = BankTransactionStatus.UNMATCHED
    matched_expense_id: Optional[str] = None
    matched_by: Optional[str] = None  # "agent" or "human"
    matched_at: Optional[datetime] = None
    match_confidence: Optional[int] = None

    # QBO posting
    qbo_purchase_id: Optional[str] = None

    # Orphan processing
    orphan_category: Optional[str] = None
    orphan_state: Optional[str] = None
    orphan_determination_method: Optional[str] = None
    orphan_processed_at: Optional[datetime] = None

    # Monday.com
    monday_subitem_id: Optional[str] = None

    # Import metadata
    import_batch_id: Optional[str] = None
    created_at: Optional[datetime] = None

    @classmethod
    def from_dict(cls, data: dict) -> "BankTransaction":
        """Create BankTransaction from database row dictionary."""
        return cls(
            id=data.get("id", ""),
            transaction_date=cls._parse_date(data.get("transaction_date")),
            description=data.get("description", ""),
            amount=float(data.get("amount", 0)),
            source=data.get("source", ""),
            description_normalized=data.get("description_normalized"),
            extracted_vendor=data.get("extracted_vendor"),
            status=BankTransactionStatus(data.get("status", "unmatched")),
            matched_expense_id=data.get("matched_expense_id"),
            matched_by=data.get("matched_by"),
            matched_at=cls._parse_datetime(data.get("matched_at")),
            match_confidence=data.get("match_confidence"),
            qbo_purchase_id=data.get("qbo_purchase_id"),
            orphan_category=data.get("orphan_category"),
            orphan_state=data.get("orphan_state"),
            orphan_determination_method=data.get("orphan_determination_method"),
            orphan_processed_at=cls._parse_datetime(data.get("orphan_processed_at")),
            monday_subitem_id=data.get("monday_subitem_id"),
            import_batch_id=data.get("import_batch_id"),
            created_at=cls._parse_datetime(data.get("created_at")),
        )

    @staticmethod
    def _parse_date(value: Any) -> date:
        """Parse date from various formats."""
        if value is None:
            return date.today()
        if isinstance(value, date):
            return value
        if isinstance(value, str):
            try:
                return datetime.strptime(value[:10], "%Y-%m-%d").date()
            except ValueError:
                return date.today()
        return date.today()

    @staticmethod
    def _parse_datetime(value: Any) -> Optional[datetime]:
        """Parse datetime from various formats."""
        if value is None:
            return None
        if isinstance(value, datetime):
            return value
        if isinstance(value, str):
            try:
                return datetime.fromisoformat(value.replace("Z", "+00:00"))
            except ValueError:
                return None
        return None

    def matches_expense(
        self,
        expense_amount: float,
        expense_date: date,
        merchant_name: Optional[str] = None,
        amount_tolerance: float = 0.50,
        date_tolerance_days: int = 3
    ) -> tuple[bool, int, str]:
        """
        Check if this transaction matches an expense.

        Args:
            expense_amount: Expense amount
            expense_date: Expense date
            merchant_name: Optional merchant name for matching
            amount_tolerance: Amount matching tolerance
            date_tolerance_days: Date matching tolerance in days

        Returns:
            Tuple of (is_match, confidence_score, match_type)
        """
        # Check amount match
        amount_diff = abs(self.amount - expense_amount)
        amount_matches = amount_diff <= amount_tolerance

        # Check date match
        date_diff = abs((self.transaction_date - expense_date).days)
        date_matches = date_diff <= date_tolerance_days

        # Check merchant match (word-based)
        merchant_matches = False
        if merchant_name and self.description:
            merchant_matches = self._merchant_matches(merchant_name)

        # Determine match type and confidence
        if amount_matches and date_matches and merchant_matches:
            return True, 100, "exact"
        elif amount_matches and date_matches:
            return True, 95, "amount_date_match"
        elif amount_matches and merchant_matches:
            return True, 90, "amount_merchant_match"
        elif amount_matches:
            return True, 70, "amount_only_match"

        # Check for restaurant with tip (18-25% over expense amount)
        tip_ratio = self.amount / expense_amount if expense_amount > 0 else 0
        if 1.18 <= tip_ratio <= 1.25 and date_matches:
            return True, 75, "restaurant_with_tip"

        return False, 0, "no_match"

    def _merchant_matches(self, merchant_name: str) -> bool:
        """Check if merchant name matches description using word matching."""
        if not merchant_name or not self.description:
            return False

        # Extract significant words (4+ chars)
        merchant_words = [
            w.upper() for w in merchant_name.split()
            if len(w) >= 4
        ]

        description_upper = self.description.upper()

        # Check if any significant word appears in description
        for word in merchant_words:
            if word in description_upper:
                return True

        return False

    def to_dict(self) -> dict:
        """Convert to dictionary for database operations."""
        return {
            "id": self.id,
            "transaction_date": self.transaction_date.isoformat(),
            "description": self.description,
            "amount": self.amount,
            "source": self.source,
            "description_normalized": self.description_normalized,
            "extracted_vendor": self.extracted_vendor,
            "status": self.status.value,
            "matched_expense_id": self.matched_expense_id,
            "matched_by": self.matched_by,
            "match_confidence": self.match_confidence,
            "qbo_purchase_id": self.qbo_purchase_id,
        }
