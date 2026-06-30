"""
core/storage.py — Project persistence layer.

DEMO_MODE=true  → in-memory dict backed by a JSON file (legacylift_data.json).
                   Survives server restarts; no external dependencies.
DEMO_MODE=false → SQLite via SQLAlchemy (future — swap implementation here).

Usage:
    from core.storage import storage

    storage.put(project)
    await storage.persist()   # flush to disk (no-op when demo mode is off)

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

from models.limits import UserLimit
from models.project import Project

logger = logging.getLogger(__name__)


class ProjectStorage:
    """
    Async-safe, mode-agnostic storage backend.

    All reads/writes to the internal dicts are synchronous (O(1) hash ops).
    Disk persistence is async and dispatched to a thread pool to avoid
    blocking the event loop.
    """

    def __init__(self) -> None:
        self._projects: dict[str, Project] = {}
        self._limits: dict[str, UserLimit] = {}
        self._demo_mode: bool = os.getenv("DEMO_MODE", "true").lower() == "true"
        self._data_file: Path = Path(
            os.getenv("STORAGE_FILE", "legacylift_data.json")
        )

    # ------------------------------------------------------------------
    # Startup / teardown
    # ------------------------------------------------------------------

    async def load(self) -> None:
        """Load persisted state from disk (demo mode only)."""
        if not self._demo_mode or not self._data_file.exists():
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

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    async def persist(self) -> None:
        """Flush current state to disk asynchronously (demo mode only)."""
        if not self._demo_mode:
            return
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, self._write_file)

    def _write_file(self) -> None:
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
