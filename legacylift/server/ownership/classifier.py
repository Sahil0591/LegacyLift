"""
ownership/classifier.py — Business rule ownership classifier.

=============================================================================
  THIS MODULE IS OWNED BY: Simonra
  Implement: classify_rule_ownership()
=============================================================================

After Layer 0 extracts business rules and a domain expert confirms them,
this module determines WHICH functional group is responsible for each rule.

This matters because:
  - The right team needs to sign off on migration accuracy for their rules
  - If a Compliance rule is wrong in production, it is a regulatory issue
  - If a Finance rule is wrong, it is a financial loss issue
  - Engineering rules are lower stakes but still important

The classifier uses multiple signals:
  1. Keyword matching in the rule title/description
     (e.g. "interest", "rate" → Finance; "AML", "KYC" → Compliance)
  2. Git log analysis — who last touched the lines that contain this rule?
     (requires a git log of the legacy repo, optional input)
  3. Documentation search — does the rule appear in any wiki/Confluence docs?
     (optional input)
  4. LLM classification — when heuristics are inconclusive, ask the LLM
     to classify based on rule description and context

Categories:
  Finance     — interest rates, fees, pricing, P&L
  Compliance  — AML, KYC, sanctions, regulatory reporting, audit
  Product     — product features, customer experience, account types
  Risk        — credit risk, market risk, operational risk limits
  Ops         — operational procedures, batch scheduling, SLAs
  Engineering — purely technical rules (logging, retry logic, etc.)

Pipeline position:
  Called by api/main.py after a human confirms a BusinessRule.
  Runs asynchronously so the UI can show ownership while migration continues.
"""

from __future__ import annotations

import os
import re
from typing import Optional

from rich.console import Console

from models.business_rule import (
    BusinessRule,
    OwnershipCategory,
    OwnershipConfidence,
    OwnershipResult,
)
from utils.llm_client import LLMClient

console = Console()
DEMO_MODE = os.getenv("DEMO_MODE", "true").lower() == "true"

# ---------------------------------------------------------------------------
# Keyword heuristics (Simonra: expand this dict with domain knowledge)
# ---------------------------------------------------------------------------

KEYWORD_OWNERSHIP_MAP: dict[OwnershipCategory, list[str]] = {
    OwnershipCategory.FINANCE: [
        "interest", "rate", "balance", "fee", "penalty", "charge",
        "credit", "debit", "payment", "invoice", "amount", "price",
        "accrual", "amortisation", "yield", "dividend", "pnl", "profit",
    ],
    OwnershipCategory.COMPLIANCE: [
        "aml", "kyc", "sanctions", "regulatory", "compliance", "audit",
        "reporting", "disclosure", "fatca", "gdpr", "basel", "sox",
        "statutory", "legal", "fiduciary",
    ],
    OwnershipCategory.RISK: [
        "risk", "exposure", "limit", "threshold", "var", "concentration",
        "default", "delinquent", "past due", "non-performing", "provision",
        "impairment", "stress",
    ],
    OwnershipCategory.OPS: [
        "batch", "schedule", "window", "sla", "cut-off", "cutoff",
        "eod", "end-of-day", "reconciliation", "settlement", "clearing",
    ],
    OwnershipCategory.PRODUCT: [
        "product", "feature", "account type", "tier", "premium", "basic",
        "customer", "eligibility", "onboarding",
    ],
    OwnershipCategory.ENGINEERING: [
        "logging", "retry", "timeout", "connection", "cache", "queue",
        "thread", "async", "performance", "latency",
    ],
}


async def classify_rule_ownership(
    rule: BusinessRule,
    git_log: str | None = None,
    docs: str | None = None,
) -> OwnershipResult:
    """
    Classify which functional group owns a confirmed business rule.

    ==========================================================================
    TODO: Simonra implements this function.

    Current implementation: keyword heuristics + LLM fallback stub.
    Replace the stub LLM call with a real classify prompt.

    Parameters:
        rule:    The confirmed BusinessRule to classify.
                 Key fields: title, description, hardcoded_values, source_file
        git_log: Optional git log of the file(s) that contain this rule.
                 Format: output of `git log --follow -p <filename>`.
                 Use this to find who last modified the rule's lines and
                 surface their name/email as actual_person.
        docs:    Optional documentation text (Confluence, wiki, Jira comments)
                 that might mention this rule by name or description.

    Returns:
        OwnershipResult with:
          primary_owner:     OwnershipCategory  — main owning functional group
          secondary_owners:  list[OwnershipCategory] — other stakeholders
          confidence:        OwnershipConfidence — how sure we are
          evidence:          str — human-readable reasoning
          actual_person:     str | None — specific person if found in git/docs
    ==========================================================================

    Implementation guide for Simonra:

    Step 1 — Keyword heuristics (already implemented below):
      Score each category by counting keyword matches in the rule's
      title + description.  The highest-scoring category is the primary owner.

    Step 2 — Git log analysis (TODO):
      If git_log is provided, parse it to find the most recent author who
      touched the lines cited in rule.source_lines.
      git log format: look for "Author: Name <email>" lines near the
      line numbers in the diff.
      Set actual_person = "Name <email> (last touched YYYY-MM-DD)"

    Step 3 — LLM classification (TODO):
      If heuristic score is low (< 3 keyword matches), ask the LLM:
        SYSTEM: "You are an expert in banking system ownership."
        USER:   "Classify the functional owner of this business rule:
                  Title: {rule.title}
                  Description: {rule.description}
                  Categories: Finance, Compliance, Product, Risk, Ops, Engineering"
      Parse the LLM's response into an OwnershipCategory.

    Step 4 — Docs search (TODO):
      If docs is provided, search for rule.title or key terms from
      rule.description in the docs string.
      If found, extract the author/owner mentioned in that section.
    """
    if DEMO_MODE:
        console.print(
            f"[dim]classify_rule_ownership() → classifying rule [{rule.id}]: {rule.title}[/dim]"
        )

    # --- Step 1: Keyword heuristics ---
    primary, secondary, score = _keyword_classify(rule)

    # --- Step 2: Git log analysis (TODO — Simonra) ---
    actual_person: Optional[str] = None
    if git_log:
        actual_person = _extract_person_from_git_log(git_log, rule.source_lines)

    # --- Step 3: LLM fallback (TODO — Simonra) ---
    if score < 2:
        # Heuristics were inconclusive — ask the LLM
        llm_result = await _llm_classify(rule)
        if llm_result:
            primary = llm_result
            confidence = OwnershipConfidence.MEDIUM
        else:
            confidence = OwnershipConfidence.LOW
    elif score >= 5:
        confidence = OwnershipConfidence.HIGH
    else:
        confidence = OwnershipConfidence.MEDIUM

    evidence = _build_evidence(rule, primary, score, actual_person, docs)

    return OwnershipResult(
        primary_owner=primary,
        secondary_owners=secondary,
        confidence=confidence,
        evidence=evidence,
        actual_person=actual_person,
    )


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _keyword_classify(
    rule: BusinessRule,
) -> tuple[OwnershipCategory, list[OwnershipCategory], int]:
    """
    Score each ownership category based on keyword matches.

    Returns:
        (primary_category, secondary_categories, top_score)
    """
    text = f"{rule.title} {rule.description}".lower()
    scores: dict[OwnershipCategory, int] = {cat: 0 for cat in OwnershipCategory}

    for category, keywords in KEYWORD_OWNERSHIP_MAP.items():
        for kw in keywords:
            if kw in text:
                scores[category] += 1

    # Sort by score descending
    ranked = sorted(scores.items(), key=lambda x: x[1], reverse=True)
    primary = ranked[0][0]
    top_score = ranked[0][1]

    # Secondary owners: categories with at least 1 match and not the primary
    secondary = [
        cat for cat, s in ranked[1:]
        if s >= 1 and cat != OwnershipCategory.UNKNOWN
    ][:2]  # Max 2 secondary owners

    if top_score == 0:
        primary = OwnershipCategory.UNKNOWN

    return primary, secondary, top_score


def _extract_person_from_git_log(
    git_log: str, source_lines: tuple[int, int]
) -> Optional[str]:
    """
    Parse git log output to find the most recent author.

    TODO (Simonra): implement proper git blame parsing.
      - Scan the git log diff for +/- lines near source_lines range
      - Extract 'Author: Name <email>' and 'Date: ...' from nearby commits
      - Return the most recent author as "Name <email> (YYYY-MM-DD)"

    Current: simple regex for Author lines in any git log output.
    """
    # PLACEHOLDER — just extract the most recent author line
    author_pattern = re.compile(r"^Author:\s+(.+)$", re.MULTILINE)
    date_pattern   = re.compile(r"^Date:\s+(.+)$", re.MULTILINE)

    authors = author_pattern.findall(git_log)
    dates   = date_pattern.findall(git_log)

    if authors:
        person = authors[0].strip()
        date   = dates[0].strip() if dates else "unknown date"
        return f"{person} (last commit: {date})"

    return None


async def _llm_classify(rule: BusinessRule) -> Optional[OwnershipCategory]:
    """
    Ask the LLM to classify ownership when keyword heuristics are inconclusive.

    TODO (Simonra): implement the full LLM classification prompt.
      - System: "You are a banking operations expert..."
      - User: rule.title + rule.description + list of categories
      - Parse response into OwnershipCategory
      - Handle LLM refusals and malformed responses
    """
    # PLACEHOLDER — return None so we fall back to UNKNOWN
    return None


def _build_evidence(
    rule: BusinessRule,
    primary: OwnershipCategory,
    score: int,
    actual_person: Optional[str],
    docs: Optional[str],
) -> str:
    """Build a human-readable evidence string for the ownership decision."""
    parts = []

    if score >= 2:
        parts.append(f"Keyword matching: {score} '{primary.value.lower()}' terms in rule description")
    elif score == 1:
        parts.append(f"Weak keyword signal: 1 '{primary.value.lower()}' term found")
    else:
        parts.append("No keyword matches — ownership is uncertain")

    if actual_person:
        parts.append(f"Git evidence: {actual_person}")

    if docs:
        parts.append("Documentation searched (see docs field for details)")

    return " | ".join(parts) if parts else "No evidence available"
