"""
db/workbench_repositories.py — Async upsert/reconstruct helpers for workbench
project persistence (core/storage.py, DEMO_MODE=false).

Mirrors db/repositories.py's select-then-insert-or-update-then-flush pattern.
Splits a Project/UserLimit Pydantic object across six tables on persist, and
reassembles it on load. See db/models.py for the schema and the rationale for
what stays normalized vs. what lives in workbench_projects.pipeline_state_json.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import (
    WorkbenchChunkProgress,
    WorkbenchFileStatus,
    WorkbenchLesson,
    WorkbenchProject,
    WorkbenchProjectFile,
    WorkbenchUserLimit,
)
from db.repositories import source_hash
from models.limits import UserLimit
from models.project import Project, UploadedFile

# Residual pipeline fields not normalized into their own table — stored
# verbatim as JSON on workbench_projects.pipeline_state_json.
_RESIDUAL_FIELDS = (
    "dependency_graph",
    "risk_scores",
    "target_profile",
    "layer0_rules",
    "layer0_graph",
    "layer0_chunks",
    "uploaded_files",
    "selected_chunk_id",
    "current_migration",
    "chunk_rule_statuses",
    "chunk_rule_reviews",
    "error",
    "error_log",
    "started_at",
    "completed_at",
    "chunk_count",
    "risk_summary",
    "needs_review_count",
    "business_rules",
    # Client-driven ("cloud") workbench blobs — persisted verbatim so the
    # browser can rehydrate the exact state it computed (see models/project.py).
    "client_analysis",
    "client_progress",
    "client_file_status",
)


def _default(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def _dumps(data: Any) -> str:
    return json.dumps(data, default=_default)


def _loads(raw: str | None, fallback: Any = None) -> Any:
    if not raw:
        return fallback
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return fallback


def _enum_value(value: Any) -> str:
    """Project/UploadedFile use `Config.use_enum_values = True`, which only
    converts enum fields to their plain string .value during validation —
    Pydantic v2 does NOT validate a field's *default* value, so an enum field
    left at its default (e.g. Project.status when never explicitly passed)
    stays a raw enum member. str(enum_member) on a `class X(str, Enum)`
    prints the qualified name ("ProjectStatus.CREATED"), not the value, so
    that can't be used directly — pull .value defensively instead."""
    return value.value if hasattr(value, "value") else value


# ---------------------------------------------------------------------------
# workbench_projects
# ---------------------------------------------------------------------------

async def upsert_workbench_project(session: AsyncSession, *, project: Project) -> WorkbenchProject:
    residual = {field: getattr(project, field) for field in _RESIDUAL_FIELDS}
    pipeline_state_json = _dumps(residual)

    result = await session.execute(select(WorkbenchProject).where(WorkbenchProject.id == project.id))
    row = result.scalar_one_or_none()

    if row is None:
        row = WorkbenchProject(
            id=project.id,
            owner_id=project.owner_id,
            name=project.name,
            status=_enum_value(project.status),
            source_language=_enum_value(project.source_language),
            target_language=project.target_language,
            pipeline_state_json=pipeline_state_json,
        )
        session.add(row)
    else:
        row.owner_id = project.owner_id
        row.name = project.name
        row.status = _enum_value(project.status)
        row.source_language = _enum_value(project.source_language)
        row.target_language = project.target_language
        row.pipeline_state_json = pipeline_state_json

    await session.flush()
    return row


async def delete_workbench_project(session: AsyncSession, project_id: str) -> None:
    """Explicitly deletes child rows before the parent row. SQLite does not
    enforce ON DELETE CASCADE without PRAGMA foreign_keys=ON (not set anywhere
    in this codebase), so relying on the ORM-declared CASCADE alone would
    silently orphan rows under local/dev/test SQLite even though Postgres
    would enforce it correctly."""
    for table in (WorkbenchProjectFile, WorkbenchChunkProgress, WorkbenchFileStatus, WorkbenchLesson):
        await session.execute(delete(table).where(table.project_id == project_id))
    await session.execute(delete(WorkbenchProject).where(WorkbenchProject.id == project_id))
    await session.flush()


async def list_workbench_projects_for_owner(session: AsyncSession, owner_id: str) -> list[WorkbenchProject]:
    result = await session.execute(select(WorkbenchProject).where(WorkbenchProject.owner_id == owner_id))
    return list(result.scalars().all())


# ---------------------------------------------------------------------------
# workbench_project_files
# ---------------------------------------------------------------------------

async def replace_workbench_project_files(
    session: AsyncSession, *, project_id: str, owner_id: str, files: list[UploadedFile]
) -> None:
    await session.execute(delete(WorkbenchProjectFile).where(WorkbenchProjectFile.project_id == project_id))
    for f in files:
        session.add(
            WorkbenchProjectFile(
                id=f.id,
                project_id=project_id,
                owner_id=owner_id,
                filename=f.filename,
                language=_enum_value(f.language),
                content=f.content,
                content_hash=source_hash(f.content or ""),
                size_bytes=f.size_bytes,
                line_count=f.line_count,
                detected_dependencies_json=_dumps(f.detected_dependencies or []),
            )
        )
    await session.flush()


def _reconstruct_files(rows: list[WorkbenchProjectFile]) -> list[UploadedFile]:
    files: list[UploadedFile] = []
    for row in rows:
        files.append(
            UploadedFile(
                id=row.id,
                filename=row.filename,
                language=row.language,
                content=row.content,
                size_bytes=row.size_bytes,
                uploaded_at=row.created_at,
                line_count=row.line_count,
                detected_dependencies=_loads(row.detected_dependencies_json, []),
            )
        )
    return files


# ---------------------------------------------------------------------------
# workbench_chunk_progress
# ---------------------------------------------------------------------------

async def replace_workbench_chunk_progress(
    session: AsyncSession, *, project_id: str, owner_id: str, project: Project
) -> None:
    await session.execute(delete(WorkbenchChunkProgress).where(WorkbenchChunkProgress.project_id == project_id))
    chunk_ids = (
        set(project.chunk_approvals)
        | set(project.chunk_migrations)
        | set(project.chunk_static_analysis)
        | set(project.chunk_ai_reviews)
        | set(project.chunk_test_results)
    )
    for chunk_id in chunk_ids:
        session.add(
            WorkbenchChunkProgress(
                project_id=project_id,
                owner_id=owner_id,
                chunk_id=chunk_id,
                status=project.chunk_approvals.get(chunk_id, "pending"),
                migrated_code=project.chunk_migrations.get(chunk_id, ""),
                static_analysis_json=(
                    _dumps(project.chunk_static_analysis[chunk_id])
                    if chunk_id in project.chunk_static_analysis
                    else None
                ),
                ai_review_json=(
                    _dumps(project.chunk_ai_reviews[chunk_id]) if chunk_id in project.chunk_ai_reviews else None
                ),
                test_results_json=_dumps(project.chunk_test_results.get(chunk_id, [])),
            )
        )
    await session.flush()


def reconstruct_chunk_dicts(
    rows: list[WorkbenchChunkProgress],
) -> tuple[dict[str, str], dict[str, str], dict[str, dict], dict[str, dict], dict[str, list]]:
    """Pure inverse of replace_workbench_chunk_progress — rebuilds the five
    original Project dict fields from stored rows.

    "pending"/"" are the synthesized defaults for chunks that never had a
    real chunk_approvals/chunk_migrations entry (see replace_* above) — they
    are excluded here so a reload doesn't fabricate dict keys the original
    Project never had."""
    chunk_approvals: dict[str, str] = {}
    chunk_migrations: dict[str, str] = {}
    chunk_static_analysis: dict[str, dict] = {}
    chunk_ai_reviews: dict[str, dict] = {}
    chunk_test_results: dict[str, list] = {}

    for row in rows:
        if row.status != "pending":
            chunk_approvals[row.chunk_id] = row.status
        if row.migrated_code:
            chunk_migrations[row.chunk_id] = row.migrated_code
        if row.static_analysis_json:
            chunk_static_analysis[row.chunk_id] = _loads(row.static_analysis_json)
        if row.ai_review_json:
            chunk_ai_reviews[row.chunk_id] = _loads(row.ai_review_json)
        chunk_test_results[row.chunk_id] = _loads(row.test_results_json, [])

    return chunk_approvals, chunk_migrations, chunk_static_analysis, chunk_ai_reviews, chunk_test_results


# ---------------------------------------------------------------------------
# workbench_file_statuses (write-only computed projection)
# ---------------------------------------------------------------------------

def derive_file_statuses(project: Project) -> list[dict]:
    """Pure function: for each filename referenced in layer0_chunks, counts
    total vs. approved chunks. Not round-tripped into Project — no such field
    exists on the Pydantic model. Kept purely for future querying."""
    totals: dict[str, int] = {}
    approved: dict[str, int] = {}

    for chunk in project.layer0_chunks:
        filename = chunk.get("filename") or chunk.get("path") or "unknown"
        chunk_id = chunk.get("id")
        totals[filename] = totals.get(filename, 0) + 1
        if chunk_id is not None and project.chunk_approvals.get(chunk_id) == "approved":
            approved[filename] = approved.get(filename, 0) + 1

    return [
        {
            "filename": filename,
            "total_chunks": total,
            "approved_chunks": approved.get(filename, 0),
            "is_finalized": total > 0 and approved.get(filename, 0) == total,
        }
        for filename, total in totals.items()
    ]


async def replace_workbench_file_statuses(
    session: AsyncSession, *, project_id: str, owner_id: str, project: Project
) -> None:
    await session.execute(delete(WorkbenchFileStatus).where(WorkbenchFileStatus.project_id == project_id))
    for status in derive_file_statuses(project):
        session.add(
            WorkbenchFileStatus(
                project_id=project_id,
                owner_id=owner_id,
                filename=status["filename"],
                total_chunks=status["total_chunks"],
                approved_chunks=status["approved_chunks"],
                is_finalized=status["is_finalized"],
            )
        )
    await session.flush()


# ---------------------------------------------------------------------------
# workbench_lessons
# ---------------------------------------------------------------------------

async def upsert_workbench_lessons(
    session: AsyncSession, *, project_id: str, owner_id: str, lessons: list[dict]
) -> None:
    """Append-only in practice; upsert-by-id is naturally idempotent and
    cheap given lesson counts stay small."""
    for lesson in lessons:
        lesson_id = lesson.get("id")
        if not lesson_id:
            continue
        result = await session.execute(select(WorkbenchLesson).where(WorkbenchLesson.id == lesson_id))
        row = result.scalar_one_or_none()
        created_at = lesson.get("created_at")
        parsed_created_at = (
            datetime.fromisoformat(created_at) if isinstance(created_at, str) else datetime.utcnow()
        )
        if row is None:
            session.add(
                WorkbenchLesson(
                    id=lesson_id,
                    project_id=project_id,
                    owner_id=owner_id,
                    source=lesson.get("source", ""),
                    source_file=lesson.get("source_file"),
                    chunk_name=lesson.get("chunk_name"),
                    text=lesson.get("text", ""),
                    created_at=parsed_created_at,
                )
            )
        else:
            row.source = lesson.get("source", "")
            row.source_file = lesson.get("source_file")
            row.chunk_name = lesson.get("chunk_name")
            row.text = lesson.get("text", "")
    await session.flush()


async def delete_workbench_lesson(session: AsyncSession, *, project_id: str, lesson_id: str) -> None:
    await session.execute(
        delete(WorkbenchLesson).where(
            WorkbenchLesson.project_id == project_id, WorkbenchLesson.id == lesson_id
        )
    )
    await session.flush()


async def load_workbench_lessons(session: AsyncSession, project_id: str) -> list[dict]:
    result = await session.execute(
        select(WorkbenchLesson).where(WorkbenchLesson.project_id == project_id).order_by(WorkbenchLesson.created_at)
    )
    return [_lesson_row_to_dict(row) for row in result.scalars().all()]


def _lesson_row_to_dict(row: WorkbenchLesson) -> dict:
    return {
        "id": row.id,
        "source": row.source,
        "source_file": row.source_file,
        "chunk_name": row.chunk_name,
        "text": row.text,
        "created_at": row.created_at.isoformat(),
    }


# ---------------------------------------------------------------------------
# workbench_user_limits
# ---------------------------------------------------------------------------

async def upsert_workbench_user_limit(session: AsyncSession, *, limit: UserLimit) -> WorkbenchUserLimit:
    result = await session.execute(select(WorkbenchUserLimit).where(WorkbenchUserLimit.user_id == limit.user_id))
    row = result.scalar_one_or_none()

    if row is None:
        row = WorkbenchUserLimit(
            user_id=limit.user_id,
            max_projects=limit.max_projects,
            projects_used=limit.projects_used,
            max_files_per_project=limit.max_files_per_project,
            max_file_size_mb=limit.max_file_size_mb,
            max_migrations_per_day=limit.max_migrations_per_day,
            migrations_today=limit.migrations_today,
            migrations_reset_date=limit.migrations_reset_date,
        )
        session.add(row)
    else:
        row.max_projects = limit.max_projects
        row.projects_used = limit.projects_used
        row.max_files_per_project = limit.max_files_per_project
        row.max_file_size_mb = limit.max_file_size_mb
        row.max_migrations_per_day = limit.max_migrations_per_day
        row.migrations_today = limit.migrations_today
        row.migrations_reset_date = limit.migrations_reset_date

    await session.flush()
    return row


def _limit_row_to_model(row: WorkbenchUserLimit) -> UserLimit:
    return UserLimit(
        user_id=row.user_id,
        max_projects=row.max_projects,
        projects_used=row.projects_used,
        max_files_per_project=row.max_files_per_project,
        max_file_size_mb=row.max_file_size_mb,
        max_migrations_per_day=row.max_migrations_per_day,
        migrations_today=row.migrations_today,
        migrations_reset_date=row.migrations_reset_date,
    )


async def load_workbench_user_limit(session: AsyncSession, user_id: str) -> UserLimit | None:
    result = await session.execute(select(WorkbenchUserLimit).where(WorkbenchUserLimit.user_id == user_id))
    row = result.scalar_one_or_none()
    return _limit_row_to_model(row) if row else None


async def load_all_user_limits(session: AsyncSession) -> dict[str, UserLimit]:
    result = await session.execute(select(WorkbenchUserLimit))
    return {row.user_id: _limit_row_to_model(row) for row in result.scalars().all()}


# ---------------------------------------------------------------------------
# Orchestrators
# ---------------------------------------------------------------------------

async def persist_project(session: AsyncSession, project: Project) -> None:
    await upsert_workbench_project(session, project=project)
    await replace_workbench_project_files(session, project_id=project.id, owner_id=project.owner_id, files=project.files)
    await replace_workbench_chunk_progress(session, project_id=project.id, owner_id=project.owner_id, project=project)
    await replace_workbench_file_statuses(session, project_id=project.id, owner_id=project.owner_id, project=project)
    await upsert_workbench_lessons(
        session, project_id=project.id, owner_id=project.owner_id, lessons=project.lessons
    )


async def load_workbench_project(session: AsyncSession, project_id: str) -> Project | None:
    result = await session.execute(select(WorkbenchProject).where(WorkbenchProject.id == project_id))
    row = result.scalar_one_or_none()
    if row is None:
        return None

    file_rows = (
        await session.execute(select(WorkbenchProjectFile).where(WorkbenchProjectFile.project_id == project_id))
    ).scalars().all()
    chunk_rows = (
        await session.execute(select(WorkbenchChunkProgress).where(WorkbenchChunkProgress.project_id == project_id))
    ).scalars().all()
    lessons = await load_workbench_lessons(session, project_id)

    return _row_to_project(row, list(file_rows), list(chunk_rows), lessons)


def _row_to_project(
    row: WorkbenchProject,
    file_rows: list[WorkbenchProjectFile],
    chunk_rows: list[WorkbenchChunkProgress],
    lessons: list[dict],
) -> Project:
    residual = _loads(row.pipeline_state_json, {})
    chunk_approvals, chunk_migrations, chunk_static_analysis, chunk_ai_reviews, chunk_test_results = (
        reconstruct_chunk_dicts(chunk_rows)
    )

    return Project(
        id=row.id,
        owner_id=row.owner_id,
        name=row.name,
        status=row.status,
        source_language=row.source_language,
        target_language=row.target_language,
        created_at=row.created_at,
        files=_reconstruct_files(file_rows),
        chunk_approvals=chunk_approvals,
        chunk_migrations=chunk_migrations,
        chunk_static_analysis=chunk_static_analysis,
        chunk_ai_reviews=chunk_ai_reviews,
        chunk_test_results=chunk_test_results,
        lessons=lessons,
        **residual,
    )


async def load_all_projects(session: AsyncSession) -> dict[str, Project]:
    """Batch-loads each child table across all project ids in one query per
    table (not one query per project) to avoid N+1, then groups in Python."""
    project_rows = (await session.execute(select(WorkbenchProject))).scalars().all()
    if not project_rows:
        return {}

    all_files = (await session.execute(select(WorkbenchProjectFile))).scalars().all()
    all_chunks = (await session.execute(select(WorkbenchChunkProgress))).scalars().all()
    all_lessons = (await session.execute(select(WorkbenchLesson))).scalars().all()

    files_by_project: dict[str, list[WorkbenchProjectFile]] = {}
    for f in all_files:
        files_by_project.setdefault(f.project_id, []).append(f)

    chunks_by_project: dict[str, list[WorkbenchChunkProgress]] = {}
    for c in all_chunks:
        chunks_by_project.setdefault(c.project_id, []).append(c)

    lessons_by_project: dict[str, list[dict]] = {}
    for lesson_row in sorted(all_lessons, key=lambda r: r.created_at):
        lessons_by_project.setdefault(lesson_row.project_id, []).append(_lesson_row_to_dict(lesson_row))

    projects: dict[str, Project] = {}
    for row in project_rows:
        projects[row.id] = _row_to_project(
            row,
            files_by_project.get(row.id, []),
            chunks_by_project.get(row.id, []),
            lessons_by_project.get(row.id, []),
        )
    return projects
