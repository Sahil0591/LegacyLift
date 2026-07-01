"""
scripts/migrate_to_neon.py — one-time import of local LegacyLift project data
(the DEMO_MODE=true JSON store, the pre-migration raw-aiosqlite DEMO_MODE=false
store, and/or a browser localStorage export) into the normalized workbench_*
tables at a target DATABASE_URL (Neon Postgres recommended).

Run from server/:
    python -m scripts.migrate_to_neon --source-json legacylift_data.json \
        --target-database-url postgresql+asyncpg://... --dry-run

    python -m scripts.migrate_to_neon --source-json legacylift_data.json \
        --target-database-url postgresql+asyncpg://...

Guarantees:
    - --dry-run parses sources and reports counts; it NEVER opens a
      connection to the target (not even to check reachability).
    - Idempotent: reuses the same upsert-by-id functions core/storage.py
      uses, so re-running against the same target with the same source data
      is a no-op in effect.
    - Never writes to or deletes source files.
    - Never logs the raw target DATABASE_URL (credentials are redacted).
    - Refuses to run against the local default DATABASE_URL, or a
      --source-sqlite file that resolves to the same path as the target, to
      avoid silent no-ops or self-corruption.

Exit codes: 0 success, 1 validation/refusal error, 2 one or more projects
failed to persist during a real run (see the printed summary for which).
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import logging
import sqlite3
import sys
from pathlib import Path

# Allow `python scripts/migrate_to_neon.py` (not just `python -m scripts...`)
# by putting server/ on sys.path regardless of invocation style.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from db.session import (  # noqa: E402
    DEFAULT_DATABASE_URL,
    create_engine,
    get_session,
    init_db,
    redact_database_url,
    validate_database_url,
)
from db.workbench_repositories import persist_project, upsert_workbench_user_limit  # noqa: E402
from models.limits import UserLimit  # noqa: E402
from models.project import Project  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("migrate_to_neon")


class MigrationError(Exception):
    """Validation/refusal error — exit code 1."""


# ---------------------------------------------------------------------------
# Source parsing
# ---------------------------------------------------------------------------

def _sqlite_path_from_url(url: str) -> Path | None:
    if not url.startswith("sqlite") or url.endswith(":memory:"):
        return None
    try:
        path_part = url.split(":///", 1)[1]
    except IndexError:
        return None
    if not path_part or path_part == ":memory:":
        return None
    return Path(path_part).resolve()


def read_source_json(path: Path) -> tuple[dict[str, Project], dict[str, UserLimit]]:
    """Parses the DEMO_MODE=true JSON store: {"projects": {...}, "limits": {...}}."""
    raw = json.loads(path.read_text(encoding="utf-8"))
    projects = {pid: Project(**pdata) for pid, pdata in raw.get("projects", {}).items()}
    limits = {uid: UserLimit(**ldata) for uid, ldata in raw.get("limits", {}).items()}
    return projects, limits


def read_source_sqlite(path: Path) -> tuple[dict[str, Project], dict[str, UserLimit]]:
    """Parses the OLD pre-migration raw-aiosqlite DEMO_MODE=false store —
    tables projects(id, owner_id, data, updated_at) / user_limits(user_id, data),
    where `data` is a JSON-serialized Project/UserLimit. Distinct schema from
    the new workbench_* tables even though both may be sqlite files."""
    conn = sqlite3.connect(str(path))
    try:
        projects: dict[str, Project] = {}
        for pid, data in conn.execute("SELECT id, data FROM projects"):
            try:
                projects[pid] = Project(**json.loads(data))
            except Exception as exc:
                logger.warning("Skipping unreadable project %s from %s: %s", pid, path, exc)

        limits: dict[str, UserLimit] = {}
        for uid, data in conn.execute("SELECT user_id, data FROM user_limits"):
            try:
                limits[uid] = UserLimit(**json.loads(data))
            except Exception as exc:
                logger.warning("Skipping unreadable user limits %s from %s: %s", uid, path, exc)
        return projects, limits
    finally:
        conn.close()


def read_local_export(path: Path, owner_id: str) -> tuple[dict[str, Project], dict[str, UserLimit]]:
    """Best-effort importer for a browser localStorage dump, expected shape:
        {
          "projectIndex": [ {id, name, source, language, ...}, ... ],
          "analysis":    { "<local-id>": <AnalyzeResult>, ... },
          "lessons":     { "<local-id>": [Lesson, ...], ... },
          "progress":    { "<local-id>": {...} },
          "fileStatus":  { "<local-id>": {...} }
        }
    matching the legacylift:project-index / legacylift:analysis:<id> /
    legacylift:lessons:<id> keys client/lib/projectStore.ts and
    client/lib/lessons.ts write to localStorage.

    This does NOT attempt to reverse-map AnalyzeResult chunks into
    workbench_project_files/workbench_chunk_progress (lossy, out of scope for
    a one-off local/offline import) — it preserves the raw analysis blob
    opaquely in pipeline_state_json and imports lessons properly (their shape
    already matches Project.lessons)."""
    raw = json.loads(path.read_text(encoding="utf-8"))
    project_index = {entry["id"]: entry for entry in raw.get("projectIndex", [])}
    analysis_by_id = raw.get("analysis", {})
    lessons_by_id = raw.get("lessons", {})

    projects: dict[str, Project] = {}
    for local_id, analysis in analysis_by_id.items():
        entry = project_index.get(local_id, {})
        synthetic_id = f"proj-import-{hashlib.sha256(local_id.encode()).hexdigest()[:10]}"
        lessons = [
            {
                "id": lesson["id"],
                "source": lesson["source"],
                "source_file": lesson.get("sourceFile"),
                "chunk_name": lesson.get("chunkName"),
                "text": lesson["text"],
                "created_at": lesson["createdAt"],
            }
            for lesson in lessons_by_id.get(local_id, [])
        ]
        projects[synthetic_id] = Project(
            id=synthetic_id,
            owner_id=owner_id,
            name=entry.get("name") or analysis.get("projectName") or "Imported local project",
            lessons=lessons,
            # Preserve the raw client-side analysis blob for audit/backup —
            # deliberately not decomposed into files/chunk-progress tables.
            target_profile={"imported_from_local": True, "local_raw_analysis": analysis},
        )
    return projects, {}


# ---------------------------------------------------------------------------
# Counting / reporting
# ---------------------------------------------------------------------------

def _chunk_ids_for(project: Project) -> set[str]:
    return (
        set(project.chunk_approvals)
        | set(project.chunk_migrations)
        | set(project.chunk_static_analysis)
        | set(project.chunk_ai_reviews)
        | set(project.chunk_test_results)
    )


def summarize(projects: dict[str, Project], limits: dict[str, UserLimit]) -> dict[str, int]:
    return {
        "projects": len(projects),
        "files": sum(len(p.files) for p in projects.values()),
        "chunks": sum(len(_chunk_ids_for(p)) for p in projects.values()),
        "lessons": sum(len(p.lessons) for p in projects.values()),
        "limits": len(limits),
    }


# ---------------------------------------------------------------------------
# Writing
# ---------------------------------------------------------------------------

async def write_to_target(
    target_url: str,
    projects: dict[str, Project],
    limits: dict[str, UserLimit],
    batch_size: int,
) -> int:
    """Returns the count of projects that failed to persist."""
    engine = create_engine(target_url)
    try:
        await init_db(engine)

        failures = 0
        project_ids = list(projects)
        for start in range(0, len(project_ids), batch_size):
            batch = project_ids[start : start + batch_size]
            async with get_session(engine) as session:
                for pid in batch:
                    try:
                        async with session.begin_nested():
                            await persist_project(session, projects[pid])
                        logger.info("Imported project %s", pid)
                    except Exception as exc:
                        failures += 1
                        logger.error("Failed to import project %s: %s", pid, exc)

        async with get_session(engine) as session:
            for uid, lim in limits.items():
                try:
                    async with session.begin_nested():
                        await upsert_workbench_user_limit(session, limit=lim)
                    logger.info("Imported user limits for %s", uid)
                except Exception as exc:
                    failures += 1
                    logger.error("Failed to import user limits for %s: %s", uid, exc)

        return failures
    finally:
        await engine.dispose()


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--target-database-url", required=True, help="Destination DATABASE_URL (Neon Postgres recommended).")
    parser.add_argument("--source-json", type=Path, default=None, help="DEMO_MODE=true JSON store (default: ./legacylift_data.json if present).")
    parser.add_argument("--source-sqlite", type=Path, default=None, help="Old pre-migration raw-aiosqlite legacylift.db.")
    parser.add_argument("--local-export", type=Path, default=None, help="Browser localStorage export JSON (see read_local_export docstring for shape).")
    parser.add_argument("--owner-id", default=None, help="Required with --local-export — local projects have no owner_id of their own.")
    parser.add_argument("--dry-run", action="store_true", help="Parse sources and report counts; never connects to the target.")
    parser.add_argument("--batch-size", type=int, default=50, help="Projects per transaction batch during a real run (default: 50).")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_arg_parser().parse_args(argv)

    default_json = Path("legacylift_data.json")
    source_json = args.source_json or (default_json if default_json.exists() else None)

    if not source_json and not args.source_sqlite and not args.local_export:
        logger.error("No source provided — pass --source-json, --source-sqlite, and/or --local-export.")
        return 1

    if args.local_export and not args.owner_id:
        logger.error("--local-export requires --owner-id (local projects have no owner_id of their own).")
        return 1

    try:
        if args.target_database_url == DEFAULT_DATABASE_URL:
            raise MigrationError(
                "--target-database-url resolves to the local default DATABASE_URL — refusing to run "
                "(this would migrate local data onto itself)."
            )
        validate_database_url(args.target_database_url)
        target_sqlite_path = _sqlite_path_from_url(args.target_database_url)
        if target_sqlite_path is not None and args.source_sqlite and target_sqlite_path == args.source_sqlite.resolve():
            raise MigrationError("--target-database-url resolves to the same file as --source-sqlite — refusing to run.")
    except (MigrationError, RuntimeError) as exc:
        logger.error(str(exc))
        return 1

    projects: dict[str, Project] = {}
    limits: dict[str, UserLimit] = {}

    if source_json:
        p, l = read_source_json(source_json)
        logger.info("Read %d project(s), %d user limit(s) from %s", len(p), len(l), source_json)
        projects.update(p)
        limits.update(l)

    if args.source_sqlite:
        p, l = read_source_sqlite(args.source_sqlite)
        logger.info("Read %d project(s), %d user limit(s) from %s", len(p), len(l), args.source_sqlite)
        projects.update(p)
        limits.update(l)

    if args.local_export:
        p, l = read_local_export(args.local_export, args.owner_id)
        logger.info("Read %d project(s) from local export %s", len(p), args.local_export)
        projects.update(p)
        limits.update(l)

    counts = summarize(projects, limits)
    logger.info("Total: %s", counts)

    if args.dry_run:
        logger.info(
            "Dry run — target %s was never contacted. Re-run without --dry-run to import.",
            redact_database_url(args.target_database_url),
        )
        return 0

    logger.info("Importing into %s ...", redact_database_url(args.target_database_url))
    failures = asyncio.run(write_to_target(args.target_database_url, projects, limits, args.batch_size))

    if failures:
        logger.error("%d item(s) failed to import — see errors above.", failures)
        return 2

    logger.info("Done. Imported %d project(s), %d user limit(s).", len(projects), len(limits))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
