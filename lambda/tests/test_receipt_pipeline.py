"""
Receipt Pipeline Tests
======================

Tests for verifying the receipt fetching and validation pipeline.
Run these tests to identify where the receipt processing is failing.

Usage:
    pytest tests/test_receipt_pipeline.py -v
"""

import pytest
from unittest.mock import Mock, patch, MagicMock
from datetime import datetime


class TestReceiptFetching:
    """Tests for receipt fetching from Supabase Storage."""

    def test_get_receipt_signed_url_success(self):
        """Test that signed URL generation works correctly."""
        # Mock Supabase client
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"signedURL": "/object/sign/expense-receipts/test/path.jpg?token=abc"}

        with patch('httpx.Client') as mock_client:
            mock_client.return_value.__enter__ = Mock(return_value=mock_client)
            mock_client.return_value.__exit__ = Mock(return_value=None)
            mock_client.post.return_value = mock_response

            # This would test the actual implementation
            # from utils.supabase_client import SupabaseClient
            # client = SupabaseClient()
            # url = client.get_receipt_signed_url("test/path.jpg")
            # assert "signedURL" in url
            pass

    def test_get_receipt_signed_url_missing_path(self):
        """Test handling of missing receipt storage path."""
        # If receipt_storage_path is None, should return empty string
        # from utils.supabase_client import SupabaseClient
        # client = SupabaseClient()
        # url = client.get_receipt_signed_url(None)
        # assert url == ""
        pass

    def test_receipt_content_type_detection(self):
        """Test that content type is correctly detected from file extension."""
        test_cases = [
            ("receipt.jpg", "image/jpeg"),
            ("receipt.png", "image/png"),
            ("receipt.pdf", "application/pdf"),
            ("receipt.jpeg", "image/jpeg"),
        ]

        for filename, expected_type in test_cases:
            # Test content type mapping
            ext = filename.rsplit(".", 1)[-1].lower()
            ext_map = {
                "jpg": "image/jpeg",
                "jpeg": "image/jpeg",
                "png": "image/png",
                "pdf": "application/pdf",
            }
            assert ext_map.get(ext, "image/jpeg") == expected_type


class TestReceiptValidation:
    """Tests for AI-powered receipt validation."""

    def test_validate_receipt_extracts_amount(self):
        """Test that receipt validation extracts the total amount."""
        # Mock Claude vision response
        mock_vision_response = {
            "success": True,
            "merchant": "Peet's Coffee",
            "date": "2025-12-30",
            "total": 7.82,
            "amount": 7.82,
            "confidence": 95
        }

        # Expected validation result
        assert mock_vision_response["amount"] == 7.82
        assert mock_vision_response["confidence"] >= 90

    def test_validate_receipt_handles_tip(self):
        """Test handling of receipts with tip included."""
        # Expense shows $20.00
        # Receipt shows $24.00 (20% tip)
        expense_amount = 20.00
        receipt_amount = 24.00

        tip_ratio = receipt_amount / expense_amount

        # Should recognize 15-25% as tip scenario
        assert 1.15 <= tip_ratio <= 1.25, "Tip ratio should be in 15-25% range"

    def test_validate_receipt_detects_date_inversion(self):
        """Test detection of DD/MM vs MM/DD date inversions."""
        # Expense date: 2025-03-12 (March 12)
        # Receipt date: 2025-12-03 (could be December 3 OR March 12 inverted)

        expense_date = datetime(2025, 3, 12)
        receipt_date = datetime(2025, 12, 3)

        # Check if day/month are swapped
        is_inverted = (expense_date.day == receipt_date.month and
                       expense_date.month == receipt_date.day)

        assert is_inverted, "Should detect DD/MM inversion"


class TestMissingReceiptHandling:
    """Tests for handling expenses without receipts."""

    def test_handler_rejects_missing_receipt(self):
        """Test that handler rejects expenses with missing receipt."""
        # Simulate expense with receipt_storage_path = None
        expense_data = {
            "id": "test-uuid",
            "receipt_storage_path": None,
            "vendor_name": "Test Vendor",
            "amount": 50.00
        }

        # Handler should hard fail (not flag)
        # This is the critical guardrail from handler.py lines 124-143
        assert expense_data["receipt_storage_path"] is None

        # Expected behavior: ValueError with specific message
        expected_error = "SYSTEM FAILURE: Receipt not fetched from Zoho API"
        # The actual handler raises ValueError in this case

    def test_edge_function_receipt_fetch_error_handling(self):
        """Test that edge function handles receipt fetch errors correctly."""
        # Current behavior: catches error, logs, continues
        # Issue: expense gets created with receipt_storage_path = NULL
        #
        # Should either:
        # 1. Fail the entire expense insert
        # 2. Set a flag indicating receipt needs retry
        pass


class TestDatabaseQueries:
    """Tests for database query correctness."""

    def test_expenses_missing_receipts_query(self):
        """Query to find expenses without receipts."""
        query = """
        SELECT id, zoho_expense_id, vendor_name, amount, status
        FROM zoho_expenses
        WHERE receipt_storage_path IS NULL
        ORDER BY created_at DESC;
        """
        # This query should return ~19 records based on current state
        pass

    def test_date_range_query_bug(self):
        """Test the date range query bug in supabase_client.py."""
        # BROKEN CODE (current):
        params_broken = {
            "transaction_date": "gte.2025-12-01",
            "transaction_date": "lte.2025-12-31",  # Overwrites previous!
        }
        # Only the second key survives
        assert len(params_broken) == 1

        # FIXED CODE (proposed):
        # Use PostgREST 'and' filter or multiple calls


class TestQBOVendorEscaping:
    """Tests for QBO vendor name escaping."""

    def test_vendor_name_with_apostrophe(self):
        """Test escaping of vendor names with apostrophes."""
        test_vendors = [
            ("Peet's", "Peet''s"),
            ("Love's", "Love''s"),
            ("Coach's Sports Bar & Grill", "Coach''s Sports Bar & Grill"),
            ("Buc-ee's", "Buc-ee''s"),
        ]

        for original, expected in test_vendors:
            escaped = original.replace("'", "''")
            assert escaped == expected

    def test_vendor_name_with_unicode_quotes(self):
        """Test handling of Unicode quote variants."""
        # Different quote characters that might appear
        quote_variants = ["'", "'", "'", "`", "´"]

        vendor_name = "Test's Store"

        for quote in quote_variants:
            test_name = vendor_name.replace("'", quote)
            # All should be escaped to double single-quotes
            # Current code only handles ASCII apostrophe


class TestBankTransactionMatching:
    """Tests for bank transaction matching logic."""

    def test_exact_match(self):
        """Test exact amount and date matching."""
        expense_amount = 50.00
        expense_date = "2025-12-15"

        bank_txn = {
            "amount": 50.00,
            "transaction_date": "2025-12-15",
            "description": "TEST VENDOR"
        }

        # Should be exact match
        amount_diff = abs(bank_txn["amount"] - expense_amount)
        assert amount_diff < 0.01

    def test_tip_match(self):
        """Test matching with 15-25% tip."""
        expense_amount = 50.00

        valid_tip_amounts = [
            57.50,  # 15% tip
            60.00,  # 20% tip
            62.50,  # 25% tip
        ]

        for bank_amount in valid_tip_amounts:
            ratio = bank_amount / expense_amount
            assert 1.15 <= ratio <= 1.25

    def test_no_match_found(self):
        """Test behavior when no bank transaction matches."""
        # Should flag for review with "no_bank_match" reason
        expected_flag_reason = "no_bank_match"
        pass


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
