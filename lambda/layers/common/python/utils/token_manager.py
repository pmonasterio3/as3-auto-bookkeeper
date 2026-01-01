"""
QBO OAuth Token Manager
=======================

Thread-safe QBO token management using DynamoDB with optimistic locking.
Prevents race conditions when multiple Lambda functions try to refresh tokens.
"""

import os
import time
from typing import Optional
from datetime import datetime

import boto3
import httpx
from botocore.exceptions import ClientError
from aws_lambda_powertools import Logger

from .secrets import get_secret

logger = Logger()

# DynamoDB table name (from environment)
TOKENS_TABLE = os.environ.get("TOKENS_TABLE", "as3-qbo-tokens-prod")

# QBO OAuth endpoints
QBO_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer"

# Token buffer (refresh 5 minutes before expiry)
TOKEN_BUFFER_SECONDS = 300


class TokenManager:
    """
    Manages QBO OAuth tokens with DynamoDB-based locking.

    Uses optimistic locking with version numbers to prevent race conditions
    when multiple Lambda functions attempt to refresh the token simultaneously.
    """

    def __init__(self, table_name: Optional[str] = None):
        self.dynamodb = boto3.resource("dynamodb")
        self.table = self.dynamodb.Table(table_name or TOKENS_TABLE)
        self._cached_token: Optional[dict] = None

    def get_access_token(self, force_refresh: bool = False) -> str:
        """
        Get a valid QBO access token, refreshing if necessary.

        Uses optimistic locking to prevent race conditions.

        Args:
            force_refresh: Force token refresh even if not expired

        Returns:
            Valid access token string

        Raises:
            TokenRefreshError: If token refresh fails
        """
        # Try to get cached token first
        token_data = self._get_token_from_dynamodb()

        if token_data is None:
            # No token exists - initialize from secrets
            return self._initialize_tokens()

        # Check if token is still valid
        expires_at = token_data.get("access_token_expires_at", 0)
        current_time = int(time.time())

        if not force_refresh and expires_at > current_time + TOKEN_BUFFER_SECONDS:
            # Token is valid
            logger.debug("Using cached access token (still valid)")
            return token_data["access_token"]

        # Token needs refresh
        logger.info("Access token expired or expiring soon, refreshing...")
        return self._refresh_token(token_data)

    def _get_token_from_dynamodb(self) -> Optional[dict]:
        """Retrieve token data from DynamoDB."""
        try:
            response = self.table.get_item(Key={"pk": "QBO_TOKEN"})
            return response.get("Item")
        except ClientError as e:
            logger.error(f"Error reading from DynamoDB: {e}")
            raise

    def _initialize_tokens(self) -> str:
        """
        Initialize tokens from Secrets Manager.

        Called when no token exists in DynamoDB (first run).
        """
        logger.info("Initializing QBO tokens from Secrets Manager")

        refresh_token = get_secret("QBO_REFRESH_TOKEN")
        if not refresh_token:
            raise TokenRefreshError("QBO_REFRESH_TOKEN not found in secrets")

        # Use the refresh token to get initial access token
        new_tokens = self._call_qbo_token_endpoint(refresh_token)

        # Store in DynamoDB
        self._store_tokens(new_tokens, version=0)

        return new_tokens["access_token"]

    def _refresh_token(self, current_token_data: dict) -> str:
        """
        Refresh the access token with optimistic locking.

        Args:
            current_token_data: Current token data from DynamoDB

        Returns:
            New access token

        Raises:
            TokenRefreshError: If refresh fails
        """
        current_version = current_token_data.get("version", 0)
        refresh_token = current_token_data.get("refresh_token")

        if not refresh_token:
            raise TokenRefreshError("No refresh token available")

        try:
            # Call QBO to refresh
            new_tokens = self._call_qbo_token_endpoint(refresh_token)

            # Try to update with optimistic locking
            self._store_tokens(new_tokens, version=current_version)

            logger.info("Successfully refreshed QBO access token")
            return new_tokens["access_token"]

        except ClientError as e:
            error_code = e.response.get("Error", {}).get("Code", "")

            if error_code == "ConditionalCheckFailedException":
                # Another Lambda already refreshed - get the new token
                logger.info("Token was refreshed by another instance, fetching updated token")
                time.sleep(0.5)  # Brief delay to allow write to complete
                return self.get_access_token(force_refresh=False)

            logger.error(f"Failed to refresh token: {e}")
            raise TokenRefreshError(f"Token refresh failed: {e}")

    def _call_qbo_token_endpoint(self, refresh_token: str) -> dict:
        """
        Call QBO OAuth endpoint to refresh tokens.

        Args:
            refresh_token: Current refresh token

        Returns:
            Dictionary with new access_token, refresh_token, expires_in
        """
        client_id = get_secret("QBO_CLIENT_ID")
        client_secret = get_secret("QBO_CLIENT_SECRET")

        if not client_id or not client_secret:
            raise TokenRefreshError("QBO OAuth credentials not configured")

        headers = {
            "Accept": "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
        }

        data = {
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
        }

        with httpx.Client() as client:
            response = client.post(
                QBO_TOKEN_URL,
                headers=headers,
                data=data,
                auth=(client_id, client_secret),
                timeout=30.0
            )

        if response.status_code != 200:
            logger.error(f"QBO token refresh failed: {response.status_code} - {response.text}")
            raise TokenRefreshError(f"QBO API returned {response.status_code}")

        result = response.json()

        return {
            "access_token": result["access_token"],
            "refresh_token": result["refresh_token"],  # CRITICAL: Always save new refresh token
            "expires_in": result.get("expires_in", 3600),
        }

    def _store_tokens(self, tokens: dict, version: int) -> None:
        """
        Store tokens in DynamoDB with optimistic locking.

        Args:
            tokens: Token data from QBO
            version: Current version for optimistic locking
        """
        current_time = int(time.time())
        expires_at = current_time + tokens.get("expires_in", 3600)

        # Calculate refresh token expiry (101 days from now)
        refresh_expires_at = current_time + (101 * 24 * 60 * 60)

        item = {
            "pk": "QBO_TOKEN",
            "access_token": tokens["access_token"],
            "refresh_token": tokens["refresh_token"],
            "access_token_expires_at": expires_at,
            "refresh_token_expires_at": refresh_expires_at,
            "version": version + 1,
            "updated_at": datetime.utcnow().isoformat(),
        }

        try:
            if version == 0:
                # First time - no condition needed
                self.table.put_item(Item=item)
            else:
                # Use conditional update for optimistic locking
                self.table.put_item(
                    Item=item,
                    ConditionExpression="attribute_not_exists(pk) OR version = :v",
                    ExpressionAttributeValues={":v": version}
                )

            logger.info(f"Stored tokens with version {version + 1}")

        except ClientError as e:
            error_code = e.response.get("Error", {}).get("Code", "")
            if error_code == "ConditionalCheckFailedException":
                # This is expected in race conditions - propagate for retry
                raise
            logger.error(f"Failed to store tokens: {e}")
            raise TokenRefreshError(f"Failed to store tokens: {e}")


class TokenRefreshError(Exception):
    """Raised when token refresh fails."""
    pass


# Singleton instance for convenience
_token_manager: Optional[TokenManager] = None


def get_qbo_access_token(force_refresh: bool = False) -> str:
    """
    Convenience function to get QBO access token.

    Uses a singleton TokenManager instance.
    """
    global _token_manager

    if _token_manager is None:
        _token_manager = TokenManager()

    return _token_manager.get_access_token(force_refresh=force_refresh)
