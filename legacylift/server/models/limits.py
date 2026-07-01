"""models/limits.py — Per-user usage limits and quota tracking."""

from __future__ import annotations

import os
from datetime import date

from pydantic import BaseModel, Field


def _default_daily_migration_limit() -> int:
    # Every LLM proxy call charges this counter (migrate, review, tests, and
    # project-review), so one chunk's happy path alone costs 3 units, and one
    # auto-fix round on a flagged chunk costs 3 more. A real filetree migration
    # (100-200 chunks, some needing 2-3 fix rounds) can land at 700-1000+ units
    # in a single sitting, so a flat 50/day breaks on the first small file.
    return int(os.getenv("LLM_DAILY_MIGRATION_LIMIT", "1000"))


class UserLimit(BaseModel):
    user_id: str

    # Project quota
    max_projects: int = 10
    projects_used: int = 0

    # File constraints (enforced client-side; stored here for display)
    max_files_per_project: int = 25
    max_file_size_mb: float = 5.0

    # Daily migration budget (AI calls are expensive) — override with
    # LLM_DAILY_MIGRATION_LIMIT for local/test sessions that need more headroom.
    max_migrations_per_day: int = Field(default_factory=_default_daily_migration_limit)
    migrations_today: int = 0
    migrations_reset_date: str = Field(default_factory=lambda: date.today().isoformat())

    def reset_daily_if_needed(self) -> None:
        today = date.today().isoformat()
        if self.migrations_reset_date != today:
            self.migrations_today = 0
            self.migrations_reset_date = today

    @property
    def projects_remaining(self) -> int:
        return max(0, self.max_projects - self.projects_used)

    @property
    def migrations_remaining_today(self) -> int:
        self.reset_daily_if_needed()
        return max(0, self.max_migrations_per_day - self.migrations_today)
