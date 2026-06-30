from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel

from db.session import get_session
from integrations.github_overlay import (
    OverlayError,
    mutate_overlay_annotation,
    query_overlay,
    repository_for_annotation,
)


router = APIRouter(prefix="/github", tags=["github-overlay"])


class OverlayAnnotationMutationRequest(BaseModel):
    action: str
    owner: Optional[str] = None
    reason: Optional[str] = None


@dataclass(frozen=True)
class OverlayAuthContext:
    reviewer_identity: str


_RATE_LIMIT_BUCKETS: dict[tuple[str, str], list[float]] = {}


def reset_overlay_rate_limiter() -> None:
    _RATE_LIMIT_BUCKETS.clear()


def _demo_mode_enabled() -> bool:
    return os.getenv("DEMO_MODE", "true").lower() == "true"


def _overlay_auth_required() -> bool:
    return (
        os.getenv("OVERLAY_REQUIRE_AUTH", "").lower() == "true"
        or bool(os.getenv("OVERLAY_DEV_AUTH_TOKEN", "").strip())
        or bool(os.getenv("OVERLAY_ALLOWED_REPOS_BY_USER", "").strip())
        or not _demo_mode_enabled()
    )


def _authenticate_overlay_request(
    *,
    authorization: str | None,
    x_legacylift_user: str | None,
    require_identity: bool = False,
) -> OverlayAuthContext:
    reviewer_identity = (x_legacylift_user or "").strip()
    auth_required = _overlay_auth_required()

    if (auth_required or require_identity) and not reviewer_identity:
        raise HTTPException(status_code=401, detail="Missing LegacyLift reviewer identity")

    expected_token = os.getenv("OVERLAY_DEV_AUTH_TOKEN", "").strip()
    if expected_token and authorization != f"Bearer {expected_token}":
        raise HTTPException(status_code=401, detail="Invalid LegacyLift overlay token")

    if auth_required and not expected_token and not _demo_mode_enabled():
        raise HTTPException(status_code=503, detail="Overlay auth is not configured")

    return OverlayAuthContext(reviewer_identity=reviewer_identity or "anonymous")


def _allowed_repositories_by_user() -> dict[str, list[str]]:
    raw = os.getenv("OVERLAY_ALLOWED_REPOS_BY_USER", "").strip()
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=503, detail="Overlay repo permission map is invalid JSON") from exc

    if not isinstance(parsed, dict):
        raise HTTPException(status_code=503, detail="Overlay repo permission map must be a JSON object")

    permissions: dict[str, list[str]] = {}
    for user, repos in parsed.items():
        if isinstance(repos, str):
            permissions[str(user).casefold()] = [repos.casefold()]
        elif isinstance(repos, list):
            permissions[str(user).casefold()] = [str(repo).casefold() for repo in repos]
    return permissions


def _repo_allowed(pattern: str, owner: str, repo: str) -> bool:
    target = f"{owner}/{repo}".casefold()
    pattern = pattern.casefold()
    if pattern == "*":
        return True
    if pattern.endswith("/*"):
        return target.startswith(pattern[:-1])
    return pattern == target


def _authorize_repository_access(auth: OverlayAuthContext, *, owner: str, repo: str) -> None:
    permissions = _allowed_repositories_by_user()
    if not permissions:
        return

    allowed = permissions.get(auth.reviewer_identity.casefold(), [])
    if not any(_repo_allowed(pattern, owner, repo) for pattern in allowed):
        raise HTTPException(status_code=403, detail="LegacyLift reviewer is not authorized for this repository")


def _enforce_overlay_rate_limit(auth: OverlayAuthContext, *, operation: str) -> None:
    raw_limit = os.getenv("OVERLAY_RATE_LIMIT_PER_MINUTE", "120").strip()
    try:
        limit = int(raw_limit)
    except ValueError as exc:
        raise HTTPException(status_code=503, detail="Overlay rate limit is invalid") from exc

    if limit <= 0:
        return

    now = time.monotonic()
    key = (auth.reviewer_identity.casefold(), operation)
    window_start = now - 60
    bucket = [stamp for stamp in _RATE_LIMIT_BUCKETS.get(key, []) if stamp >= window_start]
    if len(bucket) >= limit:
        _RATE_LIMIT_BUCKETS[key] = bucket
        raise HTTPException(status_code=429, detail="LegacyLift overlay rate limit exceeded")

    bucket.append(now)
    _RATE_LIMIT_BUCKETS[key] = bucket


@router.get("/overlay")
async def get_github_overlay(
    owner: str = Query(...),
    repo: str = Query(...),
    path: str = Query(...),
    ref: Optional[str] = Query(None),
    pull_number: Optional[int] = Query(None),
    start: Optional[int] = Query(None),
    end: Optional[int] = Query(None),
    visible_lines: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None, alias="Authorization"),
    x_legacylift_user: Optional[str] = Header(None, alias="X-LegacyLift-User"),
):
    auth = _authenticate_overlay_request(
        authorization=authorization,
        x_legacylift_user=x_legacylift_user,
    )
    _authorize_repository_access(auth, owner=owner, repo=repo)
    _enforce_overlay_rate_limit(auth, operation="read")

    try:
        async with get_session() as session:
            return await query_overlay(
                session,
                owner=owner,
                repo=repo,
                path=path,
                ref=ref,
                pull_number=pull_number,
                start=start,
                end=end,
                visible_lines=visible_lines,
            )
    except OverlayError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.patch("/overlay/annotation/{annotation_id}")
async def patch_github_overlay_annotation(
    annotation_id: str,
    body: OverlayAnnotationMutationRequest,
    authorization: Optional[str] = Header(None, alias="Authorization"),
    x_legacylift_user: Optional[str] = Header(None, alias="X-LegacyLift-User"),
):
    auth = _authenticate_overlay_request(
        authorization=authorization,
        x_legacylift_user=x_legacylift_user,
        require_identity=True,
    )
    _enforce_overlay_rate_limit(auth, operation="mutation")

    try:
        async with get_session() as session:
            repository = await repository_for_annotation(session, annotation_id=annotation_id)
            if repository is not None:
                _authorize_repository_access(
                    auth,
                    owner=repository.github_owner,
                    repo=repository.github_name,
                )
                if not repository.is_active or not repository.installation_id:
                    raise HTTPException(status_code=404, detail="Overlay annotation not found")

            return await mutate_overlay_annotation(
                session,
                annotation_id=annotation_id,
                action=body.action,
                owner=body.owner,
                reason=body.reason,
                reviewer_identity=auth.reviewer_identity,
            )
    except OverlayError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
