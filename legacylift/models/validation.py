"""
models/validation.py — Pipeline validation and human-approval data models.

These models are the glue between pipeline stages:
  - ValidationResult: every layer's pass/fail report stored in one place
  - ApprovalDecision: what comes back from the human when they review a chunk

Pipeline position:
  ValidationResult is created by each layer and collected in pipeline.py.
  ApprovalDecision is created by api/main.py when POST /approve or /reject hits.
"""

from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Enumerations
# ---------------------------------------------------------------------------

class ApprovalAction(str, Enum):
    """What action a human took on a migration chunk."""
    APPROVE = "approve"  # Chunk is good, continue pipeline
    REJECT  = "reject"   # Chunk needs rework, regenerate


# ---------------------------------------------------------------------------
# ValidationResult
# ---------------------------------------------------------------------------

class ValidationResult(BaseModel):
    """
    The pass/fail report produced by each layer of the pipeline.

    Every stage in core/pipeline.py wraps its layer call in a try/except and
    stores the outcome as a ValidationResult, so the full pipeline history is
    inspectable even if things went wrong midway.

    Example usage (in pipeline.py):
        result = ValidationResult(layer="Layer1", passed=True, issues=[])
        chunk.static_analysis = static_result
    """

    layer: str
    """
    Which pipeline layer produced this result.
    Use consistent names: 'Layer0', 'Layer0.5', 'Layer1', 'Layer2', 'Layer3',
    'Layer4', 'Ownership'
    """

    passed: bool
    """True if the layer's checks all passed, False if any hard check failed."""

    issues: list[str] = Field(default_factory=list)
    """
    Human-readable list of problems found, e.g.:
      ['CRITICAL: Integer division loses fractional cents at line 14',
       'WARNING: Variable "bal" shadows outer scope']
    """

    retries: int = 0
    """
    Number of LLM retries this layer consumed before producing this result.
    Max retries configured via LLM_MAX_RETRIES in .env.
    If retries == LLM_MAX_RETRIES and passed is False, the pipeline emits
    an error event and may halt (depending on the layer's criticality).
    """

    duration_ms: float = 0.0
    """Wall-clock time this layer took to run in milliseconds."""

    metadata: dict = Field(default_factory=dict)
    """
    Any extra structured data the layer wants to attach for debugging.
    e.g. {'model_used': 'gpt-4o', 'tokens_used': 1420}
    """


# ---------------------------------------------------------------------------
# ApprovalDecision
# ---------------------------------------------------------------------------

class ApprovalDecision(BaseModel):
    """
    The human reviewer's decision on a migration chunk.

    Created by api/main.py when the frontend calls:
      POST /api/project/{id}/approve/{chunk_id}
      POST /api/project/{id}/reject/{chunk_id}

    Stored in pipeline.py's pending_approvals dict and consumed by
    run_migration() to unblock the pipeline.
    """

    chunk_id: str
    """ID of the MigrationChunk being decided on."""

    action: ApprovalAction
    """Approve or reject."""

    reviewer_comment: Optional[str] = None
    """
    Optional free-text note from the reviewer.
    If action is REJECT, this should explain what needs to be fixed.
    Passed back to the LLM as context on the next regeneration attempt.
    """

    reviewer_id: Optional[str] = None
    """
    Optional user ID / email of the reviewer for audit trail.
    TODO (api/main.py): extract from JWT or session when auth is added.
    """

    class Config:
        use_enum_values = True
