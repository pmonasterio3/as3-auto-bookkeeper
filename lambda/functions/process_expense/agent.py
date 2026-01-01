"""
Expense Processing AI Agent
===========================

Implements the agentic loop using Anthropic SDK with tool_use for
autonomous expense processing with self-correction capabilities.
"""

import json
import time
from datetime import datetime
from typing import Any, Callable

import anthropic
from aws_lambda_powertools import Logger

from utils.supabase_client import SupabaseClient
from utils.qbo_client import QBOClient
from utils.monday_client import MondayClient
from models import Expense, ProcessingResult, ProcessingDecision

from tools import (
    validate_receipt,
    match_bank_transaction,
    determine_state,
    lookup_qbo_expense_account,
    lookup_qbo_vendor,
    create_qbo_vendor,
    create_qbo_purchase,
    upload_receipt_to_qbo,
    create_monday_subitem,
    flag_for_review,
)
from prompts.expense_processor import build_system_prompt, build_expense_prompt
from utils.secrets import get_secret

logger = Logger()

# Anthropic client - lazily initialized
_client = None

def get_anthropic_client():
    """Get or create Anthropic client with API key from Secrets Manager."""
    global _client
    if _client is None:
        api_key = get_secret("ANTHROPIC_API_KEY")
        _client = anthropic.Anthropic(api_key=api_key)
    return _client

# Model configuration
MODEL = "claude-sonnet-4-20250514"
MAX_TOKENS = 4096
MAX_ITERATIONS = 15
CONFIDENCE_THRESHOLD = 90  # Auto-process if >= 90%


# Tool definitions for Anthropic API
EXPENSE_TOOLS = [
    {
        "name": "validate_receipt",
        "description": "Analyze receipt image using vision to validate against expense data. Returns validation result with extracted receipt details (amount, date, merchant).",
        "input_schema": {
            "type": "object",
            "properties": {
                "receipt_url": {
                    "type": "string",
                    "description": "Signed URL to the receipt image"
                },
                "expected_amount": {
                    "type": "number",
                    "description": "Expected amount from the expense"
                },
                "expected_merchant": {
                    "type": "string",
                    "description": "Expected merchant/vendor name"
                },
                "expected_date": {
                    "type": "string",
                    "description": "Expected date (YYYY-MM-DD format)"
                }
            },
            "required": ["receipt_url", "expected_amount"]
        }
    },
    {
        "name": "match_bank_transaction",
        "description": "Find a matching bank transaction for the expense. Uses amount, date, and merchant for matching. Returns the best match with confidence score.",
        "input_schema": {
            "type": "object",
            "properties": {
                "amount": {
                    "type": "number",
                    "description": "Expense amount to match"
                },
                "date": {
                    "type": "string",
                    "description": "Expense date (YYYY-MM-DD)"
                },
                "merchant_name": {
                    "type": "string",
                    "description": "Merchant/vendor name"
                },
                "source": {
                    "type": "string",
                    "enum": ["amex", "wells_fargo"],
                    "description": "Payment source to search"
                },
                "amount_tolerance": {
                    "type": "number",
                    "description": "Amount tolerance for fuzzy matching (default 0.50)"
                },
                "date_tolerance_days": {
                    "type": "integer",
                    "description": "Date tolerance in days (default 3)"
                }
            },
            "required": ["amount", "date", "source"]
        }
    },
    {
        "name": "determine_state",
        "description": "Determine the state code for the expense using the waterfall: Zoho tag -> Monday event -> Vendor rules. Returns state code and determination source.",
        "input_schema": {
            "type": "object",
            "properties": {
                "zoho_state_tag": {
                    "type": "string",
                    "description": "State tag from Zoho expense (e.g., 'California - CA')"
                },
                "expense_date": {
                    "type": "string",
                    "description": "Expense date for Monday event lookup"
                },
                "vendor_name": {
                    "type": "string",
                    "description": "Vendor name for rule-based lookup"
                },
                "is_cos": {
                    "type": "boolean",
                    "description": "Whether this is a Cost of Sales expense"
                }
            },
            "required": ["expense_date"]
        }
    },
    {
        "name": "lookup_qbo_expense_account",
        "description": "REQUIRED before create_qbo_purchase. Look up the QBO expense account ID for a Zoho category. Returns the correct account ID to use.",
        "input_schema": {
            "type": "object",
            "properties": {
                "category_name": {
                    "type": "string",
                    "description": "Zoho expense category name (e.g., 'Fuel - COS', 'Travel - Courses COS')"
                }
            },
            "required": ["category_name"]
        }
    },
    {
        "name": "lookup_qbo_vendor",
        "description": "Search for a vendor in QuickBooks Online by name. Returns vendor details if found.",
        "input_schema": {
            "type": "object",
            "properties": {
                "vendor_name": {
                    "type": "string",
                    "description": "Vendor name to search for"
                }
            },
            "required": ["vendor_name"]
        }
    },
    {
        "name": "create_qbo_vendor",
        "description": "Create a new vendor in QuickBooks Online. Use only if lookup_qbo_vendor returns no results.",
        "input_schema": {
            "type": "object",
            "properties": {
                "vendor_name": {
                    "type": "string",
                    "description": "Display name for the new vendor"
                }
            },
            "required": ["vendor_name"]
        }
    },
    {
        "name": "create_qbo_purchase",
        "description": "Create a Purchase transaction in QuickBooks Online. This is the final posting step.",
        "input_schema": {
            "type": "object",
            "properties": {
                "vendor_id": {
                    "type": "string",
                    "description": "QBO Vendor ID"
                },
                "amount": {
                    "type": "number",
                    "description": "Transaction amount"
                },
                "txn_date": {
                    "type": "string",
                    "description": "Transaction date (YYYY-MM-DD)"
                },
                "expense_account_id": {
                    "type": "string",
                    "description": "QBO expense account ID"
                },
                "state_code": {
                    "type": "string",
                    "description": "State code for class assignment (CA, TX, etc.)"
                },
                "payment_source": {
                    "type": "string",
                    "enum": ["amex", "wells_fargo"],
                    "description": "Payment method"
                },
                "memo": {
                    "type": "string",
                    "description": "Memo for the line item"
                }
            },
            "required": ["vendor_id", "amount", "txn_date", "expense_account_id", "payment_source"]
        }
    },
    {
        "name": "upload_receipt_to_qbo",
        "description": "Upload receipt image and attach to QBO Purchase. Call after create_qbo_purchase.",
        "input_schema": {
            "type": "object",
            "properties": {
                "purchase_id": {
                    "type": "string",
                    "description": "QBO Purchase ID to attach receipt to"
                },
                "receipt_url": {
                    "type": "string",
                    "description": "Signed URL to receipt image"
                },
                "filename": {
                    "type": "string",
                    "description": "Filename for the attachment"
                }
            },
            "required": ["purchase_id", "receipt_url"]
        }
    },
    {
        "name": "create_monday_subitem",
        "description": "Create expense subitem in Monday.com Course Revenue Tracker. Only for COS (Cost of Sales) expenses.",
        "input_schema": {
            "type": "object",
            "properties": {
                "expense_date": {
                    "type": "string",
                    "description": "Expense date for event lookup"
                },
                "state_code": {
                    "type": "string",
                    "description": "State code for event matching"
                },
                "item_name": {
                    "type": "string",
                    "description": "Name for the subitem"
                },
                "category": {
                    "type": "string",
                    "description": "Expense category"
                },
                "amount": {
                    "type": "number",
                    "description": "Expense amount"
                }
            },
            "required": ["expense_date", "item_name", "category", "amount"]
        }
    },
    {
        "name": "flag_for_review",
        "description": "Flag the expense for human review when confidence is low or there's ambiguity. Provide clear explanation.",
        "input_schema": {
            "type": "object",
            "properties": {
                "reason": {
                    "type": "string",
                    "description": "Clear explanation of why human review is needed"
                },
                "confidence": {
                    "type": "integer",
                    "description": "Current confidence level (0-100)"
                },
                "suggestions": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Suggestions for the human reviewer"
                }
            },
            "required": ["reason", "confidence"]
        }
    }
]


def run_expense_agent(
    expense: Expense,
    supabase: SupabaseClient,
    retry_count: int = 0
) -> ProcessingResult:
    """
    Run the AI agent to process an expense.

    The agent autonomously:
    1. Validates receipt against expense data
    2. Finds matching bank transaction
    3. Determines state (from Zoho tag, Monday event, or vendor rules)
    4. Creates QBO Purchase with receipt attachment
    5. Creates Monday subitem (if COS expense)
    6. Self-corrects on mismatches (date inversions, amount discrepancies)

    Args:
        expense: Expense to process
        supabase: Supabase client for data operations
        retry_count: Number of previous retry attempts

    Returns:
        ProcessingResult with full audit trail
    """
    result = ProcessingResult(
        expense_id=expense.id,
        zoho_expense_id=expense.zoho_expense_id,
        started_at=datetime.utcnow()
    )

    # Build tool execution context
    tool_context = ToolContext(
        expense=expense,
        supabase=supabase,
        qbo=QBOClient(),
        monday=MondayClient(),
        result=result
    )

    # Build prompts
    system_prompt = build_system_prompt()
    user_prompt = build_expense_prompt(expense, retry_count)

    messages = [{"role": "user", "content": user_prompt}]

    logger.info(f"Starting agent loop for expense {expense.id}")

    for iteration in range(MAX_ITERATIONS):
        result.iteration_count = iteration + 1
        logger.info(f"Agent iteration {iteration + 1}/{MAX_ITERATIONS}")

        try:
            # Call Claude API
            start_time = time.time()
            response = get_anthropic_client().messages.create(
                model=MODEL,
                max_tokens=MAX_TOKENS,
                system=system_prompt,
                tools=EXPENSE_TOOLS,
                messages=messages
            )
            api_duration_ms = int((time.time() - start_time) * 1000)

            logger.info(f"API response: stop_reason={response.stop_reason}, "
                       f"usage={response.usage.input_tokens}/{response.usage.output_tokens} tokens")

            # Check if agent is done
            if response.stop_reason == "end_turn":
                # Agent finished - extract final decision from response
                final_text = _extract_text_content(response)
                _parse_final_decision(result, final_text)
                logger.info(f"Agent completed: {result.decision.value}, confidence={result.confidence}")
                break

            # Process tool calls
            if response.stop_reason == "tool_use":
                tool_results = []

                for block in response.content:
                    if block.type == "tool_use":
                        tool_name = block.name
                        tool_input = block.input
                        tool_id = block.id

                        logger.info(f"Executing tool: {tool_name}")

                        # Execute the tool
                        tool_start = time.time()
                        try:
                            tool_output = execute_tool(tool_name, tool_input, tool_context)
                            tool_success = True
                            tool_error = None
                        except Exception as e:
                            logger.error(f"Tool {tool_name} failed: {e}")
                            tool_output = {"error": str(e)}
                            tool_success = False
                            tool_error = str(e)

                        tool_duration = int((time.time() - tool_start) * 1000)

                        # Record tool call
                        result.add_tool_call(
                            tool_name=tool_name,
                            input_args=tool_input,
                            output=tool_output,
                            success=tool_success,
                            error_message=tool_error,
                            duration_ms=tool_duration
                        )

                        # Format result for Claude
                        tool_results.append({
                            "type": "tool_result",
                            "tool_use_id": tool_id,
                            "content": json.dumps(tool_output) if isinstance(tool_output, dict) else str(tool_output)
                        })

                # Add assistant response and tool results to conversation
                messages.append({"role": "assistant", "content": response.content})
                messages.append({"role": "user", "content": tool_results})

            else:
                # Unexpected stop reason
                logger.warning(f"Unexpected stop_reason: {response.stop_reason}")
                result.error_message = f"Unexpected stop: {response.stop_reason}"
                break

        except anthropic.APIError as e:
            logger.error(f"Anthropic API error: {e}")
            result.error_message = f"API error: {str(e)}"
            result.decision = ProcessingDecision.FLAGGED
            result.flag_reason = "api_error"
            break

    # Max iterations reached
    if result.iteration_count >= MAX_ITERATIONS and not result.success:
        logger.warning(f"Max iterations ({MAX_ITERATIONS}) reached")
        result.decision = ProcessingDecision.FLAGGED
        result.flag_reason = "max_iterations_exceeded"
        result.error_message = "Processing exceeded maximum iterations"

    result.completed_at = datetime.utcnow()
    return result


class ToolContext:
    """Context passed to tool functions."""

    def __init__(
        self,
        expense: Expense,
        supabase: SupabaseClient,
        qbo: QBOClient,
        monday: MondayClient,
        result: ProcessingResult
    ):
        self.expense = expense
        self.supabase = supabase
        self.qbo = qbo
        self.monday = monday
        self.result = result


def execute_tool(tool_name: str, tool_input: dict, context: ToolContext) -> dict:
    """Execute a tool by name with given input."""
    tools_map: dict[str, Callable] = {
        "validate_receipt": lambda inp: validate_receipt(inp, context),
        "match_bank_transaction": lambda inp: match_bank_transaction(inp, context),
        "determine_state": lambda inp: determine_state(inp, context),
        "lookup_qbo_expense_account": lambda inp: lookup_qbo_expense_account(inp, context),
        "lookup_qbo_vendor": lambda inp: lookup_qbo_vendor(inp, context),
        "create_qbo_vendor": lambda inp: create_qbo_vendor(inp, context),
        "create_qbo_purchase": lambda inp: create_qbo_purchase(inp, context),
        "upload_receipt_to_qbo": lambda inp: upload_receipt_to_qbo(inp, context),
        "create_monday_subitem": lambda inp: create_monday_subitem(inp, context),
        "flag_for_review": lambda inp: flag_for_review(inp, context),
    }

    if tool_name not in tools_map:
        raise ValueError(f"Unknown tool: {tool_name}")

    return tools_map[tool_name](tool_input)


def _extract_text_content(response) -> str:
    """Extract text content from Claude response."""
    for block in response.content:
        if hasattr(block, "text"):
            return block.text
    return ""


def _parse_final_decision(result: ProcessingResult, final_text: str) -> None:
    """Parse agent's final decision from response text."""
    lower_text = final_text.lower()

    # Check for explicit success indicators
    if "successfully posted" in lower_text or "qbo purchase created" in lower_text:
        result.success = True
        result.decision = ProcessingDecision.AUTO_POST
        if result.confidence == 0:
            result.confidence = 95

    # Check for review flags
    elif "flag" in lower_text and "review" in lower_text:
        result.success = False
        result.decision = ProcessingDecision.NEEDS_REVIEW

    # Check for errors
    elif "error" in lower_text or "failed" in lower_text:
        result.success = False
        result.decision = ProcessingDecision.FLAGGED

    # Default based on whether QBO purchase was created
    elif result.qbo_purchase_id:
        result.success = True
        result.decision = ProcessingDecision.AUTO_POST
        if result.confidence == 0:
            result.confidence = 90

    else:
        result.success = False
        result.decision = ProcessingDecision.NEEDS_REVIEW

    result.ai_reasoning = final_text[:1000] if final_text else None
