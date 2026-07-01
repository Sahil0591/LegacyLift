"""Owner-aware change guidance for decision-bearing code."""

from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation
from typing import Any, Sequence

from models.business_rule import ChangeGuidanceResult


MONEY_CONTEXT_RE = re.compile(
    r"\b(amount|balance|interest|rate|fee|price|payment|monetary|purchase|currency|threshold)\b",
    re.IGNORECASE,
)
RISK_CONTEXT_RE = re.compile(
    r"\b(risk|exposure|fraud|limit|threshold|manual[-\s]review|abuse)\b",
    re.IGNORECASE,
)
OPS_CONTEXT_RE = re.compile(
    r"\b(ops|operations|operational|volume|workload|batch|queue|manual[-\s]review|sla)\b",
    re.IGNORECASE,
)


def generate_change_guidance(
    *,
    rule: Any,
    ownership: Any,
    change_text: str = "",
    hardcoded_values: Sequence[str] | None = None,
) -> ChangeGuidanceResult:
    """Generate approval and test guidance for a potential rule change."""
    rule_text = _rule_text(rule)
    combined_text = f"{rule_text}\n{change_text}"
    primary_owner = str(_get_first(ownership, ("primary_owner",), "Unknown") or "Unknown")
    secondary_groups = _secondary_groups(ownership, combined_text, primary_owner)
    threshold = _changed_threshold(change_text) or _threshold_from_values(
        hardcoded_values or _get_first(rule, ("hardcoded_values", "key_variables"), []) or []
    )
    money_context = _has_money_context(combined_text)

    approval_checklist = _approval_checklist(
        primary_owner=primary_owner,
        secondary_groups=secondary_groups,
        has_threshold=threshold is not None,
    )
    suggested_tests = _suggested_tests(threshold, money_context)
    merge_risk = _merge_risk(
        primary_owner=primary_owner,
        ownership_confidence=str(_get_first(ownership, ("confidence",), "Low") or "Low"),
        has_threshold=threshold is not None,
        text=combined_text,
    )

    return ChangeGuidanceResult(
        risk_summary=_risk_summary(primary_owner, combined_text, threshold is not None),
        primary_approval_group=primary_owner,
        secondary_groups=secondary_groups,
        approval_checklist=approval_checklist,
        suggested_tests=suggested_tests,
        suggested_message=_suggested_message(
            rule=rule,
            primary_owner=primary_owner,
            has_threshold=threshold is not None,
        ),
        merge_risk=merge_risk,
    )


def _secondary_groups(ownership: Any, text: str, primary_owner: str) -> list[str]:
    groups: list[str] = []
    for group in _get_first(ownership, ("secondary_owners", "secondary_groups"), []) or []:
        name = str(group)
        if name and name != primary_owner and name not in groups:
            groups.append(name)

    if RISK_CONTEXT_RE.search(text) and primary_owner != "Risk" and "Risk" not in groups:
        groups.append("Risk")
    if OPS_CONTEXT_RE.search(text) and primary_owner != "Ops" and "Ops" not in groups:
        groups.append("Ops")

    return groups[:3]


def _approval_checklist(
    *,
    primary_owner: str,
    secondary_groups: Sequence[str],
    has_threshold: bool,
) -> list[str]:
    if primary_owner == "Unknown":
        return [
            "Confirm owning group before merge",
            "Document the confirming owner in the review ticket",
            "Link approving Linear ticket before merge",
        ]

    subject = "threshold" if has_threshold else "rule change"
    checklist = [f"Confirm intended {subject} with {primary_owner}"]
    for group in secondary_groups:
        if group == "Risk":
            checklist.append("Ask Risk to review exposure impact")
        elif group == "Ops":
            checklist.append("Ask Ops to review manual-review volume")
        else:
            checklist.append(f"Ask {group} to review stakeholder impact")
    checklist.append("Link approving Linear ticket before merge")
    return checklist


def _suggested_tests(threshold: Decimal | None, money_context: bool) -> list[str]:
    if threshold is None:
        return [
            "Existing behavior is preserved for a representative accepted case",
            "Existing behavior is preserved for a representative rejected case",
        ]

    step = Decimal("0.01") if money_context else Decimal("1")
    places = Decimal("0.01") if money_context else Decimal("1")
    below = (threshold - step).quantize(places)
    exact = threshold.quantize(places)
    above = (threshold + step).quantize(places)

    if money_context:
        return [
            f"${below} does not trigger review",
            f"${exact} triggers review",
            f"${above} triggers review",
        ]

    return [
        f"{below} does not trigger the changed branch",
        f"{exact} triggers the changed branch",
        f"{above} triggers the changed branch",
    ]


def _risk_summary(primary_owner: str, text: str, has_threshold: bool) -> str:
    if primary_owner == "Unknown":
        return "Ownership is unclear, so the change should not merge until the responsible group is confirmed."

    if has_threshold and RISK_CONTEXT_RE.search(text) and OPS_CONTEXT_RE.search(text):
        return "Changing this threshold may affect review volume, fraud exposure, and approval workload."

    if has_threshold and _has_money_context(text):
        return f"Changing this threshold may affect {primary_owner} policy, customer balances, and downstream controls."

    return f"Changing this decision may affect {primary_owner} behavior and should be reviewed by the owning group."


def _merge_risk(
    *,
    primary_owner: str,
    ownership_confidence: str,
    has_threshold: bool,
    text: str,
) -> str:
    if primary_owner == "Unknown":
        return "High"
    if has_threshold and (RISK_CONTEXT_RE.search(text) or _has_money_context(text)):
        return "High"
    if ownership_confidence == "Low":
        return "High"
    if ownership_confidence == "Medium":
        return "Medium"
    return "Low"


def _suggested_message(
    *,
    rule: Any,
    primary_owner: str,
    has_threshold: bool,
) -> str:
    source_file = str(_get_first(rule, ("source_file", "filename"), "changed file") or "changed file")
    source_lines = _get_first(rule, ("source_lines",), None)
    if not source_lines:
        start = _get_first(rule, ("start_line",), None)
        end = _get_first(rule, ("end_line",), start)
        source_lines = (start, end) if start else None

    location = source_file
    if isinstance(source_lines, (tuple, list)) and len(source_lines) == 2:
        location = f"{source_file}:{source_lines[0]}-{source_lines[1]}"

    subject = "threshold" if has_threshold else "decision logic"
    if primary_owner == "Unknown":
        return (
            f"I am proposing to change the {subject} in {location}. "
            "LegacyLift could not identify a clear owner. Who should approve this before merge?"
        )

    return (
        f"I am proposing to change the {subject} in {location}. "
        f"LegacyLift identifies this as {primary_owner}-owned. "
        f"Can you confirm the intended {subject} and approval path?"
    )


def _changed_threshold(change_text: str) -> Decimal | None:
    added_values: list[str] = []
    all_values: list[str] = []
    for line in change_text.splitlines():
        stripped = line.strip()
        if stripped.startswith("+++") or stripped.startswith("---"):
            continue
        values = _number_strings(stripped)
        all_values.extend(values)
        if stripped.startswith("+"):
            added_values.extend(values)

    return _last_decimal(added_values) or _last_decimal(all_values)


def _threshold_from_values(values: Sequence[str]) -> Decimal | None:
    return _last_decimal([str(value) for value in values])


def _number_strings(text: str) -> list[str]:
    return [
        match.group(0).lstrip("$£€").rstrip("%")
        for match in re.finditer(r"[$£€]?\d+(?:\.\d+)?%?", text)
    ]


def _last_decimal(values: Sequence[str]) -> Decimal | None:
    for raw in reversed(values):
        try:
            return Decimal(str(raw).replace(",", ""))
        except (InvalidOperation, ValueError):
            continue
    return None


def _has_money_context(text: str) -> bool:
    return MONEY_CONTEXT_RE.search(text) is not None


def _rule_text(rule: Any) -> str:
    pieces = [
        _get_first(rule, ("title",), ""),
        _get_first(rule, ("description", "rule"), ""),
        " ".join(str(value) for value in (_get_first(rule, ("hardcoded_values", "key_variables"), []) or [])),
    ]
    return " ".join(str(piece) for piece in pieces if piece)


def _get_first(obj: Any, names: tuple[str, ...], default: Any = None) -> Any:
    for name in names:
        if isinstance(obj, dict):
            value = obj.get(name, None)
        else:
            value = getattr(obj, name, None)
        if value not in (None, ""):
            return value
    return default
