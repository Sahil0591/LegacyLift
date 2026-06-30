from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import (
    ChangeGuidance,
    CodeChunk,
    Commit,
    DecisionCriterion,
    OwnershipClassification,
    OwnershipGroup,
    OwnershipReview,
    PullRequest,
    Repository,
)


DEFAULT_OWNERSHIP_GROUPS = (
    {
        "name": "Finance",
        "description": "Interest rates, fees, balances, accounting, reconciliation, and money movement rules.",
        "aliases": ["Treasury", "Accounting"],
        "color": "#0f766e",
    },
    {
        "name": "Compliance",
        "description": "KYC, audit, regulatory controls, account freezes, and mandated review gates.",
        "aliases": ["Legal", "Regulatory"],
        "color": "#7c3aed",
    },
    {
        "name": "Risk",
        "description": "Risk scoring, fraud thresholds, exposure limits, and exception handling.",
        "aliases": ["Fraud", "Credit Risk"],
        "color": "#dc2626",
    },
    {
        "name": "Product",
        "description": "Customer-facing product behavior, eligibility, account features, and journeys.",
        "aliases": ["Customer Product"],
        "color": "#2563eb",
    },
    {
        "name": "Ops",
        "description": "Batch jobs, operational workflows, account lifecycle tasks, and runbooks.",
        "aliases": ["Operations"],
        "color": "#ea580c",
    },
    {
        "name": "Engineering",
        "description": "Technical infrastructure, data schemas, integrations, and platform implementation.",
        "aliases": ["Platform"],
        "color": "#475569",
    },
    {
        "name": "Unknown",
        "description": "Fallback group for rules that need human triage before ownership can be trusted.",
        "aliases": [],
        "color": "#64748b",
    },
)


@dataclass(frozen=True)
class PersistedLayer0Summary:
    repository_id: str
    commit_sha: str
    chunk_count: int
    criterion_count: int
    classification_count: int
    review_count: int


def source_hash(source: str) -> str:
    return hashlib.sha256(source.encode("utf-8")).hexdigest()


def _json(data: Any) -> str:
    return json.dumps(data, sort_keys=True, separators=(",", ":"))


def _get_first(obj: Any, names: tuple[str, ...], default: Any = None) -> Any:
    for name in names:
        value = getattr(obj, name, None)
        if value not in (None, ""):
            return value
    return default


async def upsert_repository(
    session: AsyncSession,
    *,
    github_owner: str,
    github_name: str,
    default_branch: str = "main",
    installation_id: str | None = None,
) -> Repository:
    result = await session.execute(
        select(Repository).where(
            Repository.github_owner == github_owner,
            Repository.github_name == github_name,
        )
    )
    repository = result.scalar_one_or_none()

    if repository is None:
        repository = Repository(
            github_owner=github_owner,
            github_name=github_name,
            default_branch=default_branch,
            installation_id=installation_id,
        )
        session.add(repository)
    else:
        repository.default_branch = default_branch or repository.default_branch
        repository.installation_id = installation_id or repository.installation_id

    await session.flush()
    return repository


async def upsert_commit(
    session: AsyncSession,
    *,
    repository_id: str,
    sha: str,
    ref: str = "main",
) -> Commit:
    result = await session.execute(
        select(Commit).where(
            Commit.repository_id == repository_id,
            Commit.sha == sha,
            Commit.ref == ref,
        )
    )
    commit = result.scalar_one_or_none()

    if commit is None:
        commit = Commit(repository_id=repository_id, sha=sha, ref=ref)
        session.add(commit)
    else:
        commit.indexed_at = datetime.now(UTC)

    await session.flush()
    return commit


async def upsert_pull_request(
    session: AsyncSession,
    *,
    repository_id: str,
    number: int,
    base_sha: str,
    head_sha: str,
    state: str = "open",
) -> PullRequest:
    result = await session.execute(
        select(PullRequest).where(
            PullRequest.repository_id == repository_id,
            PullRequest.number == number,
        )
    )
    pull_request = result.scalar_one_or_none()

    if pull_request is None:
        pull_request = PullRequest(
            repository_id=repository_id,
            number=number,
            base_sha=base_sha,
            head_sha=head_sha,
            state=state,
        )
        session.add(pull_request)
    else:
        pull_request.base_sha = base_sha
        pull_request.head_sha = head_sha
        pull_request.state = state

    await session.flush()
    return pull_request


async def seed_default_ownership_groups(
    session: AsyncSession,
    *,
    repository_id: str | None = None,
) -> list[OwnershipGroup]:
    groups: list[OwnershipGroup] = []

    for group_def in DEFAULT_OWNERSHIP_GROUPS:
        result = await session.execute(
            select(OwnershipGroup).where(
                OwnershipGroup.repository_id.is_(None)
                if repository_id is None
                else OwnershipGroup.repository_id == repository_id,
                OwnershipGroup.name == group_def["name"],
            )
        )
        group = result.scalar_one_or_none()

        if group is None:
            group = OwnershipGroup(
                repository_id=repository_id,
                name=group_def["name"],
                description=group_def["description"],
                aliases_json=_json(group_def["aliases"]),
                color=group_def["color"],
                is_default=True,
            )
            session.add(group)
        else:
            group.description = group_def["description"]
            group.aliases_json = _json(group_def["aliases"])
            group.color = group_def["color"]
            group.is_default = True

        groups.append(group)

    await session.flush()
    return groups


async def upsert_code_chunk(
    session: AsyncSession,
    *,
    repository_id: str,
    commit_sha: str,
    path: str,
    name: str,
    language: str,
    start_line: int,
    end_line: int,
    source: str,
) -> CodeChunk:
    digest = source_hash(source)
    result = await session.execute(
        select(CodeChunk).where(
            CodeChunk.repository_id == repository_id,
            CodeChunk.commit_sha == commit_sha,
            CodeChunk.path == path,
            CodeChunk.start_line == start_line,
            CodeChunk.end_line == end_line,
        )
    )
    chunk = result.scalar_one_or_none()

    if chunk is None:
        chunk = CodeChunk(
            repository_id=repository_id,
            commit_sha=commit_sha,
            path=path,
            name=name,
            language=language,
            start_line=start_line,
            end_line=end_line,
            source_hash=digest,
            source_excerpt=source,
        )
        session.add(chunk)
    elif chunk.source_hash != digest:
        chunk.name = name
        chunk.language = language
        chunk.source_hash = digest
        chunk.source_excerpt = source

    await session.flush()
    return chunk


async def upsert_decision_criterion(
    session: AsyncSession,
    *,
    code_chunk_id: str,
    summary: str,
    hardcoded_values: list[str] | None = None,
    evidence: dict[str, Any] | None = None,
    confidence: float = 0.0,
) -> DecisionCriterion:
    result = await session.execute(
        select(DecisionCriterion).where(
            DecisionCriterion.code_chunk_id == code_chunk_id,
            DecisionCriterion.summary == summary,
        )
    )
    criterion = result.scalar_one_or_none()
    hardcoded_json = _json(hardcoded_values or [])
    evidence_json = _json(evidence or {})
    bounded_confidence = max(0.0, min(1.0, float(confidence or 0.0)))

    if criterion is None:
        criterion = DecisionCriterion(
            code_chunk_id=code_chunk_id,
            summary=summary,
            hardcoded_values_json=hardcoded_json,
            evidence_json=evidence_json,
            confidence=bounded_confidence,
        )
        session.add(criterion)
    else:
        criterion.hardcoded_values_json = hardcoded_json
        criterion.evidence_json = evidence_json
        criterion.confidence = bounded_confidence

    await session.flush()
    return criterion


async def find_ownership_group(
    session: AsyncSession,
    *,
    owner_name: str,
    repository_id: str | None = None,
) -> OwnershipGroup | None:
    result = await session.execute(
        select(OwnershipGroup).where(
            OwnershipGroup.name == owner_name,
            OwnershipGroup.repository_id == repository_id,
        )
    )
    return result.scalar_one_or_none()


async def upsert_ownership_classification(
    session: AsyncSession,
    *,
    decision_criterion_id: str,
    owner_name: str,
    owner_group_id: str | None = None,
    confidence: float = 0.0,
    evidence: str = "",
    matched_signals: list[str] | None = None,
    inferred_by: str = "layer0",
) -> OwnershipClassification:
    result = await session.execute(
        select(OwnershipClassification).where(
            OwnershipClassification.decision_criterion_id == decision_criterion_id,
            OwnershipClassification.inferred_by == inferred_by,
        )
    )
    classification = result.scalar_one_or_none()
    bounded_confidence = max(0.0, min(1.0, float(confidence or 0.0)))

    if classification is None:
        classification = OwnershipClassification(
            decision_criterion_id=decision_criterion_id,
            owner_group_id=owner_group_id,
            owner_name=owner_name,
            confidence=bounded_confidence,
            evidence=evidence,
            matched_signals_json=_json(matched_signals or []),
            inferred_by=inferred_by,
        )
        session.add(classification)
    else:
        classification.owner_group_id = owner_group_id
        classification.owner_name = owner_name
        classification.confidence = bounded_confidence
        classification.evidence = evidence
        classification.matched_signals_json = _json(matched_signals or [])

    await session.flush()
    return classification


async def upsert_ownership_review(
    session: AsyncSession,
    *,
    decision_criterion_id: str,
    original_owner_name: str,
    current_owner_name: str,
    review_state: str = "pending",
    approval_state: str = "pending",
    reviewer_identity: str | None = None,
    reason: str | None = None,
) -> OwnershipReview:
    result = await session.execute(
        select(OwnershipReview).where(
            OwnershipReview.decision_criterion_id == decision_criterion_id,
        )
    )
    review = result.scalar_one_or_none()

    if review is None:
        review = OwnershipReview(
            decision_criterion_id=decision_criterion_id,
            original_owner_name=original_owner_name,
            current_owner_name=current_owner_name,
            review_state=review_state,
            approval_state=approval_state,
            reviewer_identity=reviewer_identity,
            reason=reason,
        )
        session.add(review)
    else:
        review.current_owner_name = current_owner_name
        review.review_state = review_state
        review.approval_state = approval_state
        review.reviewer_identity = reviewer_identity
        review.reason = reason

    await session.flush()
    return review


async def upsert_change_guidance(
    session: AsyncSession,
    *,
    decision_criterion_id: str,
    risk_summary: str,
    primary_approval_group: str,
    secondary_groups: list[str] | None = None,
    approval_checklist: list[str] | None = None,
    suggested_tests: list[str] | None = None,
    suggested_message: str = "",
    merge_risk: str = "unknown",
) -> ChangeGuidance:
    result = await session.execute(
        select(ChangeGuidance).where(ChangeGuidance.decision_criterion_id == decision_criterion_id)
    )
    guidance = result.scalar_one_or_none()

    if guidance is None:
        guidance = ChangeGuidance(decision_criterion_id=decision_criterion_id)
        session.add(guidance)

    guidance.risk_summary = risk_summary
    guidance.primary_approval_group = primary_approval_group
    guidance.secondary_groups_json = _json(secondary_groups or [])
    guidance.approval_checklist_json = _json(approval_checklist or [])
    guidance.suggested_tests_json = _json(suggested_tests or [])
    guidance.suggested_message = suggested_message
    guidance.merge_risk = merge_risk

    await session.flush()
    return guidance


async def persist_layer0_analysis(
    session: AsyncSession,
    project: Any,
    chunks: list[Any],
    business_rules: list[Any],
) -> PersistedLayer0Summary:
    github_owner = str(_get_first(project, ("github_owner", "repository_owner", "owner"), "local-upload"))
    github_name = str(_get_first(project, ("github_name", "repository_name", "repo_name"), None) or project.id)
    default_branch = str(_get_first(project, ("default_branch", "base_ref"), "main"))
    installation_id = _get_first(project, ("installation_id", "github_installation_id"), None)
    commit_sha = str(_get_first(project, ("commit_sha", "head_sha", "sha"), f"local-{project.id}"))
    ref = str(_get_first(project, ("ref", "branch", "head_ref"), "local-upload"))

    repository = await upsert_repository(
        session,
        github_owner=github_owner,
        github_name=github_name,
        default_branch=default_branch,
        installation_id=str(installation_id) if installation_id is not None else None,
    )
    await upsert_commit(session, repository_id=repository.id, sha=commit_sha, ref=ref)
    groups = await seed_default_ownership_groups(session, repository_id=repository.id)
    group_by_name = {group.name: group for group in groups}

    rule_by_chunk_id = {str(getattr(rule, "chunk_id", "")): rule for rule in business_rules}
    chunk_ids: set[str] = set()
    criterion_ids: set[str] = set()
    classification_ids: set[str] = set()
    review_ids: set[str] = set()

    for chunk in chunks:
        persisted_chunk = await upsert_code_chunk(
            session,
            repository_id=repository.id,
            commit_sha=commit_sha,
            path=str(_get_first(chunk, ("path", "filename"), "unknown")),
            name=str(getattr(chunk, "name", "unknown")),
            language=str(getattr(chunk, "language", "unknown")),
            start_line=int(getattr(chunk, "start_line", 0) or 0),
            end_line=int(getattr(chunk, "end_line", 0) or 0),
            source=str(_get_first(chunk, ("source", "source_code"), "")),
        )
        chunk_ids.add(persisted_chunk.id)

        rule = rule_by_chunk_id.get(str(getattr(chunk, "id", "")))
        if rule is None:
            continue

        owner_name = str(getattr(rule, "owner", "Unknown") or "Unknown")
        evidence = str(getattr(rule, "owner_reasoning", "") or "")
        hardcoded_values = list(getattr(rule, "key_variables", []) or [])
        confidence = float(getattr(rule, "confidence", 0.0) or 0.0)
        criterion = await upsert_decision_criterion(
            session,
            code_chunk_id=persisted_chunk.id,
            summary=str(getattr(rule, "rule", "") or "Business rule requires review."),
            hardcoded_values=hardcoded_values,
            evidence={
                "layer0_rule_id": getattr(rule, "id", None),
                "chunk_id": getattr(rule, "chunk_id", None),
                "owner": owner_name,
                "owner_reasoning": evidence,
                "needs_review": bool(getattr(rule, "needs_review", False)),
                "extraction_error": getattr(rule, "extraction_error", None),
            },
            confidence=confidence,
        )
        criterion_ids.add(criterion.id)

        owner_group = group_by_name.get(owner_name) or group_by_name.get("Unknown")
        classification = await upsert_ownership_classification(
            session,
            decision_criterion_id=criterion.id,
            owner_group_id=owner_group.id if owner_group else None,
            owner_name=owner_name,
            confidence=confidence,
            evidence=evidence,
            matched_signals=hardcoded_values,
            inferred_by="layer0",
        )
        classification_ids.add(classification.id)

        review = await upsert_ownership_review(
            session,
            decision_criterion_id=criterion.id,
            original_owner_name=owner_name,
            current_owner_name=owner_name,
            review_state="pending",
            approval_state="pending",
        )
        review_ids.add(review.id)

    await session.flush()
    return PersistedLayer0Summary(
        repository_id=repository.id,
        commit_sha=commit_sha,
        chunk_count=len(chunk_ids),
        criterion_count=len(criterion_ids),
        classification_count=len(classification_ids),
        review_count=len(review_ids),
    )
