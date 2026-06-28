"""
api/main.py — FastAPI application entry point and route definitions.

This is the HTTP and WebSocket interface that the frontend and external tools
use to interact with LegacyLift.  All routes are defined here; business logic
lives in core/pipeline.py and the layer modules.

Architecture:
  - FastAPI app with lifespan context manager for startup/shutdown
  - python-dotenv loads .env at startup before any other module reads env vars
  - One MigrationPipeline instance per project, stored in `active_pipelines`
  - Projects are stored in-memory for the hackathon (replace with DB later)
  - WebSocket connections managed by the singleton `manager` from websocket_manager.py

To run:
    uvicorn legacylift.api.main:app --reload --host 0.0.0.0 --port 8000

Routes:
    POST   /api/project               — create a new project
    POST   /api/project/{id}/upload   — upload source files
    POST   /api/project/{id}/start    — kick off the pipeline
    POST   /api/project/{id}/approve/{chunk_id}  — approve a migration chunk
    POST   /api/project/{id}/reject/{chunk_id}   — reject a migration chunk
    GET    /api/project/{id}/status   — get project status + chunk summary
    GET    /api/project/{id}/rules    — get extracted business rules
    GET    /api/project/{id}/graph    — get dependency graph
    GET    /health                    — health check (for Fly.io)
    WS     /ws/{project_id}           — WebSocket stream for a project
"""

from __future__ import annotations

import asyncio
import os
from contextlib import asynccontextmanager
from typing import Optional

from dotenv import load_dotenv

# Load .env BEFORE any other imports that read environment variables
load_dotenv()

from fastapi import FastAPI, File, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from legacylift.api.websocket_manager import manager
from legacylift.core.pipeline import MigrationPipeline
from legacylift.models.project import Project, ProjectStatus, SourceLanguage, UploadedFile
from legacylift.models.business_rule import BusinessRule
from legacylift.models.chunk import MigrationChunk
from legacylift.models.validation import ApprovalDecision, ApprovalAction
from legacylift.ownership.classifier import classify_rule_ownership

# ---------------------------------------------------------------------------
# In-memory storage (replace with SQLAlchemy + async DB session for production)
# ---------------------------------------------------------------------------

# project_id -> Project
projects: dict[str, Project] = {}

# project_id -> MigrationPipeline
active_pipelines: dict[str, MigrationPipeline] = {}

# project_id -> list of BusinessRule (extracted by Layer 0)
project_rules: dict[str, list[BusinessRule]] = {}


# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application startup and shutdown.

    TODO (implementer):
      - On startup: initialise the SQLAlchemy async engine, create tables.
      - On shutdown: gracefully stop any running pipelines, flush logs.
    """
    # STARTUP
    print("=" * 60)
    print("  LegacyLift API starting up")
    print(f"  DEMO_MODE:  {os.getenv('DEMO_MODE', 'true')}")
    print(f"  LLM MODEL:  {os.getenv('OPENAI_MODEL', 'gpt-4o')}")
    print(f"  AUTO_APPROVE: {os.getenv('AUTO_APPROVE', 'false')}")
    print("=" * 60)

    yield

    # SHUTDOWN
    print("LegacyLift API shutting down — stopping active pipelines...")
    # TODO (implementer): cancel running pipeline tasks cleanly


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(
    title="LegacyLift API",
    description="AI-assisted legacy code migration workbench",
    version="0.1.0",
    lifespan=lifespan,
)

# Allow all origins for the hackathon (restrict in production)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Request/Response models
# ---------------------------------------------------------------------------

class CreateProjectRequest(BaseModel):
    name: str
    source_language: str = "COBOL"
    target_language: str = "Python"


class CreateProjectResponse(BaseModel):
    project_id: str
    name: str
    status: str


class ApproveChunkRequest(BaseModel):
    reviewer_comment: Optional[str] = None
    reviewer_id: Optional[str] = None


class ProjectStatusResponse(BaseModel):
    project_id: str
    name: str
    status: str
    files_uploaded: int
    chunks_total: int
    chunks_approved: int
    chunks_rejected: int
    chunks_pending: int


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@app.get("/health")
async def health_check():
    """
    Health check endpoint for Fly.io and load balancers.

    Returns 200 OK if the server is running.  Does NOT check external
    dependencies (DB, LLM API) — those are probed separately.

    TODO (implementer): add a liveness/readiness split:
      /health/live  — is the process alive? (always 200 if reachable)
      /health/ready — are dependencies up? (checks DB, LLM key presence)
    """
    return {
        "status": "healthy",
        "version": "0.1.0",
        "active_projects": len(projects),
        "demo_mode": os.getenv("DEMO_MODE", "true"),
    }


# ---------------------------------------------------------------------------
# POST /api/project — create new project
# ---------------------------------------------------------------------------

@app.post("/api/project", response_model=CreateProjectResponse, status_code=201)
async def create_project(body: CreateProjectRequest):
    """
    Create a new migration project.

    The project starts in CREATED status.  No files are uploaded yet.
    The client should next call POST /api/project/{id}/upload to add files.

    Args:
        body: Project name and source/target language configuration.

    Returns:
        CreateProjectResponse with the new project_id.

    TODO (implementer):
      - Validate source_language against the SourceLanguage enum.
      - Persist the project to the database instead of the in-memory dict.
      - Return a 409 if a project with this name already exists.
    """
    try:
        project = Project(
            name=body.name,
            source_language=body.source_language,
            target_language=body.target_language,
        )
        projects[project.id] = project

        return CreateProjectResponse(
            project_id=project.id,
            name=project.name,
            status=project.status,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# ---------------------------------------------------------------------------
# POST /api/project/{id}/upload — upload source files
# ---------------------------------------------------------------------------

@app.post("/api/project/{project_id}/upload", status_code=200)
async def upload_files(
    project_id: str,
    files: list[UploadFile] = File(...),
):
    """
    Upload one or more legacy source files for a project.

    Accepts multipart/form-data with one or more files.  Each file is decoded
    as UTF-8 and stored in the Project's files list.

    Args:
        project_id: ID of the project to attach files to.
        files:      List of uploaded files.

    Returns:
        JSON with list of uploaded filenames and their sizes.

    TODO (implementer):
      - Detect file encoding (EBCDIC mainframe exports may not be UTF-8).
        Use chardet or codecs.open() with EBCDIC codec.
      - Validate file extension against source_language whitelist.
      - Store files in S3/object storage for production; use content for now.
      - Enforce a file size limit (e.g. 10MB per file).
    """
    project = _get_project(project_id)

    uploaded = []
    for upload in files:
        try:
            content = (await upload.read()).decode("utf-8", errors="replace")
            f = UploadedFile(
                filename=upload.filename or "unnamed.txt",
                language=project.source_language,
                content=content,
                size_bytes=len(content.encode("utf-8")),
            )
            project.files.append(f)
            uploaded.append({"filename": f.filename, "size_bytes": f.size_bytes})
        except Exception as exc:
            raise HTTPException(
                status_code=400,
                detail=f"Failed to process {upload.filename}: {exc}"
            )

    project.status = ProjectStatus.UPLOADING

    return {"uploaded": uploaded, "total_files": len(project.files)}


# ---------------------------------------------------------------------------
# POST /api/project/{id}/start — start the migration pipeline
# ---------------------------------------------------------------------------

@app.post("/api/project/{project_id}/start", status_code=202)
async def start_pipeline(project_id: str):
    """
    Start the full migration pipeline for a project.

    Returns 202 Accepted immediately.  The pipeline runs as an asyncio
    background task and emits progress via WebSocket events.

    The client should connect to WS /ws/{project_id} before calling this
    endpoint so it doesn't miss early events.

    Args:
        project_id: ID of the project to migrate.

    Returns:
        JSON confirming the pipeline has started.

    TODO (implementer):
      - Validate that at least one file has been uploaded.
      - Prevent re-starting a pipeline that is already running.
      - Add an optional `resume_from` param for checkpoint resumption.
    """
    project = _get_project(project_id)

    if not project.files:
        raise HTTPException(
            status_code=400,
            detail="No files uploaded. Call /upload before /start."
        )

    if project_id in active_pipelines:
        existing = active_pipelines[project_id]
        if project.status in (ProjectStatus.ANALYSING, ProjectStatus.MIGRATING):
            raise HTTPException(
                status_code=409,
                detail=f"Pipeline already running for project {project_id}"
            )

    # Create pipeline and launch as background task
    pipeline = MigrationPipeline(project, manager)
    active_pipelines[project_id] = pipeline

    # Fire and forget — pipeline emits WebSocket events for progress
    asyncio.create_task(pipeline.run())

    return {
        "message":    f"Pipeline started for project '{project.name}'",
        "project_id": project_id,
        "status":     "running",
        "tip":        f"Connect to ws://host/ws/{project_id} to receive events",
    }


# ---------------------------------------------------------------------------
# POST /api/project/{id}/approve/{chunk_id}
# ---------------------------------------------------------------------------

@app.post("/api/project/{project_id}/approve/{chunk_id}", status_code=200)
async def approve_chunk(
    project_id: str,
    chunk_id: str,
    body: ApproveChunkRequest = ApproveChunkRequest(),
):
    """
    Approve a migration chunk, allowing the pipeline to continue.

    The pipeline pauses at each chunk waiting for this call.  Once approved,
    the pipeline moves on to the next chunk.

    Args:
        project_id:  ID of the project.
        chunk_id:    ID of the chunk to approve.
        body:        Optional reviewer comment and reviewer ID.

    Returns:
        JSON confirming the approval was received.

    TODO (implementer):
      - Extract reviewer identity from JWT/session instead of body.
      - Log the approval to an audit table with timestamp.
      - Trigger Simonra's ownership classifier for all confirmed business rules.
    """
    pipeline = _get_pipeline(project_id)

    decision = ApprovalDecision(
        chunk_id=chunk_id,
        action=ApprovalAction.APPROVE,
        reviewer_comment=body.reviewer_comment,
        reviewer_id=body.reviewer_id,
    )

    resolved = pipeline.resolve_approval(decision)
    if not resolved:
        raise HTTPException(
            status_code=404,
            detail=f"Chunk '{chunk_id}' is not waiting for approval"
        )

    return {"message": f"Chunk '{chunk_id}' approved", "project_id": project_id}


# ---------------------------------------------------------------------------
# POST /api/project/{id}/reject/{chunk_id}
# ---------------------------------------------------------------------------

@app.post("/api/project/{project_id}/reject/{chunk_id}", status_code=200)
async def reject_chunk(
    project_id: str,
    chunk_id: str,
    body: ApproveChunkRequest = ApproveChunkRequest(),
):
    """
    Reject a migration chunk, sending it back for regeneration.

    The pipeline will attempt to regenerate the chunk (up to LLM_MAX_RETRIES)
    using the reviewer_comment as additional context for the LLM.

    Args:
        project_id:      ID of the project.
        chunk_id:        ID of the chunk to reject.
        body:            Should include reviewer_comment explaining what's wrong.

    Returns:
        JSON confirming the rejection.

    TODO (implementer):
      - Enforce that reviewer_comment is required for rejections (better UX).
      - After max retries, escalate to a human engineer rather than failing.
    """
    pipeline = _get_pipeline(project_id)

    decision = ApprovalDecision(
        chunk_id=chunk_id,
        action=ApprovalAction.REJECT,
        reviewer_comment=body.reviewer_comment,
        reviewer_id=body.reviewer_id,
    )

    resolved = pipeline.resolve_approval(decision)
    if not resolved:
        raise HTTPException(
            status_code=404,
            detail=f"Chunk '{chunk_id}' is not waiting for approval"
        )

    return {"message": f"Chunk '{chunk_id}' rejected — pipeline will regenerate", "project_id": project_id}


# ---------------------------------------------------------------------------
# GET /api/project/{id}/status
# ---------------------------------------------------------------------------

@app.get("/api/project/{project_id}/status", response_model=ProjectStatusResponse)
async def get_project_status(project_id: str):
    """
    Get the current status and chunk summary for a project.

    Args:
        project_id: ID of the project.

    Returns:
        ProjectStatusResponse with chunk counts and current status.

    TODO (implementer): add ETA estimation based on average chunk processing time.
    """
    project = _get_project(project_id)
    pipeline = active_pipelines.get(project_id)

    chunks = pipeline.chunks if pipeline else []
    approved = sum(1 for c in chunks if c.status == "Approved")
    rejected  = sum(1 for c in chunks if c.status == "Rejected")
    pending   = len(chunks) - approved - rejected

    return ProjectStatusResponse(
        project_id=project.id,
        name=project.name,
        status=project.status,
        files_uploaded=len(project.files),
        chunks_total=len(chunks),
        chunks_approved=approved,
        chunks_rejected=rejected,
        chunks_pending=pending,
    )


# ---------------------------------------------------------------------------
# GET /api/project/{id}/rules
# ---------------------------------------------------------------------------

@app.get("/api/project/{project_id}/rules")
async def get_business_rules(project_id: str):
    """
    Get all extracted business rules for a project.

    Returns rules in the order they were discovered (by source file and line).

    Args:
        project_id: ID of the project.

    Returns:
        JSON list of BusinessRule objects.

    TODO (implementer):
      - Add filtering: ?status=Pending&confidence=High
      - Add pagination: ?page=1&limit=20
      - Add sort: ?sort=source_file&dir=asc
    """
    _get_project(project_id)  # Validates project exists

    rules = project_rules.get(project_id, [])
    return {"project_id": project_id, "rules": [r.dict() for r in rules]}


# ---------------------------------------------------------------------------
# GET /api/project/{id}/graph
# ---------------------------------------------------------------------------

@app.get("/api/project/{project_id}/graph")
async def get_dependency_graph(project_id: str):
    """
    Get the dependency graph for a project.

    Returns the adjacency dict built by Layer 0's DependencyMapper.

    Args:
        project_id: ID of the project.

    Returns:
        JSON with the dependency graph.

    TODO (implementer): return a D3.js-compatible node/edge format:
      {"nodes": [{"id": "file.cbl"}], "edges": [{"source": "a.cbl", "target": "b.cbl"}]}
    """
    project = _get_project(project_id)

    return {
        "project_id": project_id,
        "graph":      project.dependency_graph,
        "risk_scores": project.risk_scores,
    }


# ---------------------------------------------------------------------------
# WebSocket /ws/{project_id}
# ---------------------------------------------------------------------------

@app.websocket("/ws/{project_id}")
async def websocket_endpoint(websocket: WebSocket, project_id: str):
    """
    WebSocket connection for real-time pipeline event streaming.

    The client connects here to receive all pipeline events for a project.
    Past events (since project creation) are replayed on connection so the
    client can reconstruct state even if it connects mid-pipeline.

    Args:
        project_id: ID of the project to subscribe to.

    TODO (implementer):
      - Add authentication: verify the WebSocket upgrade includes a valid token.
        Reject with websocket.close(code=4001) if authentication fails.
      - Add per-client event filtering so clients can subscribe to specific
        event types only.
    """
    await manager.connect(project_id, websocket)
    try:
        # Keep connection alive and handle any incoming messages
        while True:
            try:
                data = await websocket.receive_text()
                # TODO (implementer): handle incoming messages from the client.
                # The frontend might send 'ping' or 'subscribe' messages.
                # For now, echo back an ack.
                await websocket.send_text('{"type": "ack"}')
            except WebSocketDisconnect:
                break
    finally:
        await manager.disconnect(project_id, websocket)


# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------

def _get_project(project_id: str) -> Project:
    """
    Look up a project by ID or raise 404.

    TODO (implementer): replace with a DB query via SQLAlchemy async session.
    """
    project = projects.get(project_id)
    if not project:
        raise HTTPException(
            status_code=404,
            detail=f"Project '{project_id}' not found"
        )
    return project


def _get_pipeline(project_id: str) -> MigrationPipeline:
    """
    Look up an active pipeline by project ID or raise 404/409.

    TODO (implementer): handle the case where the pipeline finished — the
    project exists but the pipeline task is done.
    """
    _get_project(project_id)  # Validate project exists first
    pipeline = active_pipelines.get(project_id)
    if not pipeline:
        raise HTTPException(
            status_code=409,
            detail=f"No active pipeline for project '{project_id}'. Call /start first."
        )
    return pipeline
