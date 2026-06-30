"""models/limits.py — Per-user usage limits and quota tracking."""

from __future__ import annotations

from datetime import date

from pydantic import BaseModel, Field


class UserLimit(BaseModel):
    user_id: str

    # Project quota
    max_projects: int = 10
    projects_used: int = 0

    # File constraints (enforced client-side; stored here for display)
    max_files_per_project: int = 25
    max_file_size_mb: float = 5.0

    # Daily migration budget (AI calls are expensive)
    max_migrations_per_day: int = 50
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
