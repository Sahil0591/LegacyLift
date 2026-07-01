"""
api/main.py — FastAPI application entry point and route definitions.

Routes:
    GET    /health                        — health check
    GET    /health/ready                  — readiness probe (LLM/persistence config)
    GET    /github/overlay                — GitHub code overlay annotations
    PATCH  /github/overlay/annotation/{id} — mutate overlay review/approval state
    POST   /github/webhook                — GitHub App webhook ingestion
    POST   /project                       — create a new project
    POST   /project/{id}/upload           — upload source files
    POST   /project/{id}/start            — kick off the pipeline
    POST   /project/{id}/approve/{chunk_id}  — approve a migration chunk
    POST   /project/{id}/reject/{chunk_id}   — reject a migration chunk
    POST   /project/{id}/validate-schema   — Layer 4 schema coverage check
    POST   /project/{id}/confirm-rule/{chunk_id} — confirm/reassign/flag a business rule
    POST   /project/{id}/select-chunk/{chunk_id} — select a chunk for migration
    GET    /project/{id}/status           — get project status
    GET    /project/{id}/rules            — get extracted business rules
    GET    /project/{id}/lessons          — get accumulated AI review/rejection feedback
    POST   /project/{id}/lessons          — manually add a lesson
    DELETE /project/{id}/lessons/{id}     — remove a lesson
    GET    /project/{id}/graph            — get dependency graph
    GET    /project/{id}/target-profile   — get Layer 0.5 target profile
    GET    /projects                      — list projects for the authenticated user
    GET    /user/limits                   — get quota/usage for the authenticated user
    POST   /llm/migrate                   — on-demand migration for a single unit
    POST   /llm/review                    — on-demand AI review for a single unit
    POST   /llm/tests                     — on-demand test generation for a single unit
    WS     /ws/{project_id}              — WebSocket stream for a project
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Optional

from dotenv import find_dotenv, load_dotenv

load_dotenv(find_dotenv(usecwd=True))

from fastapi import Depends, FastAPI, File, Header, HTTPException, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel
from sqlalchemy import text

from api.auth import get_current_user_id, verify_ws_token
from api.github_overlay import router as github_overlay_router
from api.websocket_manager import manager as ws_manager
from core.pipeline import run_pipeline, run_migration_generation, _transition, _add_lesson
from core.storage import storage
from db.session import get_database_url, get_session, init_db, validate_database_url
from integrations.github_app import GitHubAppSettings, verify_webhook_signature
from integrations.github_ingestion import process_github_webhook
from models.project import Project, SourceLanguage, UploadedFile
from ownership.review_workflow import (
    REVIEW_FLAGGED,
    ReviewWorkflowError,
    ReviewWorkflowState,
    WORKBENCH_SURFACE,
    apply_review_transition,
    approval_state_label,
    review_state_label,
    transition_payload,
)
from utils.llm_client import (
    DEMO_RESPONSE,
    LLMClient,
    LLMNotConfiguredError,
    LLMRequestFailedError,
)
from utils.migration_prompts import (
    build_migration_prompt,
    build_project_review_prompt,
    build_review_prompt,
    build_test_prompt,
    parse_json_loose,
    strip_code_fence,
)

logger = logging.getLogger(__name__)

active_pipelines: dict[str, asyncio.Task] = {}
_project_locks: dict[str, asyncio.Lock] = {}

# Upload limits
_MAX_UPLOAD_FILES = int(os.getenv("MAX_UPLOAD_FILES", "25"))
_MAX_FILE_BYTES   = int(os.getenv("MAX_FILE_SIZE_MB", "5")) * 1024 * 1024
_MAX_TOTAL_BYTES  = _MAX_UPLOAD_FILES * _MAX_FILE_BYTES
# Kept in sync with the languages utils/code_parser.py can actually parse
# (and with client/components/pipeline/FileUpload.tsx's `accept` attribute).
# Every extension here maps to a real chunker — accepting anything else would
# let a file through that Layer 0 can only ever return zero chunks for.
_ALLOWED_EXTENSIONS = {
    ".cbl", ".cob", ".cobol", ".cpy",   # COBOL
    ".java",                            # Java
    ".sql", ".ddl",                     # SQL schema
    ".vb", ".bas", ".frm", ".cls",      # VB6
}


def _get_project_lock(project_id: str) -> asyncio.Lock:
    if project_id not in _project_locks:
        _project_locks[project_id] = asyncio.Lock()
    return _project_locks[project_id]


# Env vars a DEMO_MODE=false deployment cannot function without. Checked at
# startup so a misconfigured production deploy fails loudly instead of
# silently serving demo/stub behaviour or rejecting every request with 401s.
_REQUIRED_PRODUCTION_ENV_VARS = (
    "VENICE_API_KEY",
    "VENICE_MODEL",
    "VENICE_BASE_URL",
    "CLERK_JWKS_URL",
    "DATABASE_URL",
)


def _validate_production_env() -> None:
    """Raise RuntimeError listing any required env var missing when DEMO_MODE=false."""
    if os.getenv("DEMO_MODE", "true").lower() == "true":
        return
    missing = [v for v in _REQUIRED_PRODUCTION_ENV_VARS if not os.getenv(v)]
    if missing:
        raise RuntimeError(
            "DEMO_MODE=false but required environment variable(s) are missing: "
            + ", ".join(missing)
            + ". Set them before starting the server — see server/.env.example."
        )
    # Also catch a present-but-malformed DATABASE_URL (missing check above
    # only catches it being entirely absent).
    validate_database_url(os.getenv("DATABASE_URL", ""))


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
    _validate_production_env()
    await storage.load()
    await init_db()
    yield
    await storage.persist()
    await storage.close()
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
    "https://legacy-lift-six.vercel.app",  # production
    "https://legacylift.vercel.app",  # production
]
if os.getenv("FRONTEND_URL"):
    _allow_origins.append(os.environ["FRONTEND_URL"])
if os.getenv("FRONTEND_HOST"):
    _allow_origins.append(f"https://{os.environ['FRONTEND_HOST']}")

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
    name: str = Field("Untitled", min_length=1, max_length=120)
    source_language: SourceLanguage = SourceLanguage.COBOL
    target_language: str = Field("Python", min_length=1, max_length=64)

    @field_validator("source_language", mode="before")
    @classmethod
    def normalise_source_language(cls, value):
        if isinstance(value, str) and value.lower() == "cobol":
            return SourceLanguage.COBOL
        return value


class ApproveChunkRequest(BaseModel):
    comment: Optional[str] = Field(None, max_length=2_000)


class RejectChunkRequest(BaseModel):
    comment: str = Field(..., min_length=1, max_length=2_000)
    feedback: Optional[str] = Field(None, max_length=2_000)


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
# GET /health/ready — deeper readiness probe
# ---------------------------------------------------------------------------

@app.get("/health/ready")
async def readiness_check():
    """
    Report whether this instance is actually able to do real work, not just
    whether the process is up. Useful for catching a DEMO_MODE=false deploy
    that started but has no working LLM key or persistence backend.
    """
    demo_mode = os.getenv("DEMO_MODE", "true").lower() == "true"
    llm_configured = _get_llm().is_configured()
    missing_env = [v for v in _REQUIRED_PRODUCTION_ENV_VARS if not os.getenv(v)]

    ready = demo_mode or (llm_configured and not missing_env)

    if demo_mode:
        storage_mode = "json_file"
    elif get_database_url().startswith("postgresql"):
        storage_mode = "postgres"
    else:
        storage_mode = "sqlite"

    return JSONResponse(
        status_code=200 if ready else 503,
        content={
            "ready": ready,
            "demo_mode": demo_mode,
            "llm_configured": llm_configured,
            "storage_mode": storage_mode,
            "missing_env": missing_env,
        },
    )


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

    if len(files) > _MAX_UPLOAD_FILES:
        raise HTTPException(
            status_code=400,
            detail=f"Too many files — max {_MAX_UPLOAD_FILES} per upload.",
        )

    seen_names: set[str] = set()
    total_bytes = 0
    filenames: list[str] = []

    for upload in files:
        filename = (upload.filename or "unnamed.txt").strip()
        ext = os.path.splitext(filename)[1].lower()
        if ext and ext not in _ALLOWED_EXTENSIONS:
            raise HTTPException(
                status_code=415,
                detail=f"File type {ext!r} is not allowed.",
            )
        if filename in seen_names:
            raise HTTPException(
                status_code=400,
                detail=f"Duplicate filename: {filename!r}",
            )
        seen_names.add(filename)

        try:
            raw = await upload.read(_MAX_FILE_BYTES + 1)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Could not read {filename!r}: {exc}")

        if len(raw) == 0:
            raise HTTPException(status_code=400, detail=f"{filename!r} is empty.")
        if len(raw) > _MAX_FILE_BYTES:
            limit_mb = _MAX_FILE_BYTES // (1024 * 1024)
            raise HTTPException(
                status_code=413,
                detail=f"{filename!r} exceeds the {limit_mb} MB per-file limit.",
            )

        total_bytes += len(raw)
        if total_bytes > _MAX_TOTAL_BYTES:
            raise HTTPException(
                status_code=413,
                detail="Total upload size exceeds the allowed limit.",
            )

        try:
            content = raw.decode("utf-8", errors="replace")
            f = UploadedFile(
                filename=filename,
                language=project.source_language,
                content=content,
                size_bytes=len(raw),
            )
            project.files.append(f)
            project.uploaded_files[filename] = content
            filenames.append(filename)
        except Exception as exc:
            raise HTTPException(
                status_code=400,
                detail=f"Failed to process {filename!r}: {exc}",
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

    all_approved = bool(project.layer0_chunks) and all(
        project.chunk_approvals.get(c["id"]) == "approved"
        for c in project.layer0_chunks
    )
    approved_count = sum(
        1 for decision in project.chunk_approvals.values() if decision == "approved"
    )
    if all_approved:
        current = _status_str(project)
        if current in ("ready", "migrating"):
            await _transition(project, "validating")
        if _status_str(project) == "validating":
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
        current = _status_str(project)
        if current == "migrating":
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

    feedback = body.feedback or body.comment
    if feedback:
        chunk_dict = next(
            (c for c in project.layer0_chunks if c["id"] == chunk_id), None
        )
        _add_lesson(
            project,
            source="rejection",
            text=feedback,
            source_file=chunk_dict.get("filename", "") if chunk_dict else "",
            chunk_name=chunk_dict.get("name", chunk_id) if chunk_dict else chunk_id,
        )

    await ws_manager.emit(
        project.id,
        "chunk_rejected",
        chunk_id=chunk_id,
        feedback=feedback,
    )

    asyncio.ensure_future(storage.persist())
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
async def validate_schema(project_id: str, user_id: str = Depends(get_current_user_id)):
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
    project = _get_project(project_id, user_id)

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
async def confirm_rule(
    project_id: str,
    chunk_id: str,
    body: RuleReviewRequest | None = None,
    user_id: str = Depends(get_current_user_id),
):
    """
    Apply an ownership review transition (confirm/reassign/flag) to a chunk's
    business rule.

    Must be called before select-chunk — the chunk selection endpoint rejects
    requests where the rule has not been confirmed (or reassigned) and rejects
    chunks whose rule is currently flagged.
    """
    project = _get_project(project_id, user_id)
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

    asyncio.ensure_future(storage.persist())
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
async def select_chunk(project_id: str, chunk_id: str, user_id: str = Depends(get_current_user_id)):
    """
    Select a Layer 0 chunk for migration.

    Validates:
      - Project is in 'ready' state (Layer 0 complete)
      - chunk_id exists in Layer 0 output
      - Business rule for this chunk has been Confirmed (or Reassigned) by a
        domain expert, and is not currently Flagged

    On success:
      - Transitions project to 'migrating'
      - Fires a background task that calls generate_migration() then Layer 1
      - Broadcasts { event: 'chunk_selected', chunk_id }
      - Returns 202 immediately
    """
    async with _get_project_lock(project_id):
        project = _get_project(project_id, user_id)

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
# GET /project/{id}/lessons
# ---------------------------------------------------------------------------

@app.get("/project/{project_id}/lessons")
async def get_lessons(project_id: str, user_id: str = Depends(get_current_user_id)):
    """The project's accumulated in-context feedback loop (AI review findings + rejections)."""
    project = _get_project(project_id, user_id)
    return {
        "project_id":   project_id,
        "lesson_count": len(project.lessons),
        "lessons":      project.lessons,
    }


class AddLessonRequest(BaseModel):
    source: str = Field(..., min_length=1, max_length=120)
    text: str = Field(..., min_length=1, max_length=4_000)
    source_file: Optional[str] = Field(None, max_length=1024)
    chunk_name: Optional[str] = Field(None, max_length=255)


@app.post("/project/{project_id}/lessons", status_code=201)
async def add_lesson(project_id: str, body: AddLessonRequest, user_id: str = Depends(get_current_user_id)):
    """Manually add a lesson to the project's feedback loop."""
    project = _get_project(project_id, user_id)
    _add_lesson(
        project,
        source=body.source,
        text=body.text,
        source_file=body.source_file or "",
        chunk_name=body.chunk_name or "",
    )
    asyncio.ensure_future(storage.persist())
    return {
        "project_id":   project_id,
        "lesson":       project.lessons[-1],
        "lesson_count": len(project.lessons),
    }


@app.delete("/project/{project_id}/lessons/{lesson_id}")
async def delete_lesson(project_id: str, lesson_id: str, user_id: str = Depends(get_current_user_id)):
    """Remove a lesson from the project's feedback loop."""
    project = _get_project(project_id, user_id)
    before = len(project.lessons)
    project.lessons = [l for l in project.lessons if l.get("id") != lesson_id]
    if len(project.lessons) == before:
        raise HTTPException(status_code=404, detail=f"Lesson '{lesson_id}' not found")
    asyncio.ensure_future(storage.persist())
    return {
        "project_id":   project_id,
        "lesson_id":    lesson_id,
        "lesson_count": len(project.lessons),
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
# GET /project/{id}/target-profile
# ---------------------------------------------------------------------------

@app.get("/project/{project_id}/target-profile")
async def get_target_profile(project_id: str, user_id: str = Depends(get_current_user_id)):
    """
    Return the Layer 0.5 TargetProfile for the project.

    HTTP 202 if Layer 0.5 has not yet completed (project.target_profile is None).
    HTTP 404 if the project does not exist.
    HTTP 200 with the full unified TargetProfile schema on success.
    """
    project = _get_project(project_id, user_id)
    if project.target_profile is None:
        return JSONResponse(
            status_code=202,
            content={
                "status": "pending",
                "message": "Layer 0.5 not yet complete",
            },
        )
    return project.target_profile


# ---------------------------------------------------------------------------
# GET /project/{id}/files
# ---------------------------------------------------------------------------

@app.get("/project/{project_id}/files")
async def get_project_files(project_id: str, user_id: str = Depends(get_current_user_id)):
    """Return the full raw content of every uploaded source file for a project.

    Used by the client to build whole-file context for migration prompts and
    to render the file-context panel in the review workbench.
    """
    project = _get_project(project_id, user_id)
    language = project.source_language if isinstance(project.source_language, str) else project.source_language.value
    return {
        "project_id": project_id,
        "files": [
            {"filename": filename, "content": content, "language": language}
            for filename, content in project.uploaded_files.items()
        ],
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


# ===========================================================================
# On-demand LLM endpoints — the "Regenerate" workflow.
#
# These proxy a single Venice call (generate / review / generate-tests) for one
# code unit. The frontend used to host its own Venice client; it now calls these
# so the Venice key lives only on the backend. Responses are sanitized: the
# client never sees a raw Venice error, status code, or stack trace.
# ===========================================================================

class _BusinessRuleIn(BaseModel):
    title: str = Field("", max_length=200)
    description: str = Field("", max_length=2_000)
    hardcoded_values: list[str] = Field(default_factory=list, max_length=50)


class _TargetProfileIn(BaseModel):
    language: str = Field("Python", max_length=64)
    version: str = Field("", max_length=32)
    test_framework: str = Field("", max_length=64)
    notes: str = Field("", max_length=1_000)


class MigrateUnitRequest(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    name: str = Field(..., min_length=1, max_length=200)
    source_code: str = Field(..., min_length=1, max_length=80_000)
    source_lang: str = Field("COBOL", max_length=32)
    target_lang: str = Field("Python", max_length=32)
    business_rules: list[_BusinessRuleIn] = Field(default_factory=list, max_length=20)
    target_profile: Optional[_TargetProfileIn] = None
    instructions: Optional[str] = Field(None, max_length=4_000)
    previous_attempt: Optional[str] = Field(None, max_length=120_000)
    file_context: Optional[str] = Field(None, max_length=60_000)
    project_manifest: Optional[str] = Field(None, max_length=8_000)
    lessons_learned: Optional[str] = Field(None, max_length=4_000)


class ReviewUnitRequest(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    name: str = Field(..., min_length=1, max_length=200)
    source_code: str = Field(..., min_length=1, max_length=80_000)
    migrated_code: str = Field(..., min_length=1, max_length=120_000)
    source_lang: str = Field("COBOL", max_length=32)
    target_lang: str = Field("Python", max_length=32)


class TestsUnitRequest(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    name: str = Field(..., min_length=1, max_length=200)
    migrated_code: str = Field(..., min_length=1, max_length=120_000)
    target_lang: str = Field("Python", max_length=32)


class _FileSummaryIn(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    filename: str = Field(..., max_length=260)
    chunk_count: int = 0
    risk_level: str = "Medium"


class ReviewProjectRequest(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    project_name: str = Field(..., min_length=1, max_length=200)
    manifest: str = Field("", max_length=20_000)
    file_summaries: list[_FileSummaryIn] = Field(default_factory=list, max_length=200)


# --- Lazy LLM client singleton (re-uses one AsyncOpenAI connection pool) -----

_llm_client: Optional[LLMClient] = None


def _get_llm() -> LLMClient:
    global _llm_client
    if _llm_client is None:
        _llm_client = LLMClient()
    return _llm_client


# --- Minimal in-memory rate limiter (per client IP, sliding window) ----------
# Mirrors the 20-req/60s cap the old Next.js routes enforced. Single-instance
# only; for multi-instance deploys move this to Redis.

_rl_hits: dict[str, list[float]] = {}
_RL_LIMIT = int(os.getenv("LLM_ROUTE_RATE_LIMIT", "20"))
_RL_WINDOW = 60.0


def _rate_limit(request: Request, bucket: str, user_id: Optional[str] = None) -> None:
    # Key by authenticated user_id when available; fall back to IP for unauthenticated paths.
    if user_id:
        identity = user_id
    else:
        identity = request.client.host if request.client else "unknown"
    key = f"{bucket}:{identity}"
    now = asyncio.get_event_loop().time()
    hits = [t for t in _rl_hits.get(key, []) if now - t < _RL_WINDOW]
    if len(hits) >= _RL_LIMIT:
        retry_after = int(_RL_WINDOW - (now - hits[0])) + 1
        raise HTTPException(
            status_code=429,
            detail=f"Too many requests — try again in {retry_after}s.",
            headers={"Retry-After": str(retry_after)},
        )
    hits.append(now)
    _rl_hits[key] = hits


def _check_and_charge_quota(user_id: str) -> None:
    """Raise HTTP 429 if the user has exhausted their daily migration budget."""
    lim = storage.get_limits(user_id)
    lim.reset_daily_if_needed()
    if lim.migrations_remaining_today <= 0:
        raise HTTPException(
            status_code=429,
            detail="Daily migration quota exhausted. Resets at midnight UTC.",
        )


def _require_configured(llm: LLMClient) -> None:
    if not llm.is_configured():
        raise HTTPException(
            status_code=501,
            detail="AI code generation is not configured on the server.",
        )


def _ensure_real_output(content: str) -> str:
    """Reject the DEMO/error sentinel so we never return placeholder junk.

    In DEMO_MODE=true, LLMClient.complete() can still hand back DEMO_RESPONSE
    (no key configured); treat that (and empty output) as a sanitized upstream
    failure. In DEMO_MODE=false, complete() raises instead of returning this
    sentinel — see _safe_complete().
    """
    if not content or not content.strip() or content.strip() == DEMO_RESPONSE.strip():
        raise HTTPException(
            status_code=502,
            detail="The AI service is temporarily unavailable. Please try again.",
        )
    return content


async def _safe_complete(llm: LLMClient, **kwargs) -> str:
    """Call llm.complete() and translate non-demo-mode failures into clean HTTP errors.

    Ensures a raw Venice/network exception never leaks to the client — only the
    two well-known LLMClient exception types are caught and mapped; anything
    else propagates as an unhandled 500 (a genuine bug, not an upstream failure).
    """
    try:
        return await llm.complete(**kwargs)
    except LLMNotConfiguredError as exc:
        raise HTTPException(
            status_code=501,
            detail="AI code generation is not configured on the server.",
        ) from exc
    except LLMRequestFailedError as exc:
        logger.error("LLM request failed: %s", exc)
        raise HTTPException(
            status_code=502,
            detail="The AI service is temporarily unavailable. Please try again.",
        ) from exc


# ---------------------------------------------------------------------------
# POST /llm/migrate
# ---------------------------------------------------------------------------

@app.post("/llm/migrate")
async def llm_migrate(
    body: MigrateUnitRequest,
    request: Request,
    user_id: str = Depends(get_current_user_id),
):
    """Generate a migrated unit from legacy source. Returns {migrated_code, model}."""
    _rate_limit(request, "migrate", user_id)
    _check_and_charge_quota(user_id)
    llm = _get_llm()
    _require_configured(llm)

    system, user = build_migration_prompt(
        name=body.name,
        source_code=body.source_code,
        source_lang=body.source_lang,
        target_lang=body.target_lang,
        business_rules=[r.model_dump() for r in body.business_rules],
        target_profile=body.target_profile.model_dump() if body.target_profile else None,
        instructions=body.instructions,
        previous_attempt=body.previous_attempt,
        file_context=body.file_context,
        project_manifest=body.project_manifest,
        lessons_learned=body.lessons_learned,
    )
    content = await _safe_complete(llm, system=system, user=user, temperature=0.1, max_tokens=8000)
    content = _ensure_real_output(content)
    storage.increment_migrations_today(user_id)
    return {"migrated_code": strip_code_fence(content), "model": llm.model}


# ---------------------------------------------------------------------------
# POST /llm/review
# ---------------------------------------------------------------------------

@app.post("/llm/review")
async def llm_review(
    body: ReviewUnitRequest,
    request: Request,
    user_id: str = Depends(get_current_user_id),
):
    """AI semantic-equivalence review of a migrated unit. Returns an AIReviewResult."""
    _rate_limit(request, "review", user_id)
    _check_and_charge_quota(user_id)
    llm = _get_llm()
    _require_configured(llm)

    system, user = build_review_prompt(
        name=body.name,
        source_lang=body.source_lang,
        target_lang=body.target_lang,
        source_code=body.source_code,
        migrated_code=body.migrated_code,
    )
    content = await _safe_complete(
        llm,
        system=system,
        user=user,
        temperature=0.1,
        max_tokens=5000,
        json_response=True,
    )
    content = _ensure_real_output(content)
    storage.increment_migrations_today(user_id)

    parsed = parse_json_loose(content)
    if not parsed:
        return {
            "equivalent": False,
            "confidence": "Low",
            "ai_confidence": "Low",
            "issues_found": 1,
            "critical_issues": [],
            "warnings": ["Review model returned unstructured output."],
            "suggestions": [],
            "raw_response": content[:1000],
        }

    critical = parsed.get("critical_issues") or []
    warnings = parsed.get("warnings") or []
    issues = parsed.get("issues_found")
    if not isinstance(issues, int):
        issues = len(critical) + len(warnings)
    confidence = parsed.get("confidence") or "Medium"

    return {
        "equivalent": bool(parsed.get("equivalent")),
        "confidence": confidence,
        "ai_confidence": confidence,
        "issues_found": issues,
        "critical_issues": critical,
        "warnings": warnings,
        "suggestions": parsed.get("suggestions") or [],
        "raw_response": "",
    }


# ---------------------------------------------------------------------------
# POST /llm/tests
# ---------------------------------------------------------------------------

@app.post("/llm/tests")
async def llm_tests(
    body: TestsUnitRequest,
    request: Request,
    user_id: str = Depends(get_current_user_id),
):
    """Generate pytest tests for a migrated unit. Returns {tests, code}."""
    _rate_limit(request, "tests", user_id)
    _check_and_charge_quota(user_id)
    llm = _get_llm()
    _require_configured(llm)

    system, user = build_test_prompt(
        name=body.name,
        migrated_code=body.migrated_code,
        target_lang=body.target_lang,
    )
    content = await _safe_complete(
        llm,
        system=system,
        user=user,
        temperature=0.2,
        max_tokens=6000,
        json_response=True,
    )
    content = _ensure_real_output(content)
    storage.increment_migrations_today(user_id)

    parsed = parse_json_loose(content) or {}
    tests = [
        t for t in (parsed.get("tests") or [])
        if isinstance(t, dict) and isinstance(t.get("name"), str)
    ][:8]
    return {"tests": tests, "code": parsed.get("code") or ""}


# ---------------------------------------------------------------------------
# POST /llm/review-project
# ---------------------------------------------------------------------------

@app.post("/llm/review-project")
async def llm_review_project(
    body: ReviewProjectRequest,
    request: Request,
    user_id: str = Depends(get_current_user_id),
):
    """Whole-project AI review, run once every file is finalized. Sees only a
    manifest (filenames, dependencies, extracted rules) — never full code —
    and flags cross-file concerns only. Returns a ProjectReviewResult."""
    _rate_limit(request, "review-project", user_id)
    _check_and_charge_quota(user_id)
    llm = _get_llm()
    _require_configured(llm)

    system, user = build_project_review_prompt(
        project_name=body.project_name,
        manifest=body.manifest,
        file_summaries=[f.model_dump() for f in body.file_summaries],
    )
    content = await llm.complete(
        system=system,
        user=user,
        temperature=0.1,
        max_tokens=3000,
        json_response=True,
    )
    content = _ensure_real_output(content)
    storage.increment_migrations_today(user_id)

    parsed = parse_json_loose(content)
    if not parsed:
        return {
            "summary": "Project review model returned unstructured output.",
            "risk_notes": [],
            "cross_file_concerns": [],
            "confidence": "Low",
        }

    return {
        "summary": parsed.get("summary") or "",
        "risk_notes": parsed.get("risk_notes") or [],
        "cross_file_concerns": parsed.get("cross_file_concerns") or [],
        "confidence": parsed.get("confidence") or "Medium",
    }


# ---------------------------------------------------------------------------
# WS /ws/{project_id}
# ---------------------------------------------------------------------------

@app.websocket("/ws/{project_id}")
async def websocket_endpoint(websocket: WebSocket, project_id: str):
    """
    WebSocket stream for real-time pipeline events.

    Requires a valid Clerk token in the ?token= query parameter.
    The authenticated user must own the requested project_id.
    Past events are replayed on connect so clients can reconstruct state
    even if they connect after the pipeline has started.
    """
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=4001, reason="Missing auth token")
        return
    try:
        ws_user_id = verify_ws_token(token)
    except Exception:
        await websocket.close(code=4001, reason="Invalid auth token")
        return

    project = storage.get(project_id)
    if not project or project.owner_id != ws_user_id:
        await websocket.close(code=4003, reason="Access denied")
        return

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
