"""
Supabase Client Utilities
=========================

HTTP-based Supabase client for database operations.
Uses httpx for direct REST API calls to avoid heavy SDK dependencies.
"""

from typing import Any, Optional
from datetime import datetime, timedelta
import json

import httpx
from aws_lambda_powertools import Logger

from .secrets import get_secret

logger = Logger()

# Cached configuration
_config: Optional[dict] = None


def _get_config() -> dict:
    """Get cached Supabase configuration."""
    global _config
    if _config is None:
        _config = {
            "url": get_secret("SUPABASE_URL"),
            "key": get_secret("SUPABASE_KEY"),
        }
        if not _config["url"] or not _config["key"]:
            raise ValueError("SUPABASE_URL and SUPABASE_KEY are required")
    return _config


def _get_headers() -> dict:
    """Get headers for Supabase REST API."""
    config = _get_config()
    return {
        "apikey": config["key"],
        "Authorization": f"Bearer {config['key']}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


def _rest_url(table: str) -> str:
    """Get REST API URL for a table."""
    config = _get_config()
    return f"{config['url']}/rest/v1/{table}"


def _storage_url(path: str) -> str:
    """Get Storage API URL."""
    config = _get_config()
    return f"{config['url']}/storage/v1/{path}"


class SupabaseClient:
    """
    High-level Supabase operations for expense processing.
    Uses httpx for direct REST API calls.
    """

    def __init__(self):
        self._client = httpx.Client(timeout=30.0, headers=_get_headers())

    def __del__(self):
        if hasattr(self, '_client'):
            self._client.close()

    def _query(self, table: str, params: dict = None) -> list[dict]:
        """Execute a SELECT query."""
        url = _rest_url(table)
        response = self._client.get(url, params=params or {})
        response.raise_for_status()
        return response.json()

    def _insert(self, table: str, data: dict) -> dict:
        """Insert a record."""
        url = _rest_url(table)
        response = self._client.post(url, json=data)
        response.raise_for_status()
        result = response.json()
        return result[0] if isinstance(result, list) and result else result

    def _update(self, table: str, data: dict, filters: dict) -> dict:
        """Update records matching filters."""
        url = _rest_url(table)
        params = {f"{k}": f"eq.{v}" for k, v in filters.items()}
        response = self._client.patch(url, json=data, params=params)
        response.raise_for_status()
        result = response.json()
        return result[0] if isinstance(result, list) and result else {}

    def _delete(self, table: str, filters: dict) -> None:
        """Delete records matching filters."""
        url = _rest_url(table)
        params = {f"{k}": f"eq.{v}" for k, v in filters.items()}
        response = self._client.delete(url, params=params)
        response.raise_for_status()

    # =========================================================================
    # EXPENSE OPERATIONS
    # =========================================================================

    def get_expense(self, expense_id: str) -> Optional[dict]:
        """Fetch a single expense by ID."""
        results = self._query("zoho_expenses", {"id": f"eq.{expense_id}"})
        return results[0] if results else None

    def get_expense_by_zoho_id(self, zoho_expense_id: str) -> Optional[dict]:
        """Fetch expense by Zoho expense ID."""
        results = self._query("zoho_expenses", {"zoho_expense_id": f"eq.{zoho_expense_id}"})
        return results[0] if results else None

    def update_expense(self, expense_id: str, data: dict) -> dict:
        """Update expense fields."""
        data["updated_at"] = datetime.utcnow().isoformat()
        return self._update("zoho_expenses", data, {"id": expense_id})

    def update_expense_status(self, expense_id: str, status: str, **kwargs) -> dict:
        """Update expense status and optional fields."""
        data = {"status": status, **kwargs}
        return self.update_expense(expense_id, data)

    def flag_expense(self, expense_id: str, flag_reason: str, match_confidence: Optional[int] = None) -> dict:
        """Mark expense as flagged for human review."""
        data = {"status": "flagged", "flag_reason": flag_reason}
        if match_confidence is not None:
            data["match_confidence"] = match_confidence
        return self.update_expense(expense_id, data)

    def create_flagged_expense(self, data: dict) -> dict:
        """Create entry in flagged_expenses table for review queue UI."""
        return self._insert("flagged_expenses", data)

    # =========================================================================
    # BANK TRANSACTION OPERATIONS
    # =========================================================================

    def get_bank_transaction(self, transaction_id: str) -> Optional[dict]:
        """Fetch a single bank transaction by ID."""
        results = self._query("bank_transactions", {"id": f"eq.{transaction_id}"})
        return results[0] if results else None

    def get_unmatched_bank_transactions(
        self,
        source: str,
        start_date: str,
        end_date: str,
        amount_min: Optional[float] = None,
        amount_max: Optional[float] = None
    ) -> list[dict]:
        """Query unmatched bank transactions within date range.

        Uses PostgREST 'and' filter for multiple conditions on transaction_date.
        """
        # Build the AND filter for date range (PostgREST format)
        # Format: and=(transaction_date.gte.start,transaction_date.lte.end)
        date_filter = f"(transaction_date.gte.{start_date},transaction_date.lte.{end_date})"

        params = {
            "status": "eq.unmatched",
            "source": f"eq.{source}",
            "and": date_filter,
            "select": "id,transaction_date,description,amount,extracted_vendor,source",
            "order": "transaction_date.asc",
        }

        results = self._query("bank_transactions", params)

        # Filter by amount in Python if specified (optional filters)
        if amount_min is not None or amount_max is not None:
            filtered = []
            for r in results:
                amt = float(r.get("amount", 0))
                if amount_min is not None and amt < amount_min:
                    continue
                if amount_max is not None and amt > amount_max:
                    continue
                filtered.append(r)
            results = filtered

        logger.info(f"Found {len(results)} unmatched bank transactions")
        return results

    def update_bank_transaction(self, transaction_id: str, data: dict) -> dict:
        """Update bank transaction fields."""
        return self._update("bank_transactions", data, {"id": transaction_id})

    # =========================================================================
    # REFERENCE DATA OPERATIONS
    # =========================================================================

    def get_qbo_account_for_category(self, category_name: str) -> Optional[dict]:
        """Get QBO account mapping for a Zoho category."""
        if not category_name:
            return None
        results = self._query("qbo_accounts", {
            "zoho_category_match": f"eq.{category_name}",
            "limit": "1"
        })
        return results[0] if results else None

    def get_qbo_class_by_state(self, state_code: str) -> Optional[dict]:
        """Get QBO class ID for a state code."""
        results = self._query("qbo_classes", {
            "state_code": f"eq.{state_code}",
            "limit": "1"
        })
        return results[0] if results else None

    def get_vendor_state_rules(self, vendor_name: str) -> Optional[dict]:
        """Get vendor-specific state rules."""
        if not vendor_name:
            return None
        # Use ilike for case-insensitive partial match
        results = self._query("vendor_rules", {
            "vendor_pattern": f"ilike.*{vendor_name}*",
            "is_active": "eq.true",
            "limit": "1"
        })
        return results[0] if results else None

    # =========================================================================
    # RECEIPT OPERATIONS
    # =========================================================================

    def get_receipt_signed_url(self, storage_path: str, expires_in: int = 3600) -> str:
        """Generate a signed URL for a receipt in Supabase Storage."""
        url = _storage_url(f"object/sign/expense-receipts/{storage_path}")
        response = self._client.post(url, json={"expiresIn": expires_in})
        if response.status_code == 200:
            data = response.json()
            config = _get_config()
            return f"{config['url']}/storage/v1{data.get('signedURL', '')}"
        return ""

    # =========================================================================
    # ORPHAN & STUCK EXPENSE OPERATIONS
    # =========================================================================

    def get_orphan_transactions(self, before_date: str, limit: int = 50) -> list[dict]:
        """Get bank transactions that have been unmatched before a date."""
        results = self._query("bank_transactions", {
            "status": "eq.unmatched",
            "transaction_date": f"lt.{before_date}",
            "order": "transaction_date.asc",
            "limit": str(limit)
        })
        logger.info(f"Found {len(results)} orphan transactions")
        return results

    def get_stuck_expenses(self, minutes_threshold: int = 10) -> list[dict]:
        """Get expenses stuck in 'processing' status."""
        cutoff_time = (datetime.utcnow() - timedelta(minutes=minutes_threshold)).isoformat()
        results = self._query("zoho_expenses", {
            "status": "eq.processing",
            "updated_at": f"lt.{cutoff_time}",
            "select": "id,zoho_expense_id,status,processing_attempts,updated_at"
        })
        logger.info(f"Found {len(results)} stuck expenses")
        return results

    # =========================================================================
    # CATEGORIZATION HISTORY
    # =========================================================================

    def get_categorization_history(self, limit: int = 50) -> list[dict]:
        """Get recent categorization history for AI context."""
        results = self._query("categorization_history", {
            "order": "created_at.desc",
            "limit": str(limit),
            "select": "vendor,category,state,confidence"
        })
        return results

    def log_categorization_history(
        self,
        vendor: str,
        description: str,
        category: str,
        state: str,
        confidence: int
    ) -> dict:
        """Log categorization for learning."""
        record = {
            "vendor": vendor,
            "description": description[:200] if description else None,
            "category": category,
            "state": state,
            "confidence": confidence,
            "created_at": datetime.utcnow().isoformat()
        }
        return self._insert("categorization_history", record)
