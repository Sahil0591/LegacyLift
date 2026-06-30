from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from sqlalchemy import and_, desc, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import (
    ChangeGuidance,
    CodeChunk,
    Commit,
    DecisionCriterion,
    OwnershipClassification,
    OwnershipReview,
    PullRequest,
    PullRequestChangedFile,
    PullRequestHunk,
    PullRequestHunkMatch,
    Repository,
)
from db.repositories import record_ownership_review_action


class OverlayError(Exception):
    status_code = 400


class OverlayNotFoundError(OverlayError):
    status_code = 404


class OverlayValidationError(OverlayError):
    status_code = 400


@dataclass(frozen=True)
class OverlayLineRange:
    start: int
    end: int


async def query_overlay(
    session: AsyncSession,
    *,
    owner: str,
    repo: str,
    path: str,
    ref: str | None = None,
    pull_number: int | None = None,
    start: int | None = None,
    end: int | None = None,
    visible_lines: str | None = None,
) -> dict[str, Any]:
    if not ref and pull_number is None:
        raise OverlayValidationError("ref or pull_number is required")

    repository = await _repository(session, owner=owner, repo=repo)
    resolved_ref = ref or ""
    pull_request_payload: dict[str, Any] | None = None
    ranges = parse_line_ranges(start=start, end=end, visible_lines=visible_lines)

    if repository is None:
        return _overlay_response(owner=owner, repo=repo, ref=resolved_ref, path=path, annotations=[])

    if pull_number is not None:
        pull_request = await _pull_request(session, repository_id=repository.id, pull_number=pull_number)
        if pull_request is None:
            return _overlay_response(owner=owner, repo=repo, ref=resolved_ref, path=path, annotations=[])
        chunks = await _chunks_for_pull_request(
            session,
            repository_id=repository.id,
            pull_request_id=pull_request.id,
            path=path,
            ranges=ranges,
        )
        resolved_ref = pull_request.head_sha
        pull_request_payload = {"number": pull_request.number, "state": pull_request.state}
    else:
        chunks = await _chunks_for_ref(
            session,
            repository_id=repository.id,
            ref=str(ref),
            path=path,
            ranges=ranges,
        )

    annotations = await _annotations_for_chunks(session, chunks)
    return _overlay_response(
        owner=owner,
        repo=repo,
        ref=resolved_ref,
        path=path,
        annotations=annotations,
        pull_request=pull_request_payload,
    )


async def mutate_overlay_annotation(
    session: AsyncSession,
    *,
    annotation_id: str,
    action: str,
    reviewer_identity: str,
    owner: str | None = None,
    reason: str | None = None,
) -> dict[str, Any]:
    criterion_id = annotation_id.removeprefix("ann_")
    criterion = await _criterion(session, criterion_id)
    if criterion is None:
        raise OverlayNotFoundError("Overlay annotation not found")

    chunk = await _chunk(session, criterion.code_chunk_id)
    if chunk is None:
        raise OverlayNotFoundError("Overlay annotation chunk not found")

    normalized_action = normalize_action(action)
    classification = await _classification(session, criterion.id)
    latest_review = await _latest_review(session, criterion.id)
    inferred_owner = classification.owner_name if classification is not None else "Unknown"
    original_owner = latest_review.original_owner_name if latest_review is not None else inferred_owner
    current_owner = latest_review.current_owner_name if latest_review is not None else inferred_owner
    review_state = latest_review.review_state if latest_review is not None else "pending"
    approval_state = latest_review.approval_state if latest_review is not None else "pending"

    if normalized_action == "confirm_owner":
        review_state = "confirmed"
    elif normalized_action == "reassign_owner":
        if not owner:
            raise OverlayValidationError("reassign_owner requires owner")
        current_owner = owner
        review_state = "reassigned"
    elif normalized_action == "flag":
        review_state = "flagged"
    elif normalized_action == "request_approval":
        approval_state = "requested"
    elif normalized_action == "mark_approved":
        approval_state = "approved"
    elif normalized_action == "waive_approval":
        if not reason:
            raise OverlayValidationError("waive_approval requires a reason")
        approval_state = "waived"
    else:
        raise OverlayValidationError(f"Unsupported overlay action: {action}")

    await record_ownership_review_action(
        session,
        decision_criterion_id=criterion.id,
        action=normalized_action,
        original_owner_name=original_owner,
        current_owner_name=current_owner,
        review_state=review_state,
        approval_state=approval_state,
        reviewer_identity=reviewer_identity,
        reason=reason,
    )
    await session.flush()

    annotation = await _annotation_for_criterion(session, chunk=chunk, criterion=criterion)
    return {"annotation": annotation}


def normalize_action(action: str) -> str:
    normalized = action.strip().lower().replace("-", "_").replace(" ", "_")
    aliases = {
        "confirm": "confirm_owner",
        "confirm_owner": "confirm_owner",
        "reassign": "reassign_owner",
        "reassign_owner": "reassign_owner",
        "flag": "flag",
        "request_approval": "request_approval",
        "mark_approved": "mark_approved",
        "approve": "mark_approved",
        "waive": "waive_approval",
        "waive_approval": "waive_approval",
        "waive_approval_with_reason": "waive_approval",
    }
    return aliases.get(normalized, normalized)


def parse_line_ranges(
    *,
    start: int | None = None,
    end: int | None = None,
    visible_lines: str | None = None,
) -> list[OverlayLineRange]:
    ranges: list[OverlayLineRange] = []
    if visible_lines:
        for raw_part in visible_lines.split(","):
            part = raw_part.strip()
            if not part:
                continue
            if "-" in part:
                raw_start, raw_end = part.split("-", 1)
                ranges.append(_line_range(int(raw_start), int(raw_end)))
            else:
                line = int(part)
                ranges.append(_line_range(line, line))

    if start is not None or end is not None:
        range_start = start if start is not None else end
        range_end = end if end is not None else start
        if range_start is not None and range_end is not None:
            ranges.append(_line_range(range_start, range_end))

    return ranges


async def _repository(session: AsyncSession, *, owner: str, repo: str) -> Repository | None:
    result = await session.execute(
        select(Repository).where(
            Repository.github_owner == owner,
            Repository.github_name == repo,
        )
    )
    return result.scalar_one_or_none()


async def _pull_request(
    session: AsyncSession,
    *,
    repository_id: str,
    pull_number: int,
) -> PullRequest | None:
    result = await session.execute(
        select(PullRequest).where(
            PullRequest.repository_id == repository_id,
            PullRequest.number == pull_number,
        )
    )
    return result.scalar_one_or_none()


async def _chunks_for_ref(
    session: AsyncSession,
    *,
    repository_id: str,
    ref: str,
    path: str,
    ranges: list[OverlayLineRange],
) -> list[CodeChunk]:
    commit_result = await session.execute(
        select(Commit).where(
            Commit.repository_id == repository_id,
            or_(Commit.sha == ref, Commit.ref == ref, Commit.ref == f"refs/heads/{ref}"),
        )
    )
    commit_shas = [commit.sha for commit in commit_result.scalars().all()] or [ref]
    query = select(CodeChunk).where(
        CodeChunk.repository_id == repository_id,
        CodeChunk.commit_sha.in_(commit_shas),
        CodeChunk.path == path,
    )
    if ranges:
        query = query.where(_overlaps_any(CodeChunk.start_line, CodeChunk.end_line, ranges))

    result = await session.execute(query.order_by(CodeChunk.start_line, CodeChunk.end_line))
    return list(result.scalars().all())


async def _chunks_for_pull_request(
    session: AsyncSession,
    *,
    repository_id: str,
    pull_request_id: str,
    path: str,
    ranges: list[OverlayLineRange],
) -> list[CodeChunk]:
    query = (
        select(CodeChunk)
        .join(PullRequestHunkMatch, PullRequestHunkMatch.code_chunk_id == CodeChunk.id)
        .join(PullRequestHunk, PullRequestHunk.id == PullRequestHunkMatch.hunk_id)
        .join(PullRequestChangedFile, PullRequestChangedFile.id == PullRequestHunk.changed_file_id)
        .where(
            CodeChunk.repository_id == repository_id,
            PullRequestChangedFile.pull_request_id == pull_request_id,
            PullRequestHunk.path == path,
        )
    )
    if ranges:
        query = query.where(
            _overlaps_any(
                PullRequestHunkMatch.overlap_start_line,
                PullRequestHunkMatch.overlap_end_line,
                ranges,
            )
        )

    result = await session.execute(query.order_by(CodeChunk.start_line, CodeChunk.end_line))
    chunks_by_id: dict[str, CodeChunk] = {}
    for chunk in result.scalars().all():
        chunks_by_id.setdefault(chunk.id, chunk)
    return list(chunks_by_id.values())


async def _annotations_for_chunks(session: AsyncSession, chunks: list[CodeChunk]) -> list[dict[str, Any]]:
    annotations: list[dict[str, Any]] = []
    for chunk in chunks:
        criteria_result = await session.execute(
            select(DecisionCriterion)
            .where(DecisionCriterion.code_chunk_id == chunk.id)
            .order_by(DecisionCriterion.created_at, DecisionCriterion.id)
        )
        for criterion in criteria_result.scalars().all():
            annotations.append(await _annotation_for_criterion(session, chunk=chunk, criterion=criterion))

    return annotations


async def _annotation_for_criterion(
    session: AsyncSession,
    *,
    chunk: CodeChunk,
    criterion: DecisionCriterion,
) -> dict[str, Any]:
    classification = await _classification(session, criterion.id)
    review = await _latest_review(session, criterion.id)
    guidance = await _guidance(session, criterion.id)
    inferred_owner = classification.owner_name if classification is not None else "Unknown"
    owner = review.current_owner_name if review is not None else inferred_owner
    original_owner = review.original_owner_name if review is not None else inferred_owner

    return {
        "id": f"ann_{criterion.id}",
        "chunk_id": chunk.id,
        "line_range": [chunk.start_line, chunk.end_line],
        "criterion": criterion.summary,
        "owner": owner,
        "original_owner": original_owner,
        "confidence": _confidence_label(classification.confidence if classification is not None else 0.0),
        "evidence": classification.evidence if classification is not None else _criterion_evidence(criterion),
        "review_status": _review_status(review.review_state if review is not None else "pending"),
        "approval_status": _approval_status(review.approval_state if review is not None else "pending"),
        "change_guidance": _guidance_payload(guidance),
        "actions": {
            "can_confirm": True,
            "can_reassign": True,
            "can_flag": True,
            "can_request_approval": True,
            "can_mark_approved": True,
            "can_waive": True,
        },
    }


async def _criterion(session: AsyncSession, criterion_id: str) -> DecisionCriterion | None:
    result = await session.execute(select(DecisionCriterion).where(DecisionCriterion.id == criterion_id))
    return result.scalar_one_or_none()


async def _chunk(session: AsyncSession, chunk_id: str) -> CodeChunk | None:
    result = await session.execute(select(CodeChunk).where(CodeChunk.id == chunk_id))
    return result.scalar_one_or_none()


async def _classification(
    session: AsyncSession,
    decision_criterion_id: str,
) -> OwnershipClassification | None:
    result = await session.execute(
        select(OwnershipClassification).where(
            OwnershipClassification.decision_criterion_id == decision_criterion_id,
            OwnershipClassification.inferred_by == "classifier",
        )
    )
    classification = result.scalar_one_or_none()
    if classification is not None:
        return classification

    fallback = await session.execute(
        select(OwnershipClassification)
        .where(OwnershipClassification.decision_criterion_id == decision_criterion_id)
        .order_by(desc(OwnershipClassification.created_at))
    )
    return fallback.scalars().first()


async def _latest_review(session: AsyncSession, decision_criterion_id: str) -> OwnershipReview | None:
    result = await session.execute(
        select(OwnershipReview)
        .where(OwnershipReview.decision_criterion_id == decision_criterion_id)
        .order_by(desc(OwnershipReview.updated_at), desc(OwnershipReview.created_at), desc(OwnershipReview.id))
    )
    return result.scalars().first()


async def _guidance(session: AsyncSession, decision_criterion_id: str) -> ChangeGuidance | None:
    result = await session.execute(
        select(ChangeGuidance).where(ChangeGuidance.decision_criterion_id == decision_criterion_id)
    )
    return result.scalar_one_or_none()


def _overlay_response(
    *,
    owner: str,
    repo: str,
    ref: str,
    path: str,
    annotations: list[dict[str, Any]],
    pull_request: dict[str, Any] | None = None,
) -> dict[str, Any]:
    response: dict[str, Any] = {
        "repository": {"owner": owner, "repo": repo},
        "ref": ref,
        "path": path,
        "annotations": annotations,
    }
    if pull_request is not None:
        response["pull_request"] = pull_request
    return response


def _line_range(start: int, end: int) -> OverlayLineRange:
    if start <= 0 or end <= 0:
        raise OverlayValidationError("Line ranges must be positive")
    low = min(start, end)
    high = max(start, end)
    return OverlayLineRange(start=low, end=high)


def _overlaps_any(start_column: Any, end_column: Any, ranges: list[OverlayLineRange]) -> Any:
    return or_(*[and_(start_column <= line_range.end, end_column >= line_range.start) for line_range in ranges])


def _confidence_label(confidence: float) -> str:
    if confidence >= 0.75:
        return "High"
    if confidence >= 0.45:
        return "Medium"
    return "Low"


def _criterion_evidence(criterion: DecisionCriterion) -> str:
    evidence = _loads(criterion.evidence_json, {})
    if isinstance(evidence, dict):
        for key in ("owner_reasoning", "layer0_owner_reasoning", "matched"):
            value = evidence.get(key)
            if value:
                return str(value)
    return ""


def _guidance_payload(guidance: ChangeGuidance | None) -> dict[str, Any]:
    if guidance is None:
        return {
            "risk_summary": "",
            "primary_approval_group": "Unknown",
            "secondary_groups": [],
            "approval_checklist": [],
            "suggested_tests": [],
            "suggested_message": "",
        }

    return {
        "risk_summary": guidance.risk_summary,
        "primary_approval_group": guidance.primary_approval_group,
        "secondary_groups": _loads(guidance.secondary_groups_json, []),
        "approval_checklist": _loads(guidance.approval_checklist_json, []),
        "suggested_tests": _loads(guidance.suggested_tests_json, []),
        "suggested_message": guidance.suggested_message,
    }


def _review_status(state: str) -> str:
    return {
        "pending": "Inferred",
        "inferred": "Inferred",
        "confirmed": "Confirmed",
        "reassigned": "Reassigned",
        "flagged": "Flagged",
    }.get(state, state.replace("_", " ").title())


def _approval_status(state: str) -> str:
    return {
        "pending": "Approval needed",
        "requested": "Approval requested",
        "approved": "Approved",
        "waived": "Approval waived",
    }.get(state, state.replace("_", " ").title())


def _loads(raw: str, fallback: Any) -> Any:
    try:
        return json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return fallback
