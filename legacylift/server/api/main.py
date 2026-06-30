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
from datetime import datetime
from typing import Optional

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, File, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, field_validator

from api.websocket_manager import manager as ws_manager
from core.pipeline import run_pipeline, run_migration_generation, _transition
from models.project import Project, ProjectStatus, SourceLanguage, UploadedFile

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
    "https://*.vercel.app",           # Vercel preview deployments
    "https://legacylift.vercel.app",  # production
]
if os.getenv("FRONTEND_URL"):
    _allow_origins.append(os.environ["FRONTEND_URL"])

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allow_origins,
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

    @field_validator("source_language", mode="before")
    @classmethod
    def normalise_source_language(cls, value):
        if isinstance(value, str) and value.lower() == "cobol":
            return SourceLanguage.COBOL
        return value


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
            "id": project.id,
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

    # Snapshot the migrated code at approval time so validate-schema can
    # concatenate it across all approved chunks later.  current_migration holds
    # the result of the most recent run_migration_generation call, which is
    # always the chunk the user is currently reviewing.
    if (
        project.current_migration
        and project.current_migration.get("chunk_id") == chunk_id
    ):
        migrated_code = project.current_migration.get("migrated_code", "")
        if migrated_code:
            project.chunk_migrations[chunk_id] = migrated_code

    await ws_manager.emit(project.id, "chunk_approved", chunk_id=chunk_id)

    all_approved = bool(project.layer0_chunks) and all(
        project.chunk_approvals.get(c["id"]) == "approved"
        for c in project.layer0_chunks
    )

    if all_approved:
        current = _status_str(project)
        if current == "ready":
            await _transition(project, "migrating")
        if _status_str(project) == "migrating":
            await _transition(project, "validating")
        if _status_str(project) == "validating":
            await _transition(project, "complete")
        project.completed_at = datetime.utcnow()
        approved_count = sum(
            1 for decision in project.chunk_approvals.values()
            if decision == "approved"
        )
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
        current = _status_str(project)
        if current == "migrating":
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

    return {
        "project_id": project_id,
        "chunk_id": chunk_id,
        "decision": "rejected",
        "feedback": body.feedback or body.comment,
    }


# ---------------------------------------------------------------------------
# POST /project/{id}/validate-schema
# ---------------------------------------------------------------------------

@app.post("/project/{project_id}/validate-schema", status_code=200)
async def validate_schema(project_id: str):
    """
    Run Layer 4 schema coverage validation against all approved chunks.

    Must be called after at least one chunk has been approved.  Concatenates
    the migrated_code for every approved chunk and passes it to SchemaValidator,
    which checks that every table in the legacy SQL schema is referenced.

    Broadcasts:
      schema_validation_started  — before the check begins
      schema_validation_complete — with full coverage results
      error                      — if SchemaValidator itself raises unexpectedly
    """
    project = _get_project(project_id)

    approved_chunk_ids = [
        cid for cid, decision in project.chunk_approvals.items()
        if decision == "approved"
    ]

    if not approved_chunk_ids:
        raise HTTPException(
            status_code=400,
            detail="At least one chunk must be approved before validating schema coverage",
        )

    # Gather migrated code for each approved chunk.
    # chunk_migrations is populated by approve_chunk at the moment of approval.
    code_parts = [
        project.chunk_migrations[cid]
        for cid in approved_chunk_ids
        if cid in project.chunk_migrations and project.chunk_migrations[cid]
    ]
    chunks_with_code = len(code_parts)

    await ws_manager.emit(
        project_id,
        "schema_validation_started",
        chunks_checked=chunks_with_code,
    )

    try:
        from core.layer4.schema_validator import SchemaValidator  # noqa: PLC0415
        from models.chunk import MigrationChunk                   # noqa: PLC0415

        pseudo_chunks = [
            MigrationChunk(name=cid, migrated_code=project.chunk_migrations[cid])
            for cid in approved_chunk_ids
            if cid in project.chunk_migrations and project.chunk_migrations[cid]
        ]

        validator = SchemaValidator()
        result = await validator.validate(project, pseudo_chunks)

        # Derive per-table coverage from the issues list so the frontend
        # can show covered vs missing without parsing strings itself.
        tables_missing = [
            issue.split("'")[1]
            for issue in result.issues
            if issue.startswith("MISSING TABLE") and "'" in issue
        ]
        column_warnings = [
            issue for issue in result.issues if issue.startswith("WARNING")
        ]
        covered_count = result.tables_checked - len(tables_missing)
        coverage_pct = (
            round(covered_count / result.tables_checked * 100, 1)
            if result.tables_checked > 0
            else 100.0
        )
        summary = (
            f"{covered_count} of {result.tables_checked} tables covered "
            f"({coverage_pct}%)"
            + (f"; {len(tables_missing)} missing table(s)" if tables_missing else "")
            + (f"; {len(column_warnings)} column warning(s)" if column_warnings else "")
        )

        payload = {
            "passed":             result.passed,
            "tables_checked":     result.tables_checked,
            "tables_missing":     tables_missing,
            "column_warnings":    column_warnings,
            "coverage_percentage": coverage_pct,
            "issues":             result.issues,
            "summary":            summary,
        }

        await ws_manager.emit(project_id, "schema_validation_complete", **payload)

        return payload

    except Exception as exc:
        logger.error(
            "Schema validation failed for project %s: %s", project_id, exc, exc_info=True
        )
        await ws_manager.emit_error(
            project_id, "schema_validation", str(exc), recoverable=True
        )
        raise HTTPException(
            status_code=500,
            detail=f"Schema validation failed: {exc}",
        )


# ---------------------------------------------------------------------------
# POST /project/{id}/confirm-rule/{chunk_id}
# ---------------------------------------------------------------------------

@app.post("/project/{project_id}/confirm-rule/{chunk_id}", status_code=200)
async def confirm_rule(project_id: str, chunk_id: str):
    """
    Mark the business rule for a chunk as Confirmed by a domain expert.

    Must be called before select-chunk — the chunk selection endpoint rejects
    requests where the rule has not been confirmed.
    """
    project = _get_project(project_id)

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
    if current != "ready":
        raise HTTPException(
            status_code=409,
            detail=f"Project must be in 'ready' state to select a chunk (current: {current})",
        )

    chunk_dict = next(
        (c for c in project.layer0_chunks if c["id"] == chunk_id), None
    )
    if chunk_dict is None:
        raise HTTPException(
            status_code=404, detail=f"Chunk '{chunk_id}' not found in Layer 0 output"
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


def _status_str(project: Project) -> str:
    s = project.status
    return s if isinstance(s, str) else s.value
