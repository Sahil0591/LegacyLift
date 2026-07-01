"""
core/storage.py — Project persistence layer.

DEMO_MODE=true  → in-memory dict backed by a JSON file (legacylift_data.json).
                   Survives server restarts; no external dependencies.
DEMO_MODE=false → in-memory dict backed by SQLite (via aiosqlite). Every
                   mutation still lives in memory for O(1) reads exactly like
                   demo mode; persist() upserts the changed rows to disk so a
                   process restart reloads all projects, user limits, uploaded
                   file content, pipeline outputs, approvals, and migrations.

                   Note: on hosts with an ephemeral filesystem (e.g. Render
                   free-tier web services without an attached Disk), the
                   SQLite file does not survive a redeploy — attach a
                   persistent disk and point SQLITE_DB_PATH at it for real
                   durability.

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
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import aiosqlite

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
        self._db_path: Path = Path(os.getenv("SQLITE_DB_PATH", "legacylift.db"))
        self._db: Optional[aiosqlite.Connection] = None

    # ------------------------------------------------------------------
    # Startup / teardown
    # ------------------------------------------------------------------

    async def load(self) -> None:
        """Load persisted state from disk (JSON file in demo mode, SQLite otherwise)."""
        if self._demo_mode:
            await self._load_json_file()
        else:
            await self._load_sqlite()

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

    async def _load_sqlite(self) -> None:
        self._db = await aiosqlite.connect(str(self._db_path))
        await self._db.execute(
            """
            CREATE TABLE IF NOT EXISTS projects (
                id         TEXT PRIMARY KEY,
                owner_id   TEXT NOT NULL,
                data       TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        await self._db.execute(
            """
            CREATE TABLE IF NOT EXISTS user_limits (
                user_id TEXT PRIMARY KEY,
                data    TEXT NOT NULL
            )
            """
        )
        await self._db.commit()

        try:
            async with self._db.execute("SELECT id, data FROM projects") as cur:
                async for pid, data in cur:
                    try:
                        self._projects[pid] = Project(**json.loads(data))
                    except Exception as exc:
                        logger.error("Failed to load project %s from SQLite: %s", pid, exc)

            async with self._db.execute("SELECT user_id, data FROM user_limits") as cur:
                async for uid, data in cur:
                    try:
                        self._limits[uid] = UserLimit(**json.loads(data))
                    except Exception as exc:
                        logger.error("Failed to load limits for %s from SQLite: %s", uid, exc)
        except Exception as exc:
            logger.error("Failed to load storage from SQLite (%s): %s", self._db_path, exc)

        logger.info(
            "Loaded %d project(s) and %d user limit record(s) from SQLite (%s)",
            len(self._projects), len(self._limits), self._db_path,
        )

    async def close(self) -> None:
        """Close the SQLite connection (no-op in demo mode). Call on shutdown."""
        if self._db is not None:
            await self._db.close()
            self._db = None

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    async def persist(self) -> None:
        """Flush current in-memory state to disk."""
        if self._demo_mode:
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, self._write_json_file)
        else:
            await self._write_sqlite()

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

    async def _write_sqlite(self) -> None:
        if self._db is None:
            # persist() can be scheduled before load() finishes on the very
            # first request in rare interleavings; nothing to do yet.
            return
        try:
            now = datetime.now(timezone.utc).isoformat()
            for pid, p in list(self._projects.items()):
                await self._db.execute(
                    """
                    INSERT INTO projects (id, owner_id, data, updated_at)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        owner_id=excluded.owner_id,
                        data=excluded.data,
                        updated_at=excluded.updated_at
                    """,
                    (pid, p.owner_id, p.json(), now),
                )
            for uid, lim in list(self._limits.items()):
                await self._db.execute(
                    """
                    INSERT INTO user_limits (user_id, data) VALUES (?, ?)
                    ON CONFLICT(user_id) DO UPDATE SET data=excluded.data
                    """,
                    (uid, lim.json()),
                )
            await self._db.commit()
        except Exception as exc:
            logger.error("Failed to persist storage to SQLite: %s", exc)

    # ------------------------------------------------------------------
    # Project CRUD
    # ------------------------------------------------------------------

    def get(self, project_id: str) -> Optional[Project]:
        return self._projects.get(project_id)

    def put(self, project: Project) -> None:
        self._projects[project.id] = project

    def delete(self, project_id: str) -> None:
        self._projects.pop(project_id, None)

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
