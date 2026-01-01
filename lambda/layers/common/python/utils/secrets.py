"""
AWS Secrets Manager Utilities
=============================

Cached secret retrieval to minimize API calls and latency.
Secrets are cached in Lambda memory between invocations.
"""

import json
import os
from typing import Any
from functools import lru_cache

import boto3
from botocore.exceptions import ClientError
from aws_lambda_powertools import Logger

logger = Logger()

# Secret names in AWS Secrets Manager
SECRET_NAME = "as3-bookkeeper-secrets"

# Cached secrets client
_secrets_client = None


def _get_secrets_client():
    """Get or create cached Secrets Manager client."""
    global _secrets_client
    if _secrets_client is None:
        _secrets_client = boto3.client("secretsmanager")
    return _secrets_client


@lru_cache(maxsize=1)
def get_all_secrets() -> dict[str, Any]:
    """
    Retrieve all secrets from AWS Secrets Manager.

    Cached using lru_cache to avoid repeated API calls within
    the same Lambda execution context.

    Returns:
        Dictionary containing all secrets

    Raises:
        ClientError: If secret retrieval fails
    """
    client = _get_secrets_client()

    try:
        response = client.get_secret_value(SecretId=SECRET_NAME)
        secrets = json.loads(response["SecretString"])
        logger.info("Successfully retrieved secrets from Secrets Manager")
        return secrets
    except ClientError as e:
        error_code = e.response.get("Error", {}).get("Code", "Unknown")
        logger.error(f"Failed to retrieve secrets: {error_code}")
        raise


def get_secret(key: str, default: Any = None) -> Any:
    """
    Get a specific secret value by key.

    Args:
        key: Secret key name
        default: Default value if key not found

    Returns:
        Secret value or default
    """
    secrets = get_all_secrets()
    return secrets.get(key, default)


def clear_secrets_cache():
    """
    Clear the secrets cache.

    Call this if you need to force a refresh of secrets
    (e.g., after updating them in Secrets Manager).
    """
    get_all_secrets.cache_clear()
    logger.info("Secrets cache cleared")


# Expected secret keys (for documentation and validation)
EXPECTED_SECRETS = {
    "SUPABASE_URL": "Supabase project URL",
    "SUPABASE_SERVICE_KEY": "Supabase service role key (full access)",
    "ANTHROPIC_API_KEY": "Anthropic Claude API key",
    "QBO_CLIENT_ID": "QuickBooks OAuth client ID",
    "QBO_CLIENT_SECRET": "QuickBooks OAuth client secret",
    "QBO_REFRESH_TOKEN": "QuickBooks refresh token (stored in DynamoDB)",
    "MONDAY_API_KEY": "Monday.com API token",
    "TEAMS_WEBHOOK_URL": "Microsoft Teams webhook URL for notifications",
}


def validate_secrets() -> list[str]:
    """
    Validate that all expected secrets are present.

    Returns:
        List of missing secret keys (empty if all present)
    """
    secrets = get_all_secrets()
    missing = []

    for key in EXPECTED_SECRETS:
        if key not in secrets or not secrets[key]:
            missing.append(key)

    if missing:
        logger.warning(f"Missing secrets: {missing}")
    else:
        logger.info("All expected secrets are present")

    return missing
