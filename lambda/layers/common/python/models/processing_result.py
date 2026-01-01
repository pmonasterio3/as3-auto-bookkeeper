"""
Processing Result Data Model
============================

Represents the result of expense processing by the AI agent.
"""

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Optional, Any


class ProcessingDecision(str, Enum):
    """AI processing decision types."""
    AUTO_POST = "auto_post"  # High confidence, auto-process
    NEEDS_REVIEW = "needs_review"  # Low confidence, human review
    FLAGGED = "flagged"  # Error or validation failure
    DUPLICATE = "duplicate"  # Duplicate expense detected
    NO_MATCH = "no_match"  # No bank transaction match found
    CORRECTED = "corrected"  # Self-corrected and reprocessed


@dataclass
class ToolCall:
    """Record of a single tool invocation."""
    tool_name: str
    input_args: dict
    output: Any
    success: bool
    error_message: Optional[str] = None
    duration_ms: Optional[int] = None
    timestamp: Optional[datetime] = None


@dataclass
class Correction:
    """Record of a self-correction made by the AI."""
    field_name: str
    original_value: Any
    corrected_value: Any
    reason: str
    confidence: int
    source: str  # "receipt", "bank_transaction", "pattern_match"


@dataclass
class ProcessingResult:
    """
    Complete result of AI expense processing.

    Captures all decisions, corrections, and tool calls for
    auditing and learning purposes.
    """

    # Core result
    success: bool = False
    decision: ProcessingDecision = ProcessingDecision.NEEDS_REVIEW
    confidence: int = 0

    # Expense identification
    expense_id: Optional[str] = None
    zoho_expense_id: Optional[str] = None

    # Bank transaction match
    bank_transaction_id: Optional[str] = None
    match_confidence: Optional[int] = None
    match_type: Optional[str] = None  # "exact", "amount_date_match", etc.

    # State determination
    determined_state: Optional[str] = None
    state_source: Optional[str] = None  # "zoho_tag", "monday_event", "vendor_rule"
    monday_event_id: Optional[str] = None

    # QBO results
    qbo_vendor_id: Optional[str] = None
    qbo_vendor_name: Optional[str] = None
    qbo_vendor_created: bool = False
    qbo_purchase_id: Optional[str] = None
    qbo_attachable_id: Optional[str] = None

    # Monday.com results
    monday_subitem_id: Optional[str] = None

    # Receipt validation
    receipt_validated: bool = False
    receipt_amount: Optional[float] = None
    receipt_date: Optional[str] = None
    receipt_merchant: Optional[str] = None
    receipt_validation_notes: Optional[str] = None

    # Self-corrections made
    corrections: list[Correction] = field(default_factory=list)

    # Tool call history
    tool_calls: list[ToolCall] = field(default_factory=list)

    # Error handling
    error_message: Optional[str] = None
    error_code: Optional[str] = None
    flag_reason: Optional[str] = None

    # AI reasoning
    ai_reasoning: Optional[str] = None
    iteration_count: int = 0

    # Timing
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    duration_ms: Optional[int] = None

    def add_tool_call(
        self,
        tool_name: str,
        input_args: dict,
        output: Any,
        success: bool,
        error_message: Optional[str] = None,
        duration_ms: Optional[int] = None
    ) -> None:
        """Record a tool call."""
        self.tool_calls.append(ToolCall(
            tool_name=tool_name,
            input_args=input_args,
            output=output,
            success=success,
            error_message=error_message,
            duration_ms=duration_ms,
            timestamp=datetime.utcnow()
        ))

    def add_correction(
        self,
        field_name: str,
        original_value: Any,
        corrected_value: Any,
        reason: str,
        confidence: int,
        source: str
    ) -> None:
        """Record a self-correction."""
        self.corrections.append(Correction(
            field_name=field_name,
            original_value=original_value,
            corrected_value=corrected_value,
            reason=reason,
            confidence=confidence,
            source=source
        ))

    @property
    def was_corrected(self) -> bool:
        """Check if any corrections were made."""
        return len(self.corrections) > 0

    @property
    def tool_call_count(self) -> int:
        """Get total number of tool calls."""
        return len(self.tool_calls)

    @property
    def failed_tool_calls(self) -> list[ToolCall]:
        """Get list of failed tool calls."""
        return [tc for tc in self.tool_calls if not tc.success]

    def to_dict(self) -> dict:
        """Convert to dictionary for database storage."""
        return {
            "success": self.success,
            "decision": self.decision.value,
            "confidence": self.confidence,
            "expense_id": self.expense_id,
            "bank_transaction_id": self.bank_transaction_id,
            "match_confidence": self.match_confidence,
            "match_type": self.match_type,
            "determined_state": self.determined_state,
            "state_source": self.state_source,
            "monday_event_id": self.monday_event_id,
            "qbo_vendor_id": self.qbo_vendor_id,
            "qbo_vendor_name": self.qbo_vendor_name,
            "qbo_vendor_created": self.qbo_vendor_created,
            "qbo_purchase_id": self.qbo_purchase_id,
            "qbo_attachable_id": self.qbo_attachable_id,
            "monday_subitem_id": self.monday_subitem_id,
            "receipt_validated": self.receipt_validated,
            "receipt_amount": self.receipt_amount,
            "receipt_date": self.receipt_date,
            "receipt_merchant": self.receipt_merchant,
            "corrections": [
                {
                    "field": c.field_name,
                    "original": c.original_value,
                    "corrected": c.corrected_value,
                    "reason": c.reason,
                    "confidence": c.confidence,
                    "source": c.source
                }
                for c in self.corrections
            ],
            "tool_call_count": self.tool_call_count,
            "iteration_count": self.iteration_count,
            "error_message": self.error_message,
            "flag_reason": self.flag_reason,
            "ai_reasoning": self.ai_reasoning,
            "duration_ms": self.duration_ms,
        }

    def to_summary(self) -> str:
        """Generate human-readable summary."""
        lines = [
            f"Processing Result: {self.decision.value}",
            f"Success: {self.success}",
            f"Confidence: {self.confidence}%",
        ]

        if self.bank_transaction_id:
            lines.append(f"Bank Match: {self.bank_transaction_id} ({self.match_type})")

        if self.determined_state:
            lines.append(f"State: {self.determined_state} (from {self.state_source})")

        if self.qbo_purchase_id:
            lines.append(f"QBO Purchase: {self.qbo_purchase_id}")

        if self.corrections:
            lines.append(f"Corrections Made: {len(self.corrections)}")
            for c in self.corrections:
                lines.append(f"  - {c.field_name}: {c.original_value} -> {c.corrected_value}")

        if self.error_message:
            lines.append(f"Error: {self.error_message}")

        if self.flag_reason:
            lines.append(f"Flag Reason: {self.flag_reason}")

        lines.append(f"Tool Calls: {self.tool_call_count} ({len(self.failed_tool_calls)} failed)")
        lines.append(f"Iterations: {self.iteration_count}")

        return "\n".join(lines)
