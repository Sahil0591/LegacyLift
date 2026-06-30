from __future__ import annotations

import os
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel

from db.session import get_session
from integrations.github_overlay import (
    OverlayError,
    mutate_overlay_annotation,
    query_overlay,
)


router = APIRouter(prefix="/github", tags=["github-overlay"])


class OverlayAnnotationMutationRequest(BaseModel):
    action: str
    owner: Optional[str] = None
    reason: Optional[str] = None


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
):
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
    reviewer_identity = (x_legacylift_user or "").strip()
    if not reviewer_identity:
        raise HTTPException(status_code=401, detail="Missing LegacyLift reviewer identity")

    expected_token = os.getenv("OVERLAY_DEV_AUTH_TOKEN", "").strip()
    if expected_token and authorization != f"Bearer {expected_token}":
        raise HTTPException(status_code=401, detail="Invalid LegacyLift overlay token")

    if not expected_token and os.getenv("DEMO_MODE", "true").lower() != "true":
        raise HTTPException(status_code=503, detail="Overlay mutation auth is not configured")

    try:
        async with get_session() as session:
            return await mutate_overlay_annotation(
                session,
                annotation_id=annotation_id,
                action=body.action,
                owner=body.owner,
                reason=body.reason,
                reviewer_identity=reviewer_identity,
            )
    except OverlayError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
