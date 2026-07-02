"""
core/storage.py — Project persistence layer.

DEMO_MODE=true  → in-memory dict backed by a JSON file (legacylift_data.json).
                   Survives server restarts; no external dependencies.
DEMO_MODE=false → in-memory dict backed by the shared SQLAlchemy engine from
                   db/session.py (DATABASE_URL — Postgres/Neon in production,
                   SQLite in local dev), normalized across the workbench_*
                   tables in db/models.py. Every mutation still lives in
                   memory for O(1) reads exactly like demo mode; persist()
                   flushes the full in-memory state to those tables so a
                   process restart reloads all projects, user limits, uploaded
                   file content, pipeline outputs, approvals, and migrations.

                   Note: on hosts with an ephemeral filesystem (e.g. Render
                   free-tier web services without an attached Disk) and
                   DATABASE_URL left pointed at local SQLite, data does not
                   survive a redeploy — point DATABASE_URL at a managed
                   Postgres instance (Neon recommended) for real durability.

Usage:
    from core.storage import storage

    storage.put(project)
    await storage.persist()   # flush to disk

    project = storage.get("proj-abc123")
    projects = storage.list_for_user("user_clerk_abc")
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from pathlib import Path
from typing import Optional

from db.session import get_session, init_db as db_init_db
from db.workbench_repositories import (
    delete_workbench_project,
    load_all_projects,
    load_all_user_limits,
    persist_project,
    upsert_workbench_user_limit,
)
from models.limits import UserLimit
from models.project import Project

logger = logging.getLogger(__name__)


class ProjectStorage:
    """
    Async-safe, mode-agnostic storage backend.

    All reads/writes to the internal dicts are synchronous (O(1) hash ops).
    Disk persistence is async: the JSON-file path is dispatched to a thread
    pool, the SQLite path uses aiosqlite's native async driver.
    """

    def __init__(self) -> None:
        self._projects: dict[str, Project] = {}
        self._limits: dict[str, UserLimit] = {}
        self._demo_mode: bool = os.getenv("DEMO_MODE", "true").lower() == "true"
        self._data_file: Path = Path(
            os.getenv("STORAGE_FILE", "legacylift_data.json")
        )
        # Project ids removed via delete() since the last persist() flush —
        # applied to the DB on the next flush (delete() itself stays sync).
        self._pending_deletes: set[str] = set()

    # ------------------------------------------------------------------
    # Startup / teardown
    # ------------------------------------------------------------------

    async def load(self) -> None:
        """Load persisted state from disk (JSON file in demo mode, the shared
        SQLAlchemy DATABASE_URL otherwise)."""
        if self._demo_mode:
            await self._load_json_file()
        else:
            await self._load_db()

    async def _load_json_file(self) -> None:
        if not self._data_file.exists():
            return
        try:
            raw = self._data_file.read_text(encoding="utf-8")
            data = json.loads(raw)
            for pid, pdata in data.get("projects", {}).items():
                self._projects[pid] = Project(**pdata)
            for uid, ldata in data.get("limits", {}).items():
                self._limits[uid] = UserLimit(**ldata)
            logger.info(
                "Loaded %d projects from %s", len(self._projects), self._data_file
            )
        except Exception as exc:
            logger.warning("Could not load storage file: %s — starting fresh", exc)

    async def _load_db(self) -> None:
        try:
            await db_init_db()
            async with get_session() as session:
                self._projects = await load_all_projects(session)
                self._limits = await load_all_user_limits(session)
        except Exception as exc:
            logger.error("Failed to load storage from DATABASE_URL: %s", exc)

        logger.info(
            "Loaded %d project(s) and %d user limit record(s) from DATABASE_URL",
            len(self._projects), len(self._limits),
        )

    async def close(self) -> None:
        """No-op in the DATABASE_URL-backed path: the underlying SQLAlchemy
        engine (db/session.py) is shared with the GitHub-overlay tables and
        must not be disposed here. Kept for API stability — callers (e.g.
        lifespan()'s shutdown sequence) still call storage.close()."""
        return None

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    async def persist(self) -> None:
        """Flush current in-memory state to disk."""
        if self._demo_mode:
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, self._write_json_file)
        else:
            await self._write_db()

    def _write_json_file(self) -> None:
        try:
            data = {
                "projects": {
                    pid: json.loads(p.json())
                    for pid, p in self._projects.items()
                },
                "limits": {
                    uid: lim.dict() for uid, lim in self._limits.items()
                },
            }
            self._data_file.write_text(
                json.dumps(data, default=str, indent=2), encoding="utf-8"
            )
        except Exception as exc:
            logger.error("Failed to persist storage: %s", exc)

    async def _write_db(self) -> None:
        try:
            async with get_session() as session:
                for project_id in list(self._pending_deletes):
                    try:
                        async with session.begin_nested():
                            await delete_workbench_project(session, project_id)
                        self._pending_deletes.discard(project_id)
                    except Exception:
                        logger.exception("Failed to delete project %s", project_id)
                for pid, p in list(self._projects.items()):
                    try:
                        # SAVEPOINT per project: one bad project shouldn't
                        # roll back or block every other user's save —
                        # persist() runs fire-and-forget after nearly every
                        # mutating route, so isolate failures per project.
                        async with session.begin_nested():
                            await persist_project(session, p)
                    except Exception:
                        logger.exception("Failed to persist project %s", pid)
                for uid, lim in list(self._limits.items()):
                    try:
                        async with session.begin_nested():
                            await upsert_workbench_user_limit(session, limit=lim)
                    except Exception:
                        logger.exception("Failed to persist user limits for %s", uid)
        except Exception:
            logger.exception("Failed to persist storage to DATABASE_URL")

    # ------------------------------------------------------------------
    # Project CRUD
    # ------------------------------------------------------------------

    def get(self, project_id: str) -> Optional[Project]:
        return self._projects.get(project_id)

    def put(self, project: Project) -> None:
        self._projects[project.id] = project

    def delete(self, project_id: str) -> None:
        self._projects.pop(project_id, None)
        self._pending_deletes.add(project_id)

    def list_for_user(self, user_id: str) -> list[Project]:
        results = [p for p in self._projects.values() if p.owner_id == user_id]
        results.sort(key=lambda p: p.created_at, reverse=True)
        return results

    # ------------------------------------------------------------------
    # Limits
    # ------------------------------------------------------------------

    def get_limits(self, user_id: str) -> UserLimit:
        if user_id not in self._limits:
            self._limits[user_id] = UserLimit(user_id=user_id)
        return self._limits[user_id]

    def can_create_project(self, user_id: str) -> bool:
        lim = self.get_limits(user_id)
        return lim.projects_used < lim.max_projects

    def increment_projects_used(self, user_id: str) -> None:
        self.get_limits(user_id).projects_used += 1

    def increment_migrations_today(self, user_id: str) -> None:
        lim = self.get_limits(user_id)
        lim.reset_daily_if_needed()
        lim.migrations_today += 1


# Module-level singleton — imported everywhere else.
storage = ProjectStorage()
