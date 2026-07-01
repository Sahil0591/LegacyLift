from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime


REVIEW_INFERRED = "inferred"
REVIEW_CONFIRMED = "confirmed"
REVIEW_REASSIGNED = "reassigned"
REVIEW_FLAGGED = "flagged"

APPROVAL_NEEDED = "needed"
APPROVAL_REQUESTED = "requested"
APPROVAL_APPROVED = "approved"
APPROVAL_WAIVED = "waived"

GITHUB_OVERLAY_SURFACE = "GitHub overlay"
WORKBENCH_SURFACE = "LegacyLift workbench"


class ReviewWorkflowError(ValueError):
    pass


@dataclass(frozen=True)
class ReviewWorkflowState:
    original_owner_name: str
    current_owner_name: str
    review_state: str = REVIEW_INFERRED
    approval_state: str = APPROVAL_NEEDED


@dataclass(frozen=True)
class ReviewWorkflowTransition:
    action: str
    original_owner_name: str
    current_owner_name: str
    review_state: str
    approval_state: str
    reviewer_identity: str | None
    reason: str | None
    source_surface: str
    reviewed_at: datetime
    approval_timestamp: datetime | None


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


def apply_review_transition(
    state: ReviewWorkflowState,
    *,
    action: str,
    reviewer_identity: str | None = None,
    owner: str | None = None,
    reason: str | None = None,
    source_surface: str = WORKBENCH_SURFACE,
    allow_unknown_owner: bool = False,
) -> ReviewWorkflowTransition:
    normalized_action = normalize_action(action)
    current_owner = state.current_owner_name or "Unknown"
    review_state = normalize_review_state(state.review_state)
    approval_state = normalize_approval_state(state.approval_state)
    timestamp = datetime.now(UTC)
    approval_timestamp: datetime | None = None
    clean_reason = reason.strip() if isinstance(reason, str) and reason.strip() else None

    if normalized_action == "confirm_owner":
        if current_owner == "Unknown" and not allow_unknown_owner:
            raise ReviewWorkflowError("Unknown owner requires explicit confirmation before migration")
        review_state = REVIEW_CONFIRMED
    elif normalized_action == "reassign_owner":
        if not owner or not owner.strip():
            raise ReviewWorkflowError("reassign_owner requires owner")
        current_owner = owner.strip()
        review_state = REVIEW_REASSIGNED
    elif normalized_action == "flag":
        review_state = REVIEW_FLAGGED
    elif normalized_action == "request_approval":
        approval_state = APPROVAL_REQUESTED
        approval_timestamp = timestamp
    elif normalized_action == "mark_approved":
        approval_state = APPROVAL_APPROVED
        approval_timestamp = timestamp
    elif normalized_action == "waive_approval":
        if not clean_reason:
            raise ReviewWorkflowError("waive_approval requires a reason")
        approval_state = APPROVAL_WAIVED
        approval_timestamp = timestamp
    else:
        raise ReviewWorkflowError(f"Unsupported overlay action: {action}")

    return ReviewWorkflowTransition(
        action=normalized_action,
        original_owner_name=state.original_owner_name or "Unknown",
        current_owner_name=current_owner,
        review_state=review_state,
        approval_state=approval_state,
        reviewer_identity=reviewer_identity.strip() if isinstance(reviewer_identity, str) and reviewer_identity.strip() else None,
        reason=clean_reason,
        source_surface=source_surface,
        reviewed_at=timestamp,
        approval_timestamp=approval_timestamp,
    )


def normalize_review_state(state: str | None) -> str:
    normalized = str(state or "").strip().lower().replace(" ", "_")
    if normalized in ("pending", "inferred", ""):
        return REVIEW_INFERRED
    if normalized in (REVIEW_CONFIRMED, REVIEW_REASSIGNED, REVIEW_FLAGGED):
        return normalized
    return normalized


def normalize_approval_state(state: str | None) -> str:
    normalized = str(state or "").strip().lower().replace(" ", "_")
    if normalized in ("pending", "approval_needed", "needed", ""):
        return APPROVAL_NEEDED
    if normalized in ("approval_requested", APPROVAL_REQUESTED):
        return APPROVAL_REQUESTED
    if normalized == APPROVAL_APPROVED:
        return APPROVAL_APPROVED
    if normalized in ("approval_waived", APPROVAL_WAIVED):
        return APPROVAL_WAIVED
    return normalized


def review_state_label(state: str | None) -> str:
    return {
        REVIEW_INFERRED: "Inferred",
        REVIEW_CONFIRMED: "Confirmed",
        REVIEW_REASSIGNED: "Reassigned",
        REVIEW_FLAGGED: "Flagged",
    }.get(normalize_review_state(state), str(state or "").replace("_", " ").title())


def approval_state_label(state: str | None) -> str:
    return {
        APPROVAL_NEEDED: "Approval needed",
        APPROVAL_REQUESTED: "Approval requested",
        APPROVAL_APPROVED: "Approved",
        APPROVAL_WAIVED: "Waived",
    }.get(normalize_approval_state(state), str(state or "").replace("_", " ").title())


def transition_payload(transition: ReviewWorkflowTransition) -> dict:
    return {
        "action": transition.action,
        "original_owner": transition.original_owner_name,
        "current_owner": transition.current_owner_name,
        "review_state": review_state_label(transition.review_state),
        "approval_state": approval_state_label(transition.approval_state),
        "reviewer_identity": transition.reviewer_identity,
        "reason": transition.reason,
        "source_surface": transition.source_surface,
        "reviewed_at": transition.reviewed_at.isoformat(),
        "approval_timestamp": transition.approval_timestamp.isoformat()
        if transition.approval_timestamp is not None
        else None,
    }
