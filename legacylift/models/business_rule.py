"""
models/business_rule.py — Business rule and ownership data models.

A BusinessRule is the central artifact of Layer 0. The AI reads the legacy
source, identifies discrete business decisions embedded in the code (interest
tiers, regulatory thresholds, penalty logic, etc.) and creates one
BusinessRule per finding.

These rules serve two purposes:
  1. Human review — a domain expert confirms whether the rule is correct
     before migration proceeds.
  2. Ownership classification — Simonra's classifier assigns each confirmed
     rule to a functional group so the right people are notified.

Pipeline position:
  Created by core/layer0/business_extractor.py
  Consumed by ownership/classifier.py
  Surfaced via GET /api/project/{id}/rules
"""

from __future__ import annotations

import uuid
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Enumerations
# ---------------------------------------------------------------------------

class RuleConfidence(str, Enum):
    """How confident the LLM was when extracting this rule."""
    HIGH   = "High"
    MEDIUM = "Medium"
    LOW    = "Low"


class RuleStatus(str, Enum):
    """Human review status of a business rule."""
    PENDING   = "Pending"    # Extracted, awaiting human review
    CONFIRMED = "Confirmed"  # Domain expert validated it
    EDITED    = "Edited"     # Domain expert corrected the description
    FLAGGED   = "Flagged"    # Suspicious — needs deeper investigation


class OwnershipCategory(str, Enum):
    """Functional group that owns this business rule."""
    FINANCE          = "Finance"
    COMPLIANCE       = "Compliance"
    LEGAL            = "Legal"
    RISK             = "Risk"
    PRODUCT          = "Product"
    OPERATIONS       = "Operations"
    ENGINEERING      = "Engineering"
    DATA_ANALYTICS   = "Data/Analytics"
    CUSTOMER_SUPPORT = "Customer Support"
    SECURITY         = "Security"
    OPS              = "Ops"          # legacy alias — prefer OPERATIONS for new code
    UNKNOWN          = "Unknown"


class OwnershipConfidence(str, Enum):
    HIGH   = "High"
    MEDIUM = "Medium"
    LOW    = "Low"


# ---------------------------------------------------------------------------
# OwnershipResult
# ---------------------------------------------------------------------------

class OwnershipResult(BaseModel):
    """
    Output of ownership/classifier.py for a single BusinessRule.

    Populated by Simonra's classify_rule_ownership() function.
    Stored back onto the BusinessRule after classification.
    """

    primary_owner: OwnershipCategory = OwnershipCategory.UNKNOWN
    """Main functional group responsible for this rule."""

    secondary_owners: list[OwnershipCategory] = Field(default_factory=list)
    """Other groups that have a stake (e.g. Finance rule also touches Risk)."""

    confidence: OwnershipConfidence = OwnershipConfidence.LOW
    """How confident the classifier is in the assignment."""

    evidence: str = ""
    """Human-readable reasoning, e.g. 'Rule involves monetary thresholds'."""

    actual_person: Optional[str] = None
    """
    If a specific person was found in git log or docs, their name/email.
    e.g. 'jane.doe@bank.com (last touched 2023-11-14)'
    """

    class Config:
        use_enum_values = True


# ---------------------------------------------------------------------------
# BusinessRule
# ---------------------------------------------------------------------------

class BusinessRule(BaseModel):
    """
    A single discrete business decision extracted from legacy source code.

    Examples:
      - "Interest rate is 2.5% for balances under $10,000"
      - "Penalty fee is $35 if payment is more than 5 days late"
      - "End-of-day batch runs between 23:00 and 23:59 AEST"

    The rule is linked back to the exact source lines so a developer or
    domain expert can verify it against the original code.
    """

    id: str = Field(default_factory=lambda: f"BR-{uuid.uuid4().hex[:6].upper()}")
    """
    Human-readable unique identifier.
    TODO (business_extractor.py): generate sequential IDs like BR-001, BR-002
    so they are easy to reference in meetings and documentation.
    """

    title: str
    """Short one-line summary, e.g. 'Tier-1 Interest Rate Threshold'."""

    description: str
    """
    Full plain-English description of what this rule does.
    Written by the LLM but should be verifiable by a domain expert who has
    never seen the source code.
    """

    source_file: str
    """Filename where this rule was found, e.g. 'interest_calc.cbl'."""

    source_lines: tuple[int, int] = (0, 0)
    """
    (start_line, end_line) in the source file (1-indexed).
    TODO (business_extractor.py): extract precise line numbers from tree-sitter AST.
    """

    confidence: RuleConfidence = RuleConfidence.MEDIUM
    """LLM confidence in this extraction."""

    hardcoded_values: list[str] = Field(default_factory=list)
    """
    Magic numbers or string literals embedded in the rule logic.
    e.g. ['10000', '2.5', '35', '5']
    These are prime candidates for externalisation to a config file.
    """

    warnings: list[str] = Field(default_factory=list)
    """
    Anything suspicious the LLM noticed about this rule.
    e.g. ['Value appears to have changed — see comment on line 42',
          'Duplicate logic found in account_master.cbl line 88']
    """

    status: RuleStatus = RuleStatus.PENDING
    """Current human-review lifecycle state."""

    # --- Ownership fields (populated by ownership/classifier.py) ---
    ownership_category: OwnershipCategory = OwnershipCategory.UNKNOWN
    """Primary owning functional group — set after classify_rule_ownership()."""

    ownership_evidence: str = ""
    """Why we assigned this owner — set after classify_rule_ownership()."""

    ownership_confidence: OwnershipConfidence = OwnershipConfidence.LOW
    """Classifier confidence in the ownership assignment."""

    ownership_detail: Optional[OwnershipResult] = None
    """Full ownership result including secondary owners and actual person."""

    class Config:
        use_enum_values = True
