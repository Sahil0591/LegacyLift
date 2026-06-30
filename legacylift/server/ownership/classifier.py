"""Business-rule ownership classifier.

The backend classifier is the canonical source for ownership used by durable
overlay records. It is deterministic first: keyword and alias signals are
scored locally, custom groups can be supplied per repository, and the LLM is
used only as an optional fallback for weak/no-signal cases.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from typing import Any, Optional, Sequence

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


@dataclass(frozen=True)
class OwnershipGroupConfig:
    """Classifier view of an ownership group."""

    name: str
    description: str = ""
    aliases: tuple[str, ...] = ()
    color: str = "#64748b"
    is_default: bool = False
    keywords: tuple[str, ...] = ()


@dataclass(frozen=True)
class _Score:
    group: OwnershipGroupConfig
    score: int
    matched_signals: tuple[str, ...]
    alias_matches: tuple[str, ...]
    order: int


DEFAULT_OWNERSHIP_GROUPS: tuple[OwnershipGroupConfig, ...] = (
    OwnershipGroupConfig(
        name=OwnershipCategory.FINANCE.value,
        description="Interest rates, fees, balances, pricing, accounting, reconciliation, and money movement.",
        aliases=("Treasury", "Accounting", "Pricing", "Finance / Pricing"),
        color="#0f766e",
        is_default=True,
        keywords=(
            "interest",
            "rate",
            "balance",
            "fee",
            "penalty",
            "charge",
            "credit",
            "debit",
            "payment",
            "invoice",
            "amount",
            "price",
            "monetary",
            "threshold",
            "accrual",
            "amortisation",
            "yield",
            "dividend",
            "pnl",
            "profit",
            "reconciliation",
        ),
    ),
    OwnershipGroupConfig(
        name=OwnershipCategory.COMPLIANCE.value,
        description="KYC, AML, audit, regulatory controls, sanctions, and mandated review gates.",
        aliases=("Legal", "Regulatory", "AML", "KYC"),
        color="#7c3aed",
        is_default=True,
        keywords=(
            "aml",
            "kyc",
            "sanctions",
            "regulatory",
            "compliance",
            "audit",
            "reporting",
            "disclosure",
            "fatca",
            "gdpr",
            "basel",
            "sox",
            "statutory",
            "legal",
            "fiduciary",
        ),
    ),
    OwnershipGroupConfig(
        name=OwnershipCategory.PRODUCT.value,
        description="Customer-facing product behavior, eligibility, account features, and journeys.",
        aliases=("Customer Product",),
        color="#2563eb",
        is_default=True,
        keywords=(
            "product",
            "feature",
            "account type",
            "tier",
            "premium",
            "basic",
            "customer",
            "eligibility",
            "onboarding",
            "journey",
            "experience",
        ),
    ),
    OwnershipGroupConfig(
        name=OwnershipCategory.RISK.value,
        description="Risk scoring, fraud thresholds, exposure limits, and exception handling.",
        aliases=("Fraud", "Credit Risk", "Risk Ops"),
        color="#dc2626",
        is_default=True,
        keywords=(
            "risk",
            "exposure",
            "limit",
            "threshold",
            "var",
            "concentration",
            "default",
            "delinquent",
            "past due",
            "non-performing",
            "provision",
            "impairment",
            "stress",
            "fraud",
            "manual review",
        ),
    ),
    OwnershipGroupConfig(
        name=OwnershipCategory.OPS.value,
        description="Batch jobs, operational workflows, account lifecycle tasks, runbooks, and SLAs.",
        aliases=("Operations",),
        color="#ea580c",
        is_default=True,
        keywords=(
            "batch",
            "schedule",
            "window",
            "sla",
            "cut-off",
            "cutoff",
            "eod",
            "end-of-day",
            "reconciliation",
            "settlement",
            "clearing",
            "operational",
            "manual review",
            "volume",
            "workload",
            "queue",
        ),
    ),
    OwnershipGroupConfig(
        name=OwnershipCategory.ENGINEERING.value,
        description="Technical infrastructure, data schemas, integrations, and platform implementation.",
        aliases=("Platform",),
        color="#475569",
        is_default=True,
        keywords=(
            "logging",
            "retry",
            "timeout",
            "connection",
            "cache",
            "queue",
            "thread",
            "async",
            "performance",
            "latency",
            "schema",
            "table",
            "integration",
        ),
    ),
    OwnershipGroupConfig(
        name=OwnershipCategory.UNKNOWN.value,
        description="Fallback group for rules that need human triage before ownership can be trusted.",
        aliases=(),
        color="#64748b",
        is_default=True,
        keywords=(),
    ),
)


async def classify_rule_ownership(
    rule: BusinessRule | Any,
    git_log: str | None = None,
    docs: str | None = None,
    groups: Sequence[OwnershipGroupConfig | dict[str, Any] | Any] | None = None,
    use_llm_fallback: bool | None = None,
) -> OwnershipResult:
    """Classify which functional group owns a business rule or criterion."""
    if DEMO_MODE:
        rule_id = _get_first(rule, ("id",), "unknown")
        title = _get_first(rule, ("title", "rule"), "Business rule")
        console.print(
            f"[dim]classify_rule_ownership() -> classifying rule [{rule_id}]: {title}[/dim]"
        )

    group_defs = normalize_group_definitions(groups)
    text = _text_for_rule(rule)
    scores = _score_groups(text, group_defs)

    primary_score = scores[0] if scores else _unknown_score(group_defs)
    secondary_scores = [
        row
        for row in scores[1:]
        if row.score > 0 and row.group.name != OwnershipCategory.UNKNOWN.value
    ]

    primary_owner = primary_score.group.name
    matched_signals = list(primary_score.matched_signals)
    confidence = _confidence_for(primary_score, secondary_scores)

    should_try_llm = (
        use_llm_fallback if use_llm_fallback is not None else not DEMO_MODE
    )
    if should_try_llm and confidence == OwnershipConfidence.LOW:
        llm_owner = await _llm_classify(rule, group_defs)
        if llm_owner and llm_owner != OwnershipCategory.UNKNOWN.value:
            primary_owner = llm_owner
            matched_signals = []
            confidence = OwnershipConfidence.MEDIUM
            primary_score = _Score(
                group=_group_by_name(group_defs, llm_owner),
                score=2,
                matched_signals=(),
                alias_matches=(),
                order=primary_score.order,
            )
            secondary_scores = []

    if confidence == OwnershipConfidence.LOW:
        primary_owner = OwnershipCategory.UNKNOWN.value
        matched_signals = []
        secondary_scores = []

    actual_person: Optional[str] = None
    if git_log:
        actual_person = _extract_person_from_git_log(
            git_log,
            _get_first(rule, ("source_lines",), (0, 0)),
        )

    secondary_owners = _secondary_owner_names(secondary_scores, primary_owner)
    evidence = _build_evidence(
        primary_owner=primary_owner,
        confidence=confidence,
        matched_signals=matched_signals,
        secondary_owners=secondary_owners,
        actual_person=actual_person,
        docs=docs,
    )

    return OwnershipResult(
        primary_owner=primary_owner,
        secondary_owners=secondary_owners,
        confidence=confidence,
        evidence=evidence,
        matched_signals=matched_signals,
        review_status="Inferred",
        actual_person=actual_person,
    )


def normalize_group_definitions(
    groups: Sequence[OwnershipGroupConfig | dict[str, Any] | Any] | None = None,
) -> list[OwnershipGroupConfig]:
    """Return default groups plus normalized custom groups."""
    normalized = list(DEFAULT_OWNERSHIP_GROUPS)
    seen_default_names = {group.name.casefold() for group in normalized}

    for raw in groups or ():
        group = _normalize_group(raw)
        if not group.name:
            continue

        existing_index = next(
            (idx for idx, item in enumerate(normalized) if item.name.casefold() == group.name.casefold()),
            None,
        )
        if existing_index is not None and group.name.casefold() in seen_default_names:
            # A repository can refine default aliases/metadata without removing
            # the built-in keywords that make the default classifier useful.
            default = normalized[existing_index]
            normalized[existing_index] = OwnershipGroupConfig(
                name=default.name,
                description=group.description or default.description,
                aliases=tuple(dict.fromkeys((*default.aliases, *group.aliases))),
                color=group.color or default.color,
                is_default=True,
                keywords=default.keywords,
            )
            continue
        if existing_index is not None:
            normalized[existing_index] = group
        else:
            normalized.append(group)

    return normalized


def _normalize_group(raw: OwnershipGroupConfig | dict[str, Any] | Any) -> OwnershipGroupConfig:
    if isinstance(raw, OwnershipGroupConfig):
        return raw

    aliases = _get_first(raw, ("aliases", "alias", "aliases_json"), [])
    if isinstance(aliases, str):
        try:
            parsed_aliases = json.loads(aliases)
            aliases = parsed_aliases if isinstance(parsed_aliases, list) else [aliases]
        except json.JSONDecodeError:
            aliases = [aliases]

    return OwnershipGroupConfig(
        name=str(_get_first(raw, ("name",), "") or ""),
        description=str(_get_first(raw, ("description",), "") or ""),
        aliases=tuple(str(alias) for alias in aliases or [] if str(alias).strip()),
        color=str(_get_first(raw, ("color",), "#64748b") or "#64748b"),
        is_default=bool(_get_first(raw, ("is_default",), False)),
        keywords=tuple(
            str(keyword)
            for keyword in (_get_first(raw, ("keywords",), []) or [])
            if str(keyword).strip()
        ),
    )


def _score_groups(text: str, groups: Sequence[OwnershipGroupConfig]) -> list[_Score]:
    rows: list[_Score] = []

    for order, group in enumerate(groups):
        if group.name == OwnershipCategory.UNKNOWN.value:
            continue

        keyword_matches = _matched_signals(text, group.keywords)
        alias_matches = _matched_signals(text, group.aliases)
        matched = tuple(dict.fromkeys((*keyword_matches, *alias_matches)))
        score = len(keyword_matches) + (len(alias_matches) * 2)

        if alias_matches and not group.is_default:
            score += 3
        if _contains_signal(text, group.name):
            matched = tuple(dict.fromkeys((*matched, group.name.lower())))
            score += 1

        rows.append(
            _Score(
                group=group,
                score=score,
                matched_signals=matched,
                alias_matches=alias_matches,
                order=order,
            )
        )

    rows.sort(
        key=lambda row: (
            row.score,
            bool(row.alias_matches and not row.group.is_default),
            len(row.matched_signals),
            -row.order,
        ),
        reverse=True,
    )

    unknown = _unknown_score(groups)
    if not rows or rows[0].score == 0:
        return [unknown]
    return rows + [unknown]


def _unknown_score(groups: Sequence[OwnershipGroupConfig]) -> _Score:
    unknown_group = next(
        (group for group in groups if group.name == OwnershipCategory.UNKNOWN.value),
        DEFAULT_OWNERSHIP_GROUPS[-1],
    )
    return _Score(
        group=unknown_group,
        score=0,
        matched_signals=(),
        alias_matches=(),
        order=len(groups),
    )


def _confidence_for(primary: _Score, secondary: Sequence[_Score]) -> OwnershipConfidence:
    if primary.score <= 1:
        return OwnershipConfidence.LOW

    second_score = secondary[0].score if secondary else 0
    conflicting = second_score >= 2 and second_score >= primary.score - 1

    if primary.score >= 5 or len(primary.matched_signals) >= 4:
        return OwnershipConfidence.MEDIUM if conflicting else OwnershipConfidence.HIGH
    if primary.score >= 3:
        return OwnershipConfidence.MEDIUM
    return OwnershipConfidence.LOW


def _secondary_owner_names(scores: Sequence[_Score], primary_owner: str) -> list[str]:
    owners: list[str] = []
    for row in scores:
        if row.group.name == primary_owner:
            continue
        if row.group.name == OwnershipCategory.UNKNOWN.value:
            continue
        if row.score < 1:
            continue
        owners.append(row.group.name)
        if len(owners) == 3:
            break
    return owners


def _matched_signals(text: str, signals: Sequence[str]) -> tuple[str, ...]:
    matches: list[str] = []
    for signal in signals:
        normalized = str(signal).strip().lower()
        if not normalized:
            continue
        if _contains_signal(text, normalized):
            matches.append(normalized)
    return tuple(dict.fromkeys(matches))


def _contains_signal(text: str, signal: str) -> bool:
    parts = [part for part in re.split(r"[\s_-]+", signal.lower()) if part]
    if not parts:
        return False
    pattern = r"(?<![a-z0-9])" + r"[\s_-]+".join(re.escape(part) for part in parts) + r"(?![a-z0-9])"
    return re.search(pattern, text.lower()) is not None


def _text_for_rule(rule: BusinessRule | Any) -> str:
    pieces = [
        _get_first(rule, ("title",), ""),
        _get_first(rule, ("description", "rule"), ""),
        _get_first(rule, ("owner_reasoning", "ownership_evidence"), ""),
        " ".join(str(value) for value in (_get_first(rule, ("hardcoded_values", "key_variables"), []) or [])),
    ]
    return " ".join(str(piece) for piece in pieces if piece).lower()


def _get_first(obj: Any, names: tuple[str, ...], default: Any = None) -> Any:
    for name in names:
        if isinstance(obj, dict):
            value = obj.get(name, None)
        else:
            value = getattr(obj, name, None)
        if value not in (None, ""):
            return value
    return default


def _group_by_name(groups: Sequence[OwnershipGroupConfig], name: str) -> OwnershipGroupConfig:
    return next(
        (group for group in groups if group.name.casefold() == name.casefold()),
        OwnershipGroupConfig(name=name),
    )


def _extract_person_from_git_log(
    git_log: str,
    source_lines: tuple[int, int],
) -> Optional[str]:
    """Parse git log output to find the most recent author."""
    del source_lines
    author_pattern = re.compile(r"^Author:\s+(.+)$", re.MULTILINE)
    date_pattern = re.compile(r"^Date:\s+(.+)$", re.MULTILINE)

    authors = author_pattern.findall(git_log)
    dates = date_pattern.findall(git_log)

    if authors:
        person = authors[0].strip()
        date = dates[0].strip() if dates else "unknown date"
        return f"{person} (last commit: {date})"

    return None


async def _llm_classify(
    rule: BusinessRule | Any,
    groups: Sequence[OwnershipGroupConfig],
) -> Optional[str]:
    """Ask the LLM to classify ownership when deterministic evidence is weak."""
    group_names = [group.name for group in groups]
    client = LLMClient()
    response = await client.complete(
        system=(
            "You are an expert in banking-system functional ownership. "
            "Return JSON only."
        ),
        user=(
            "Classify the functional owner of this business rule.\n"
            f"Rule: {_text_for_rule(rule)}\n"
            f"Allowed owners: {', '.join(group_names)}\n"
            'Respond as {"primary_owner": "Owner Name"} and nothing else.'
        ),
        temperature=0.0,
        max_tokens=256,
    )
    return _parse_llm_owner_response(response, group_names)


def _parse_llm_owner_response(response: str, group_names: Sequence[str]) -> Optional[str]:
    """Parse an LLM owner response without trusting malformed text."""
    owner: str | None = None
    try:
        parsed = json.loads(response)
        if isinstance(parsed, dict):
            raw_owner = (
                parsed.get("primary_owner")
                or parsed.get("owner")
                or parsed.get("category")
            )
            if raw_owner is not None:
                owner = str(raw_owner)
    except json.JSONDecodeError:
        lower = response.casefold()
        exact_mentions = [
            name
            for name in group_names
            if re.search(
                r"(?<![a-z0-9])" + re.escape(name.casefold()) + r"(?![a-z0-9])",
                lower,
            )
        ]
        if len(exact_mentions) == 1:
            owner = exact_mentions[0]

    if not owner:
        return None

    return next(
        (name for name in group_names if name.casefold() == owner.casefold()),
        None,
    )


def _build_evidence(
    *,
    primary_owner: str,
    confidence: OwnershipConfidence,
    matched_signals: Sequence[str],
    secondary_owners: Sequence[str],
    actual_person: Optional[str],
    docs: Optional[str],
) -> str:
    parts: list[str] = []

    if primary_owner == OwnershipCategory.UNKNOWN.value or confidence == OwnershipConfidence.LOW:
        parts.append("No strong ownership signals matched; human confirmation required.")
    elif matched_signals:
        parts.append(
            "Matched "
            + ", ".join(matched_signals)
            + f" signals for {primary_owner}."
        )
    else:
        parts.append(f"LLM fallback suggested {primary_owner}; verify before relying on it.")

    if secondary_owners:
        parts.append("Secondary stakeholder signals: " + ", ".join(secondary_owners) + ".")

    if actual_person:
        parts.append(f"Git evidence: {actual_person}.")

    if docs:
        parts.append("Documentation was searched for corroborating ownership context.")

    return " ".join(parts)
