"""
api/main.py — FastAPI application entry point and route definitions.

Routes:
    GET    /health                        — health check
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
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Optional

from dotenv import find_dotenv, load_dotenv

load_dotenv(find_dotenv(usecwd=True))

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from api.auth import get_current_user_id
from api.websocket_manager import manager as ws_manager
from core.pipeline import run_pipeline, run_migration_generation, _transition
from core.storage import storage
from models.project import Project, SourceLanguage, UploadedFile

logger = logging.getLogger(__name__)

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
    await storage.load()
    yield
    await storage.persist()
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


# ---------------------------------------------------------------------------
# GET /health
# ---------------------------------------------------------------------------

@app.get("/health")
async def health_check():
    return {"status": "ok", "version": "0.1.0"}


# ---------------------------------------------------------------------------
# POST /project
# ---------------------------------------------------------------------------

@app.post("/project", status_code=201)
async def create_project(body: CreateProjectRequest, user_id: str = Depends(get_current_user_id)):
    """Create a new migration project. Returns id, name, status, created_at."""
    try:
        project = Project(
            name=body.name,
            source_language=body.source_language,
            target_language=body.target_language,
            owner_id=user_id,
        )
        if not storage.can_create_project(user_id):
            raise HTTPException(
                status_code=429,
                detail="Project limit reached. Delete an existing project to create a new one.",
            )
        storage.put(project)
        storage.increment_projects_used(user_id)
        asyncio.ensure_future(storage.persist())
        return {
            "project_id": project.id,
            "name": project.name,
            "status": _status_str(project),
            "created_at": project.created_at.isoformat(),
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# ---------------------------------------------------------------------------
# POST /project/{id}/upload
# ---------------------------------------------------------------------------

@app.post("/project/{project_id}/upload", status_code=200)
async def upload_files(
    project_id: str,
    files: list[UploadFile] = File(...),
    user_id: str = Depends(get_current_user_id),
):
    """Upload one or more legacy source files. Stores content keyed by filename."""
    project = _get_project(project_id, user_id)

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

    asyncio.ensure_future(storage.persist())
    return {
        "project_id": project_id,
        "files_uploaded": filenames,
        "file_count": len(filenames),
    }


# ---------------------------------------------------------------------------
# POST /project/{id}/start
# ---------------------------------------------------------------------------

@app.post("/project/{project_id}/start", status_code=202)
async def start_pipeline(project_id: str, user_id: str = Depends(get_current_user_id)):
    """Start the migration pipeline. Returns 202 immediately; progress via WebSocket."""
    project = _get_project(project_id, user_id)

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
    user_id: str = Depends(get_current_user_id),
):
    """
    Approve a migration chunk.

    Works both during an active pipeline (resolves the approval gate) and
    after the pipeline has finished (records the decision for audit).
    """
    project = _get_project(project_id, user_id)
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
        project.completed_at = datetime.now(timezone.utc)
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

    asyncio.ensure_future(storage.persist())
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
    user_id: str = Depends(get_current_user_id),
):
    """Reject a migration chunk with required comment and optional feedback."""
    project = _get_project(project_id, user_id)
    project.chunk_approvals[chunk_id] = "rejected"
    await _transition(project, "ready")
    await ws_manager.emit(
        project.id,
        "chunk_rejected",
        chunk_id=chunk_id,
        feedback=body.feedback or body.comment,
    )

    asyncio.ensure_future(storage.persist())
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
async def confirm_rule(project_id: str, chunk_id: str, user_id: str = Depends(get_current_user_id)):
    """
    Mark the business rule for a chunk as Confirmed by a domain expert.

    Must be called before select-chunk — the chunk selection endpoint rejects
    requests where the rule has not been confirmed.
    """
    project = _get_project(project_id, user_id)

    chunk_dict = next(
        (c for c in project.layer0_chunks if c["id"] == chunk_id), None
    )
    if chunk_dict is None:
        raise HTTPException(status_code=404, detail=f"Chunk '{chunk_id}' not found")

    project.chunk_rule_statuses[chunk_id] = "Confirmed"

    return {
        "project_id": project_id,
        "chunk_id": chunk_id,
        "rule_status": "Confirmed",
    }


# ---------------------------------------------------------------------------
# POST /project/{id}/select-chunk/{chunk_id}
# ---------------------------------------------------------------------------

@app.post("/project/{project_id}/select-chunk/{chunk_id}", status_code=202)
async def select_chunk(project_id: str, chunk_id: str, user_id: str = Depends(get_current_user_id)):
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
    project = _get_project(project_id, user_id)

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

    rule_status = project.chunk_rule_statuses.get(chunk_id, "Pending")
    if rule_status != "Confirmed":
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
async def get_project_status(project_id: str, user_id: str = Depends(get_current_user_id)):
    project = _get_project(project_id, user_id)
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
async def get_business_rules(project_id: str, user_id: str = Depends(get_current_user_id)):
    project = _get_project(project_id, user_id)
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
async def get_dependency_graph(project_id: str, user_id: str = Depends(get_current_user_id)):
    project = _get_project(project_id, user_id)
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
# GET /projects
# ---------------------------------------------------------------------------

@app.get("/projects")
async def list_projects(user_id: str = Depends(get_current_user_id)):
    """Return a summary of all projects belonging to the authenticated user."""
    projects = storage.list_for_user(user_id)
    return {
        "projects": [
            {
                "project_id":   p.id,
                "name":         p.name,
                "status":       _status_str(p),
                "source_language": p.source_language if isinstance(p.source_language, str) else p.source_language.value,
                "target_language": p.target_language,
                "chunk_count":  p.chunk_count,
                "chunks_approved": sum(1 for v in p.chunk_approvals.values() if v == "approved"),
                "created_at":   p.created_at.isoformat(),
                "completed_at": p.completed_at.isoformat() if p.completed_at else None,
            }
            for p in projects
        ]
    }


# ---------------------------------------------------------------------------
# GET /user/limits
# ---------------------------------------------------------------------------

@app.get("/user/limits")
async def get_user_limits(user_id: str = Depends(get_current_user_id)):
    """Return the current user's quota and usage counters."""
    lim = storage.get_limits(user_id)
    lim.reset_daily_if_needed()
    return {
        "user_id":                 user_id,
        "max_projects":            lim.max_projects,
        "projects_used":           lim.projects_used,
        "projects_remaining":      lim.projects_remaining,
        "max_files_per_project":   lim.max_files_per_project,
        "max_file_size_mb":        lim.max_file_size_mb,
        "max_migrations_per_day":  lim.max_migrations_per_day,
        "migrations_today":        lim.migrations_today,
        "migrations_remaining":    lim.migrations_remaining_today,
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

def _get_project(project_id: str, user_id: str) -> Project:
    project = storage.get(project_id)
    if not project:
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found")
    if project.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")
    return project


def _status_str(project: Project) -> str:
    s = project.status
    return s if isinstance(s, str) else s.value
