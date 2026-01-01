"""
Monday.com API Client
=====================

Handles Monday.com GraphQL API operations for course event
lookups and subitem creation.
"""

import os
from typing import Optional, Any
from datetime import datetime, timedelta

import httpx
from aws_lambda_powertools import Logger

from .secrets import get_secret

logger = Logger()

# Monday.com API configuration
MONDAY_API_URL = "https://api.monday.com/v2"

# Board IDs (from CLAUDE.md)
TRAINING_CALENDAR_BOARD = "8294758830"
COURSE_REVENUE_TRACKER_BOARD = "18381611621"
SUBITEMS_BOARD = "18381637294"

# Subitem column IDs
SUBITEM_COLUMNS = {
    "concept": "text_mkxs8ntt",
    "status": "status",
    "date": "date0",
    "amount": "numeric_mkxs13eg",
}


class MondayClient:
    """
    Monday.com GraphQL API client.

    Handles:
    - Training Calendar event queries
    - Revenue Tracker item lookups
    - Subitem creation for expense tracking
    """

    def __init__(self):
        self.api_key = get_secret("MONDAY_API_KEY")
        if not self.api_key:
            logger.warning("MONDAY_API_KEY not configured")

    def _get_headers(self) -> dict:
        """Get headers with API key."""
        return {
            "Authorization": self.api_key,
            "Content-Type": "application/json",
            "API-Version": "2024-10"
        }

    def _execute_query(self, query: str, variables: Optional[dict] = None) -> dict:
        """
        Execute a GraphQL query against Monday.com.

        Args:
            query: GraphQL query string
            variables: Optional query variables

        Returns:
            Response data

        Raises:
            MondayAPIError: If query fails
        """
        payload = {"query": query}
        if variables:
            payload["variables"] = variables

        with httpx.Client(timeout=30.0) as client:
            response = client.post(
                MONDAY_API_URL,
                headers=self._get_headers(),
                json=payload
            )

            if response.status_code != 200:
                logger.error(f"Monday.com API error: {response.status_code} - {response.text}")
                raise MondayAPIError(
                    f"Monday.com API returned {response.status_code}",
                    status_code=response.status_code,
                    response_body=response.text
                )

            result = response.json()

            if "errors" in result:
                error_msg = result["errors"][0].get("message", "Unknown error")
                logger.error(f"Monday.com GraphQL error: {error_msg}")
                raise MondayAPIError(f"GraphQL error: {error_msg}")

            return result.get("data", {})

    # =========================================================================
    # TRAINING CALENDAR QUERIES
    # =========================================================================

    def get_events_in_date_range(
        self,
        start_date: str,
        end_date: str,
        board_id: str = TRAINING_CALENDAR_BOARD
    ) -> list[dict]:
        """
        Query Training Calendar for events in date range.

        Args:
            start_date: Start date (YYYY-MM-DD)
            end_date: End date (YYYY-MM-DD)
            board_id: Board ID to query

        Returns:
            List of matching events with venue/state info
        """
        query = """
        query GetEvents($boardId: ID!, $startDate: CompareValue!, $endDate: CompareValue!) {
            boards(ids: [$boardId]) {
                items_page(
                    query_params: {
                        rules: [
                            {column_id: "date", compare_value: $startDate, operator: greater_than_or_equals}
                            {column_id: "date", compare_value: $endDate, operator: lower_than_or_equal}
                        ]
                    }
                ) {
                    items {
                        id
                        name
                        column_values {
                            id
                            value
                            text
                        }
                    }
                }
            }
        }
        """

        variables = {
            "boardId": board_id,
            "startDate": start_date,
            "endDate": end_date
        }

        try:
            data = self._execute_query(query, variables)
            boards = data.get("boards", [])

            if not boards:
                return []

            items = boards[0].get("items_page", {}).get("items", [])
            logger.info(f"Found {len(items)} Monday events in date range")

            return self._parse_events(items)

        except MondayAPIError as e:
            logger.error(f"Failed to query events: {e}")
            return []

    def get_event_for_expense(
        self,
        expense_date: str,
        state_code: Optional[str] = None,
        buffer_days: int = 2
    ) -> Optional[dict]:
        """
        Find a Monday event that matches an expense date.

        Args:
            expense_date: Expense date (YYYY-MM-DD)
            state_code: Optional state code to prefer matching events
            buffer_days: Days buffer around expense date

        Returns:
            Best matching event or None
        """
        # Calculate date range with buffer
        date_obj = datetime.strptime(expense_date, "%Y-%m-%d")
        start_date = (date_obj - timedelta(days=buffer_days)).strftime("%Y-%m-%d")
        end_date = (date_obj + timedelta(days=buffer_days)).strftime("%Y-%m-%d")

        events = self.get_events_in_date_range(start_date, end_date)

        if not events:
            return None

        # If we have a state code, prefer events in that state
        if state_code:
            for event in events:
                if event.get("state") == state_code:
                    logger.info(f"Found matching event in {state_code}: {event.get('name')}")
                    return event

        # Otherwise return the first event
        logger.info(f"Using first event: {events[0].get('name')}")
        return events[0]

    def _parse_events(self, items: list[dict]) -> list[dict]:
        """Parse Monday items into event dictionaries."""
        events = []

        for item in items:
            event = {
                "id": item.get("id"),
                "name": item.get("name"),
                "venue": None,
                "state": None,
                "start_date": None,
                "end_date": None,
            }

            for col in item.get("column_values", []):
                col_id = col.get("id", "")
                text = col.get("text", "")
                value = col.get("value", "")

                # Extract venue and state
                if "venue" in col_id.lower() or "location" in col_id.lower():
                    event["venue"] = text
                    # Try to extract state from venue
                    event["state"] = self._extract_state_from_venue(text)

                # Extract dates
                if col_id == "date" and value:
                    try:
                        import json
                        date_data = json.loads(value)
                        event["start_date"] = date_data.get("date")
                        event["end_date"] = date_data.get("end_date", date_data.get("date"))
                    except:
                        pass

            events.append(event)

        return events

    def _extract_state_from_venue(self, venue: str) -> Optional[str]:
        """Extract state code from venue string."""
        if not venue:
            return None

        venue_upper = venue.upper()

        # State abbreviation patterns
        state_patterns = {
            "CA": ["CALIFORNIA", " CA ", " CA,", "LAGUNA", "BUTTONWILLOW", "THUNDERHILL"],
            "TX": ["TEXAS", " TX ", " TX,", "HARRIS HILL", "CRESSON", "DRIVEWAY"],
            "CO": ["COLORADO", " CO ", " CO,", "HIGH PLAINS", "PUEBLO"],
            "WA": ["WASHINGTON", " WA ", " WA,", "PACIFIC", "RIDGE"],
            "NJ": ["NEW JERSEY", " NJ ", " NJ,", "NJMP", "THUNDERBOLT"],
            "FL": ["FLORIDA", " FL ", " FL,", "SEBRING", "HOMESTEAD"],
            "MT": ["MONTANA", " MT ", " MT,"],
        }

        for state, patterns in state_patterns.items():
            for pattern in patterns:
                if pattern in venue_upper:
                    return state

        return None

    # =========================================================================
    # REVENUE TRACKER OPERATIONS
    # =========================================================================

    def get_revenue_item_for_event(self, event_id: str) -> Optional[dict]:
        """
        Find Revenue Tracker item linked to a Training Calendar event.

        Args:
            event_id: Training Calendar event ID

        Returns:
            Revenue Tracker item or None
        """
        query = """
        query GetRevenueItem($boardId: ID!) {
            boards(ids: [$boardId]) {
                items_page(limit: 500) {
                    items {
                        id
                        name
                        column_values {
                            id
                            value
                            text
                        }
                    }
                }
            }
        }
        """

        variables = {"boardId": COURSE_REVENUE_TRACKER_BOARD}

        try:
            data = self._execute_query(query, variables)
            boards = data.get("boards", [])

            if not boards:
                return None

            items = boards[0].get("items_page", {}).get("items", [])

            # Find item linked to the event
            for item in items:
                for col in item.get("column_values", []):
                    # Check for board relation column linking to Training Calendar
                    if col.get("value") and event_id in str(col.get("value")):
                        logger.info(f"Found revenue item: {item.get('name')}")
                        return {
                            "id": item.get("id"),
                            "name": item.get("name")
                        }

            logger.info(f"No revenue item found for event {event_id}")
            return None

        except MondayAPIError as e:
            logger.error(f"Failed to query revenue item: {e}")
            return None

    # =========================================================================
    # SUBITEM OPERATIONS
    # =========================================================================

    def create_expense_subitem(
        self,
        parent_item_id: str,
        item_name: str,
        concept: str,
        date: str,
        amount: float
    ) -> Optional[str]:
        """
        Create a subitem under a Revenue Tracker item.

        Args:
            parent_item_id: Parent item ID in Revenue Tracker
            item_name: Name for the subitem
            concept: Expense concept/category
            date: Expense date (YYYY-MM-DD)
            amount: Expense amount

        Returns:
            Created subitem ID or None
        """
        import json

        # Build column values
        column_values = {
            SUBITEM_COLUMNS["concept"]: concept,
            SUBITEM_COLUMNS["status"]: {"label": "Paid"},
            SUBITEM_COLUMNS["date"]: {"date": date},
            SUBITEM_COLUMNS["amount"]: str(amount),
        }

        query = """
        mutation CreateSubitem($parentItemId: ID!, $itemName: String!, $columnValues: JSON!) {
            create_subitem(
                parent_item_id: $parentItemId
                item_name: $itemName
                column_values: $columnValues
            ) {
                id
                name
            }
        }
        """

        variables = {
            "parentItemId": parent_item_id,
            "itemName": item_name,
            "columnValues": json.dumps(column_values)
        }

        try:
            data = self._execute_query(query, variables)
            subitem = data.get("create_subitem", {})

            if subitem:
                subitem_id = subitem.get("id")
                logger.info(f"Created Monday subitem: {subitem_id}")
                return subitem_id

            return None

        except MondayAPIError as e:
            logger.error(f"Failed to create subitem: {e}")
            return None


class MondayAPIError(Exception):
    """Raised when Monday.com API returns an error."""

    def __init__(self, message: str, status_code: int = 0, response_body: str = ""):
        super().__init__(message)
        self.status_code = status_code
        self.response_body = response_body
