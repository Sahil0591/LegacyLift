"""
api/main.py — FastAPI application entry point and route definitions.

Routes:
    GET    /health                        — health check
    GET    /github/overlay                — GitHub code overlay annotations
    PATCH  /github/overlay/annotation/{id} — mutate overlay review/approval state
    POST   /project                       — create a new project
    POST   /project/{id}/upload           — upload source files
    POST   /project/{id}/start            — kick off the pipeline
    POST   /project/{id}/approve/{chunk_id}  — approve a migration chunk
    POST   /project/{id}/reject/{chunk_id}   — reject a migration chunk
    GET    /project/{id}/status           — get project status
    GET    /project/{id}/rules            — get extracted business rules
    GET    /project/{id}/graph            — get dependency graph
    WS     /ws/{project_id}              — WebSocket stream for a project
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Optional

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, File, Header, HTTPException, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import text

from api.github_overlay import router as github_overlay_router
from api.websocket_manager import manager as ws_manager
from core.pipeline import run_pipeline, run_migration_generation, _transition
from db.session import get_session, init_db
from integrations.github_app import GitHubAppSettings, verify_webhook_signature
from integrations.github_ingestion import process_github_webhook
from models.project import Project, ProjectStatus, SourceLanguage, UploadedFile
from ownership.review_workflow import (
    REVIEW_CONFIRMED,
    REVIEW_FLAGGED,
    ReviewWorkflowError,
    ReviewWorkflowState,
    WORKBENCH_SURFACE,
    apply_review_transition,
    approval_state_label,
    review_state_label,
    transition_payload,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# In-memory storage
# ---------------------------------------------------------------------------

projects: dict[str, Project] = {}
active_pipelines: dict[str, asyncio.Task] = {}


# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )
    print("=" * 60)
    print("  LegacyLift API starting up")
    print(f"  DEMO_MODE:    {os.getenv('DEMO_MODE', 'true')}")
    print(f"  LLM MODEL:    {os.getenv('VENICE_MODEL', 'openai-gpt-52-codex')}")
    print(f"  AUTO_APPROVE: {os.getenv('AUTO_APPROVE', 'false')}")
    print("=" * 60)
    await init_db()
    yield
    print("LegacyLift API shutting down...")


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(
    title="LegacyLift API",
    description="AI-assisted legacy code migration workbench",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS — specific origins for production safety
_allow_origins = [
    "http://localhost:3000",          # Next.js dev
    "http://127.0.0.1:3000",          # Next.js dev via IPv4 loopback
    "https://github.com",             # Chromium extension content script origin
    "https://legacylift.vercel.app",  # production
]
if os.getenv("FRONTEND_URL"):
    _allow_origins.append(os.environ["FRONTEND_URL"])

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allow_origins,
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(github_overlay_router)


# ---------------------------------------------------------------------------
# Request/Response models
# ---------------------------------------------------------------------------

class CreateProjectRequest(BaseModel):
    name: str = "Untitled"
    source_language: SourceLanguage = SourceLanguage.COBOL
    target_language: str = "Python"


class ApproveChunkRequest(BaseModel):
    comment: Optional[str] = None


class RejectChunkRequest(BaseModel):
    comment: str
    feedback: Optional[str] = None


class RuleReviewRequest(BaseModel):
    action: str = "confirm_owner"
    owner: Optional[str] = None
    reason: Optional[str] = None
    reviewer_identity: Optional[str] = None
    allow_unknown_owner: bool = False
    source_surface: str = WORKBENCH_SURFACE


# ---------------------------------------------------------------------------
# GET /health
# ---------------------------------------------------------------------------

@app.get("/health")
async def health_check():
    try:
        async with get_session() as session:
            await session.execute(text("SELECT 1"))
    except Exception as exc:
        logger.exception("health_check database=unavailable")
        return JSONResponse(
            status_code=503,
            content={
                "status": "error",
                "version": "0.1.0",
                "database": {"status": "unavailable", "error": str(exc)},
            },
        )

    return {"status": "ok", "version": "0.1.0", "database": {"status": "ok"}}


# ---------------------------------------------------------------------------
# POST /github/webhook
# ---------------------------------------------------------------------------

@app.post("/github/webhook", status_code=202)
async def github_webhook(
    request: Request,
    x_github_event: str = Header(..., alias="X-GitHub-Event"),
    x_github_delivery: str = Header(..., alias="X-GitHub-Delivery"),
    x_hub_signature_256: str | None = Header(None, alias="X-Hub-Signature-256"),
):
    settings = GitHubAppSettings.from_env()
    body = await request.body()
    if not verify_webhook_signature(body, x_hub_signature_256, settings.webhook_secret):
        _log_webhook_outcome(
            event=x_github_event,
            delivery_id=x_github_delivery,
            repository="unknown",
            outcome="invalid_signature",
        )
        raise HTTPException(status_code=401, detail="Invalid GitHub webhook signature")

    try:
        payload = json.loads(body.decode("utf-8"))
    except json.JSONDecodeError as exc:
        _log_webhook_outcome(
            event=x_github_event,
            delivery_id=x_github_delivery,
            repository="unknown",
            outcome="invalid_json",
        )
        raise HTTPException(status_code=400, detail="Invalid GitHub webhook JSON") from exc

    async with get_session() as session:
        result = await process_github_webhook(
            session,
            event=x_github_event,
            delivery_id=x_github_delivery,
            payload=payload,
            raw_body=body,
        )

    repository = _github_payload_repository(payload)
    outcome = str(result.get("status", "unknown"))
    _log_webhook_outcome(
        event=x_github_event,
        delivery_id=x_github_delivery,
        repository=repository,
        outcome=outcome,
    )
    if outcome == "duplicate":
        return JSONResponse(
            status_code=409,
            content={
                "detail": "Duplicate GitHub webhook delivery",
                "delivery_id": x_github_delivery,
            },
        )

    return JSONResponse(status_code=202, content=result)


def _github_payload_repository(payload: dict) -> str:
    repository = payload.get("repository")
    if isinstance(repository, dict):
        full_name = repository.get("full_name")
        if full_name:
            return str(full_name)

    repositories = payload.get("repositories")
    if isinstance(repositories, list) and repositories:
        first = repositories[0]
        if isinstance(first, dict) and first.get("full_name"):
            count = len(repositories)
            suffix = f" (+{count - 1})" if count > 1 else ""
            return f"{first['full_name']}{suffix}"

    return "unknown"


def _log_webhook_outcome(
    *,
    event: str,
    delivery_id: str,
    repository: str,
    outcome: str,
) -> None:
    log = logger.warning if outcome in {"duplicate", "invalid_signature", "invalid_json"} else logger.info
    log(
        "github_webhook event=%s delivery_id=%s repository=%s outcome=%s",
        event,
        delivery_id,
        repository,
        outcome,
    )


# ---------------------------------------------------------------------------
# POST /project
# ---------------------------------------------------------------------------

@app.post("/project", status_code=201)
async def create_project(body: CreateProjectRequest):
    """Create a new migration project. Returns id, name, status, created_at."""
    try:
        project = Project(
            name=body.name,
            source_language=body.source_language,
            target_language=body.target_language,
        )
        projects[project.id] = project
        return {
            "project_id": project.id,
            "name": project.name,
            "status": _status_str(project),
            "created_at": project.created_at.isoformat(),
        }
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# ---------------------------------------------------------------------------
# POST /project/{id}/upload
# ---------------------------------------------------------------------------

@app.post("/project/{project_id}/upload", status_code=200)
async def upload_files(
    project_id: str,
    files: list[UploadFile] = File(...),
):
    """Upload one or more legacy source files. Stores content keyed by filename."""
    project = _get_project(project_id)

    filenames: list[str] = []
    for upload in files:
        try:
            content = (await upload.read()).decode("utf-8", errors="replace")
            filename = upload.filename or "unnamed.txt"
            f = UploadedFile(
                filename=filename,
                language=project.source_language,
                content=content,
                size_bytes=len(content.encode("utf-8")),
            )
            project.files.append(f)
            project.uploaded_files[filename] = content
            filenames.append(filename)
        except Exception as exc:
            raise HTTPException(
                status_code=400,
                detail=f"Failed to process {upload.filename}: {exc}",
            )

    if _status_str(project) == "created":
        project.status = "uploading"

    return {
        "project_id": project_id,
        "files_uploaded": filenames,
        "file_count": len(filenames),
    }


# ---------------------------------------------------------------------------
# POST /project/{id}/start
# ---------------------------------------------------------------------------

@app.post("/project/{project_id}/start", status_code=202)
async def start_pipeline(project_id: str):
    """Start the migration pipeline. Returns 202 immediately; progress via WebSocket."""
    project = _get_project(project_id)

    current = _status_str(project)
    if current not in ("created", "uploading"):
        raise HTTPException(
            status_code=409,
            detail=f"Pipeline already started (status: {current})",
        )

    task = asyncio.create_task(run_pipeline(project))
    active_pipelines[project_id] = task

    return JSONResponse(
        status_code=202,
        content={
            "status": "accepted",
            "project_id": project_id,
            "message": "Pipeline started",
        },
    )


# ---------------------------------------------------------------------------
# POST /project/{id}/approve/{chunk_id}
# ---------------------------------------------------------------------------

@app.post("/project/{project_id}/approve/{chunk_id}", status_code=200)
async def approve_chunk(
    project_id: str,
    chunk_id: str,
    body: ApproveChunkRequest = ApproveChunkRequest(),
):
    """
    Approve a migration chunk.

    Works both during an active pipeline (resolves the approval gate) and
    after the pipeline has finished (records the decision for audit).
    """
    project = _get_project(project_id)
    project.chunk_approvals[chunk_id] = "approved"
    await ws_manager.emit(project.id, "chunk_approved", chunk_id=chunk_id)

    all_approved = bool(project.layer0_chunks) and all(
        project.chunk_approvals.get(c["id"]) == "approved"
        for c in project.layer0_chunks
    )
    approved_count = sum(
        1 for decision in project.chunk_approvals.values() if decision == "approved"
    )
    if all_approved:
        await _transition(project, "validating")
        await _transition(project, "complete")
        project.completed_at = datetime.utcnow()
        await ws_manager.emit(
            project.id,
            "migration_complete",
            report={
                "project_id": project.id,
                "project_name": project.name,
                "chunks_total": len(project.layer0_chunks),
                "chunks_approved": approved_count,
            },
        )
    else:
        await _transition(project, "ready")
        await ws_manager.emit(project.id, "ready_for_next_chunk")

    return {
        "project_id": project_id,
        "chunk_id": chunk_id,
        "decision": "approved",
        "comment": body.comment,
    }


# ---------------------------------------------------------------------------
# POST /project/{id}/reject/{chunk_id}
# ---------------------------------------------------------------------------

@app.post("/project/{project_id}/reject/{chunk_id}", status_code=200)
async def reject_chunk(
    project_id: str,
    chunk_id: str,
    body: RejectChunkRequest,
):
    """Reject a migration chunk with required comment and optional feedback."""
    project = _get_project(project_id)
    project.chunk_approvals[chunk_id] = "rejected"
    await _transition(project, "ready")
    await ws_manager.emit(
        project.id,
        "chunk_rejected",
        chunk_id=chunk_id,
        feedback=body.feedback or body.comment,
    )

    return {
        "project_id": project_id,
        "chunk_id": chunk_id,
        "decision": "rejected",
        "feedback": body.feedback or body.comment,
    }


# ---------------------------------------------------------------------------
# POST /project/{id}/confirm-rule/{chunk_id}
# ---------------------------------------------------------------------------

@app.post("/project/{project_id}/confirm-rule/{chunk_id}", status_code=200)
async def confirm_rule(
    project_id: str,
    chunk_id: str,
    body: RuleReviewRequest | None = None,
):
    """
    Mark the business rule for a chunk as Confirmed by a domain expert.

    Must be called before select-chunk — the chunk selection endpoint rejects
    requests where the rule has not been confirmed.
    """
    project = _get_project(project_id)
    request_body = body or RuleReviewRequest()

    chunk_dict = next(
        (c for c in project.layer0_chunks if c["id"] == chunk_id), None
    )
    if chunk_dict is None:
        raise HTTPException(status_code=404, detail=f"Chunk '{chunk_id}' not found")

    rule_dict = _rule_for_chunk(project, chunk_id)
    existing = project.chunk_rule_reviews.get(chunk_id)
    inferred_owner = _inferred_rule_owner(rule_dict)
    state = ReviewWorkflowState(
        original_owner_name=str(existing.get("original_owner", inferred_owner)) if existing else inferred_owner,
        current_owner_name=str(existing.get("current_owner", inferred_owner)) if existing else inferred_owner,
        review_state=str(existing.get("review_state", "inferred")) if existing else "inferred",
        approval_state=str(existing.get("approval_state", "needed")) if existing else "needed",
    )

    try:
        transition = apply_review_transition(
            state,
            action=request_body.action,
            owner=request_body.owner,
            reason=request_body.reason,
            reviewer_identity=request_body.reviewer_identity,
            source_surface=request_body.source_surface or WORKBENCH_SURFACE,
            allow_unknown_owner=request_body.allow_unknown_owner,
        )
    except ReviewWorkflowError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    audit_trail = list(existing.get("audit_trail", [])) if existing else []
    audit_trail.append(transition_payload(transition))
    project.chunk_rule_reviews[chunk_id] = {
        "original_owner": transition.original_owner_name,
        "current_owner": transition.current_owner_name,
        "review_state": transition.review_state,
        "approval_state": transition.approval_state,
        "reviewed_at": transition.reviewed_at.isoformat(),
        "approval_timestamp": transition.approval_timestamp.isoformat()
        if transition.approval_timestamp is not None
        else (existing or {}).get("approval_timestamp"),
        "audit_trail": audit_trail,
    }

    project.chunk_rule_statuses[chunk_id] = review_state_label(transition.review_state)

    return {
        "project_id": project_id,
        "chunk_id": chunk_id,
        "rule_status": review_state_label(transition.review_state),
        "review_state": review_state_label(transition.review_state),
        "approval_state": approval_state_label(transition.approval_state),
        "original_owner": transition.original_owner_name,
        "current_owner": transition.current_owner_name,
        "reviewer_identity": transition.reviewer_identity,
        "reviewed_at": transition.reviewed_at.isoformat(),
        "approval_timestamp": transition.approval_timestamp.isoformat()
        if transition.approval_timestamp is not None
        else None,
        "reason": transition.reason,
        "source_surface": transition.source_surface,
        "audit_trail": audit_trail,
    }


# ---------------------------------------------------------------------------
# POST /project/{id}/select-chunk/{chunk_id}
# ---------------------------------------------------------------------------

@app.post("/project/{project_id}/select-chunk/{chunk_id}", status_code=202)
async def select_chunk(project_id: str, chunk_id: str):
    """
    Select a Layer 0 chunk for migration.

    Validates:
      - Project is in 'ready' state (Layer 0 complete)
      - chunk_id exists in Layer 0 output
      - Business rule for this chunk has been Confirmed by a domain expert

    On success:
      - Transitions project to 'migrating'
      - Fires a background task that calls generate_migration() then Layer 1
      - Broadcasts { event: 'chunk_selected', chunk_id }
      - Returns 202 immediately
    """
    project = _get_project(project_id)

    current = _status_str(project)
    if current not in ("ready", "migrating"):
        raise HTTPException(
            status_code=409,
            detail=f"Project must be ready to select a chunk (current: {current})",
        )

    chunk_dict = next(
        (c for c in project.layer0_chunks if c["id"] == chunk_id), None
    )
    if chunk_dict is None:
        raise HTTPException(
            status_code=404, detail=f"Chunk '{chunk_id}' not found in Layer 0 output"
        )
    if project.chunk_approvals.get(chunk_id) == "approved":
        raise HTTPException(
            status_code=409, detail=f"Chunk '{chunk_id}' is already approved"
        )

    review = project.chunk_rule_reviews.get(chunk_id, {})
    if review.get("review_state") == REVIEW_FLAGGED or project.chunk_rule_statuses.get(chunk_id) == "Flagged":
        raise HTTPException(
            status_code=400,
            detail="Business rule is flagged and must be resolved before migration can begin",
        )

    rule_status = project.chunk_rule_statuses.get(chunk_id, "Pending")
    if rule_status not in ("Confirmed", "Reassigned"):
        raise HTTPException(
            status_code=400,
            detail="Business rule must be confirmed before migration can begin",
        )

    project.selected_chunk_id = chunk_id
    await _transition(project, "migrating")

    asyncio.create_task(run_migration_generation(project, chunk_id))

    await ws_manager.emit(project.id, "chunk_selected", chunk_id=chunk_id)

    return JSONResponse(
        status_code=202,
        content={
            "status": "accepted",
            "chunk_id": chunk_id,
            "message": "Migration generation started",
        },
    )


# ---------------------------------------------------------------------------
# GET /project/{id}/status
# ---------------------------------------------------------------------------

@app.get("/project/{project_id}/status")
async def get_project_status(project_id: str):
    project = _get_project(project_id)
    return {
        "project_id":         project.id,
        "status":             _status_str(project),
        "started_at":         project.started_at.isoformat() if project.started_at else None,
        "completed_at":       project.completed_at.isoformat() if project.completed_at else None,
        "chunk_count":        project.chunk_count,
        "risk_summary":       project.risk_summary,
        "needs_review_count": project.needs_review_count,
        "error":              project.error,
    }


# ---------------------------------------------------------------------------
# GET /project/{id}/rules
# ---------------------------------------------------------------------------

@app.get("/project/{project_id}/rules")
async def get_business_rules(project_id: str):
    project = _get_project(project_id)
    rules = project.layer0_rules
    return {
        "project_id": project_id,
        "status":     _status_str(project),
        "rule_count": len(rules),
        "rules":      rules,
    }


# ---------------------------------------------------------------------------
# GET /project/{id}/graph
# ---------------------------------------------------------------------------

@app.get("/project/{project_id}/graph")
async def get_dependency_graph(project_id: str):
    project = _get_project(project_id)
    graph = project.layer0_graph
    nodes = graph.get("nodes", [])
    edges = graph.get("edges", [])
    return {
        "project_id": project_id,
        "node_count": len(nodes),
        "edge_count": len(edges),
        "nodes":      nodes,
        "edges":      edges,
    }


# ---------------------------------------------------------------------------
# WS /ws/{project_id}
# ---------------------------------------------------------------------------

@app.websocket("/ws/{project_id}")
async def websocket_endpoint(websocket: WebSocket, project_id: str):
    """
    WebSocket stream for real-time pipeline events.

    Past events are replayed on connect so clients can reconstruct state
    even if they connect after the pipeline has started.
    """
    await ws_manager.connect(project_id, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        await ws_manager.disconnect(project_id, websocket)
    except Exception as e:
        logger.error("WS error %s: %s", project_id, e)
        await ws_manager.disconnect(project_id, websocket)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_project(project_id: str) -> Project:
    project = projects.get(project_id)
    if not project:
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found")
    return project


def _rule_for_chunk(project: Project, chunk_id: str) -> dict | None:
    return next((r for r in project.layer0_rules if r.get("chunk_id") == chunk_id), None)


def _inferred_rule_owner(rule: dict | None) -> str:
    if not rule:
        return "Unknown"
    for key in ("ownership_category", "owner", "current_owner"):
        value = rule.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    detail = rule.get("ownership_detail")
    if isinstance(detail, dict):
        owner = detail.get("primary_owner")
        if isinstance(owner, str) and owner.strip():
            return owner.strip()
    return "Unknown"


def _status_str(project: Project) -> str:
    s = project.status
    return s if isinstance(s, str) else s.value
