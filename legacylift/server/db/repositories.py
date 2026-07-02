from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import (
    BaselineIndexJob,
    ChangeGuidance,
    CodeChunk,
    Commit,
    DecisionCriterion,
    GitHubWebhookDelivery,
    OwnershipClassification,
    OwnershipGroup,
    OwnershipReview,
    PullRequestChangedFile,
    PullRequestHunk,
    PullRequestHunkMatch,
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


def _utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


@dataclass(frozen=True)
class PersistedLayer0Summary:
    repository_id: str
    commit_sha: str
    chunk_count: int
    criterion_count: int
    classification_count: int
    review_count: int
    guidance_count: int = 0


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


def _confidence_value(value: Any) -> float:
    raw = getattr(value, "value", value)
    if isinstance(raw, (int, float)):
        return max(0.0, min(1.0, float(raw)))

    normalized = str(raw or "").lower()
    if normalized == "high":
        return 0.9
    if normalized == "medium":
        return 0.6
    if normalized == "low":
        return 0.25
    return 0.0


def _project_custom_ownership_groups(project: Any) -> list[dict[str, Any]]:
    raw_groups = _get_first(
        project,
        ("custom_ownership_groups", "ownership_groups", "owner_groups"),
        [],
    )
    if not isinstance(raw_groups, list):
        return []

    groups: list[dict[str, Any]] = []
    for raw in raw_groups:
        if isinstance(raw, dict):
            name = raw.get("name")
            description = raw.get("description", "")
            aliases = raw.get("aliases", [])
            color = raw.get("color", "#64748b")
            is_default = raw.get("is_default", False)
        else:
            name = getattr(raw, "name", None)
            description = getattr(raw, "description", "")
            aliases = getattr(raw, "aliases", [])
            color = getattr(raw, "color", "#64748b")
            is_default = getattr(raw, "is_default", False)

        if isinstance(aliases, str):
            try:
                parsed_aliases = json.loads(aliases)
                aliases = parsed_aliases if isinstance(parsed_aliases, list) else [aliases]
            except json.JSONDecodeError:
                aliases = [aliases]

        if name:
            groups.append(
                {
                    "name": str(name),
                    "description": str(description or ""),
                    "aliases": [str(alias) for alias in aliases or []],
                    "color": str(color or "#64748b"),
                    "is_default": bool(is_default),
                }
            )

    return groups


async def upsert_repository(
    session: AsyncSession,
    *,
    github_owner: str,
    github_name: str,
    github_repository_id: str | None = None,
    html_url: str | None = None,
    default_branch: str = "main",
    installation_id: str | None = None,
    is_active: bool = True,
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
            github_repository_id=github_repository_id,
            github_owner=github_owner,
            github_name=github_name,
            html_url=html_url,
            default_branch=default_branch,
            installation_id=installation_id,
            is_active=is_active,
        )
        session.add(repository)
    else:
        repository.github_repository_id = github_repository_id or repository.github_repository_id
        repository.html_url = html_url or repository.html_url
        repository.default_branch = default_branch or repository.default_branch
        repository.installation_id = installation_id or repository.installation_id
        repository.is_active = is_active

    await session.flush()
    return repository


async def record_webhook_delivery(
    session: AsyncSession,
    *,
    delivery_id: str,
    event: str,
    action: str | None,
    payload_hash: str,
) -> tuple[GitHubWebhookDelivery, bool]:
    result = await session.execute(
        select(GitHubWebhookDelivery).where(GitHubWebhookDelivery.delivery_id == delivery_id)
    )
    delivery = result.scalar_one_or_none()
    if delivery is not None:
        return delivery, False

    delivery = GitHubWebhookDelivery(
        delivery_id=delivery_id,
        event=event,
        action=action,
        payload_hash=payload_hash,
        status="processing",
    )
    session.add(delivery)
    await session.flush()
    return delivery, True


async def mark_webhook_delivery_processed(
    session: AsyncSession,
    delivery: GitHubWebhookDelivery,
    *,
    status: str = "processed",
    error: str | None = None,
) -> GitHubWebhookDelivery:
    delivery.status = status
    delivery.error = error
    delivery.processed_at = _utcnow()
    await session.flush()
    return delivery


async def queue_baseline_index_job(
    session: AsyncSession,
    *,
    repository_id: str,
    ref: str,
    commit_sha: str | None = None,
    reason: str = "installation",
) -> BaselineIndexJob:
    result = await session.execute(
        select(BaselineIndexJob).where(
            BaselineIndexJob.repository_id == repository_id,
            BaselineIndexJob.ref == ref,
            BaselineIndexJob.status == "queued",
            BaselineIndexJob.reason == reason,
        )
    )
    job = result.scalar_one_or_none()
    if job is None:
        job = BaselineIndexJob(
            repository_id=repository_id,
            ref=ref,
            commit_sha=commit_sha,
            status="queued",
            reason=reason,
        )
        session.add(job)
    else:
        job.commit_sha = commit_sha or job.commit_sha
        job.last_error = None

    await session.flush()
    return job


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
        commit.indexed_at = _utcnow()

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


async def upsert_pull_request_changed_file(
    session: AsyncSession,
    *,
    pull_request_id: str,
    path: str,
    status: str,
    sha: str | None = None,
    additions: int = 0,
    deletions: int = 0,
    changes: int = 0,
    patch: str = "",
    previous_filename: str | None = None,
) -> PullRequestChangedFile:
    result = await session.execute(
        select(PullRequestChangedFile).where(
            PullRequestChangedFile.pull_request_id == pull_request_id,
            PullRequestChangedFile.path == path,
        )
    )
    changed_file = result.scalar_one_or_none()
    if changed_file is None:
        changed_file = PullRequestChangedFile(
            pull_request_id=pull_request_id,
            path=path,
            status=status,
            sha=sha,
            additions=additions,
            deletions=deletions,
            changes=changes,
            patch=patch,
            previous_filename=previous_filename,
        )
        session.add(changed_file)
    else:
        changed_file.status = status
        changed_file.sha = sha
        changed_file.additions = additions
        changed_file.deletions = deletions
        changed_file.changes = changes
        changed_file.patch = patch
        changed_file.previous_filename = previous_filename

    await session.flush()
    return changed_file


async def upsert_pull_request_hunk(
    session: AsyncSession,
    *,
    changed_file_id: str,
    path: str,
    hunk_index: int,
    header: str,
    old_start_line: int,
    old_end_line: int,
    new_start_line: int,
    new_end_line: int,
    patch: str,
) -> PullRequestHunk:
    result = await session.execute(
        select(PullRequestHunk).where(
            PullRequestHunk.changed_file_id == changed_file_id,
            PullRequestHunk.hunk_index == hunk_index,
        )
    )
    hunk = result.scalar_one_or_none()
    if hunk is None:
        hunk = PullRequestHunk(
            changed_file_id=changed_file_id,
            path=path,
            hunk_index=hunk_index,
            header=header,
            old_start_line=old_start_line,
            old_end_line=old_end_line,
            new_start_line=new_start_line,
            new_end_line=new_end_line,
            patch=patch,
        )
        session.add(hunk)
    else:
        hunk.path = path
        hunk.header = header
        hunk.old_start_line = old_start_line
        hunk.old_end_line = old_end_line
        hunk.new_start_line = new_start_line
        hunk.new_end_line = new_end_line
        hunk.patch = patch

    await session.flush()
    return hunk


async def upsert_pull_request_hunk_match(
    session: AsyncSession,
    *,
    hunk_id: str,
    code_chunk_id: str,
    overlap_start_line: int,
    overlap_end_line: int,
) -> PullRequestHunkMatch:
    result = await session.execute(
        select(PullRequestHunkMatch).where(
            PullRequestHunkMatch.hunk_id == hunk_id,
            PullRequestHunkMatch.code_chunk_id == code_chunk_id,
        )
    )
    match = result.scalar_one_or_none()
    if match is None:
        match = PullRequestHunkMatch(
            hunk_id=hunk_id,
            code_chunk_id=code_chunk_id,
            overlap_start_line=overlap_start_line,
            overlap_end_line=overlap_end_line,
        )
        session.add(match)
    else:
        match.overlap_start_line = overlap_start_line
        match.overlap_end_line = overlap_end_line

    await session.flush()
    return match


async def match_hunk_to_code_chunks(
    session: AsyncSession,
    *,
    repository_id: str,
    commit_sha: str,
    path: str,
    hunk_id: str,
    start_line: int,
    end_line: int,
) -> list[PullRequestHunkMatch]:
    result = await session.execute(
        select(CodeChunk).where(
            CodeChunk.repository_id == repository_id,
            CodeChunk.commit_sha == commit_sha,
            CodeChunk.path == path,
            CodeChunk.start_line <= end_line,
            CodeChunk.end_line >= start_line,
        )
    )
    chunks = result.scalars().all()
    matches: list[PullRequestHunkMatch] = []
    for chunk in chunks:
        overlap_start = max(start_line, chunk.start_line)
        overlap_end = min(end_line, chunk.end_line)
        if overlap_start <= overlap_end:
            matches.append(
                await upsert_pull_request_hunk_match(
                    session,
                    hunk_id=hunk_id,
                    code_chunk_id=chunk.id,
                    overlap_start_line=overlap_start,
                    overlap_end_line=overlap_end,
                )
            )

    await session.flush()
    return matches


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


async def upsert_ownership_group(
    session: AsyncSession,
    *,
    name: str,
    repository_id: str | None = None,
    description: str = "",
    aliases: list[str] | None = None,
    color: str = "#64748b",
    is_default: bool = False,
) -> OwnershipGroup:
    result = await session.execute(
        select(OwnershipGroup).where(
            OwnershipGroup.repository_id.is_(None)
            if repository_id is None
            else OwnershipGroup.repository_id == repository_id,
            OwnershipGroup.name == name,
        )
    )
    group = result.scalar_one_or_none()

    if group is None:
        group = OwnershipGroup(
            repository_id=repository_id,
            name=name,
            description=description,
            aliases_json=_json(aliases or []),
            color=color,
            is_default=is_default,
        )
        session.add(group)
    else:
        group.description = description
        group.aliases_json = _json(aliases or [])
        group.color = color
        group.is_default = is_default

    await session.flush()
    return group


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
    action: str = "inferred",
    review_state: str = "pending",
    approval_state: str = "pending",
    reviewer_identity: str | None = None,
    review_timestamp: datetime | None = None,
    approval_timestamp: datetime | None = None,
    reason: str | None = None,
    source_surface: str = "LegacyLift workbench",
) -> OwnershipReview:
    result = await session.execute(
        select(OwnershipReview).where(
            OwnershipReview.decision_criterion_id == decision_criterion_id,
            OwnershipReview.action == action,
        )
    )
    review = result.scalar_one_or_none()

    if review is None:
        review = OwnershipReview(
            decision_criterion_id=decision_criterion_id,
            action=action,
            original_owner_name=original_owner_name,
            current_owner_name=current_owner_name,
            review_state=review_state,
            approval_state=approval_state,
            reviewer_identity=reviewer_identity,
            review_timestamp=review_timestamp,
            approval_timestamp=approval_timestamp,
            reason=reason,
            source_surface=source_surface,
        )
        session.add(review)
    else:
        review.current_owner_name = current_owner_name
        review.review_state = review_state
        review.approval_state = approval_state
        review.reviewer_identity = reviewer_identity
        review.review_timestamp = review_timestamp
        review.approval_timestamp = approval_timestamp
        review.reason = reason
        review.source_surface = source_surface

    await session.flush()
    return review


async def record_ownership_review_action(
    session: AsyncSession,
    *,
    decision_criterion_id: str,
    action: str,
    original_owner_name: str,
    current_owner_name: str,
    review_state: str,
    approval_state: str,
    reviewer_identity: str | None = None,
    review_timestamp: datetime | None = None,
    approval_timestamp: datetime | None = None,
    reason: str | None = None,
    source_surface: str = "LegacyLift workbench",
) -> OwnershipReview:
    review = OwnershipReview(
        decision_criterion_id=decision_criterion_id,
        action=action,
        original_owner_name=original_owner_name,
        current_owner_name=current_owner_name,
        review_state=review_state,
        approval_state=approval_state,
        reviewer_identity=reviewer_identity,
        review_timestamp=review_timestamp,
        approval_timestamp=approval_timestamp,
        reason=reason,
        source_surface=source_surface,
    )
    session.add(review)
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
    custom_group_defs = _project_custom_ownership_groups(project)
    for group_def in custom_group_defs:
        groups.append(
            await upsert_ownership_group(
                session,
                repository_id=repository.id,
                name=group_def["name"],
                description=group_def["description"],
                aliases=group_def["aliases"],
                color=group_def["color"],
                is_default=group_def["is_default"],
            )
        )
    group_by_name = {group.name: group for group in groups}

    rule_by_chunk_id = {str(getattr(rule, "chunk_id", "")): rule for rule in business_rules}
    chunk_ids: set[str] = set()
    criterion_ids: set[str] = set()
    classification_ids: set[str] = set()
    review_ids: set[str] = set()
    guidance_ids: set[str] = set()

    from ownership.classifier import classify_rule_ownership  # noqa: PLC0415
    from ownership.guidance import generate_change_guidance  # noqa: PLC0415

    for chunk in chunks:
        path = str(_get_first(chunk, ("path", "filename"), "unknown"))
        source = str(_get_first(chunk, ("source", "source_code"), ""))
        start_line = int(getattr(chunk, "start_line", 0) or 0)
        end_line = int(getattr(chunk, "end_line", 0) or 0)
        persisted_chunk = await upsert_code_chunk(
            session,
            repository_id=repository.id,
            commit_sha=commit_sha,
            path=path,
            name=str(getattr(chunk, "name", "unknown")),
            language=str(getattr(chunk, "language", "unknown")),
            start_line=start_line,
            end_line=end_line,
            source=source,
        )
        chunk_ids.add(persisted_chunk.id)

        rule = rule_by_chunk_id.get(str(getattr(chunk, "id", "")))
        if rule is None:
            continue

        summary = str(getattr(rule, "rule", "") or "Business rule requires review.")
        title = summary.split(".", 1)[0][:120] or "Business rule"
        original_owner_name = str(getattr(rule, "owner", "Unknown") or "Unknown")
        original_evidence = str(getattr(rule, "owner_reasoning", "") or "")
        hardcoded_values = list(getattr(rule, "key_variables", []) or [])
        extraction_confidence = float(getattr(rule, "confidence", 0.0) or 0.0)
        classification_input = SimpleNamespace(
            id=getattr(rule, "id", None),
            title=title,
            description=summary,
            rule=summary,
            source_file=path,
            filename=path,
            source_lines=(start_line, end_line),
            hardcoded_values=hardcoded_values,
            key_variables=hardcoded_values,
            owner_reasoning=original_evidence,
        )
        ownership = await classify_rule_ownership(
            classification_input,
            groups=custom_group_defs,
        )
        owner_name = ownership.primary_owner
        owner_confidence = _confidence_value(ownership.confidence)

        guidance = generate_change_guidance(
            rule=classification_input,
            ownership=ownership,
            change_text=source,
            hardcoded_values=hardcoded_values,
        )

        criterion = await upsert_decision_criterion(
            session,
            code_chunk_id=persisted_chunk.id,
            summary=summary,
            hardcoded_values=hardcoded_values,
            evidence={
                "layer0_rule_id": getattr(rule, "id", None),
                "chunk_id": getattr(rule, "chunk_id", None),
                "layer0_owner": original_owner_name,
                "layer0_owner_reasoning": original_evidence,
                "owner": owner_name,
                "owner_reasoning": ownership.evidence,
                "matched_signals": ownership.matched_signals,
                "needs_review": bool(getattr(rule, "needs_review", False)),
                "extraction_error": getattr(rule, "extraction_error", None),
            },
            confidence=extraction_confidence,
        )
        criterion_ids.add(criterion.id)

        owner_group = group_by_name.get(owner_name) or group_by_name.get("Unknown")
        classification = await upsert_ownership_classification(
            session,
            decision_criterion_id=criterion.id,
            owner_group_id=owner_group.id if owner_group else None,
            owner_name=owner_name,
            confidence=owner_confidence,
            evidence=ownership.evidence,
            matched_signals=ownership.matched_signals,
            inferred_by="classifier",
        )
        classification_ids.add(classification.id)

        review = await upsert_ownership_review(
            session,
            decision_criterion_id=criterion.id,
            original_owner_name=owner_name,
            current_owner_name=owner_name,
            review_state="inferred",
            approval_state="needed",
        )
        review_ids.add(review.id)

        guidance_row = await upsert_change_guidance(
            session,
            decision_criterion_id=criterion.id,
            risk_summary=guidance.risk_summary,
            primary_approval_group=guidance.primary_approval_group,
            secondary_groups=guidance.secondary_groups,
            approval_checklist=guidance.approval_checklist,
            suggested_tests=guidance.suggested_tests,
            suggested_message=guidance.suggested_message,
            merge_risk=guidance.merge_risk,
        )
        guidance_ids.add(guidance_row.id)

    await session.flush()
    return PersistedLayer0Summary(
        repository_id=repository.id,
        commit_sha=commit_sha,
        chunk_count=len(chunk_ids),
        criterion_count=len(criterion_ids),
        classification_count=len(classification_ids),
        review_count=len(review_ids),
        guidance_count=len(guidance_ids),
    )
