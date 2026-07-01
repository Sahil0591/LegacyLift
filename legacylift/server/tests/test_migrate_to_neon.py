"""
tests/test_migrate_to_neon.py — scripts/migrate_to_neon.py: dry-run behavior,
idempotency, refusal conditions, and credential redaction.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from db.session import DEFAULT_DATABASE_URL, get_session
from db.workbench_repositories import load_all_projects
from models.project import Project, SourceLanguage
from scripts.migrate_to_neon import main, read_source_json, summarize


def _write_source_json(path: Path, project_ids: list[str]) -> None:
    projects = {}
    for pid in project_ids:
        project = Project(id=pid, owner_id="user_1", name=f"Project {pid}", source_language=SourceLanguage.COBOL)
        projects[pid] = json.loads(project.json())
    path.write_text(json.dumps({"projects": projects, "limits": {}}), encoding="utf-8")


def test_read_source_json_and_summarize_report_correct_counts(tmp_path: Path):
    source = tmp_path / "legacylift_data.json"
    _write_source_json(source, ["proj-a", "proj-b", "proj-c"])

    projects, limits = read_source_json(source)
    counts = summarize(projects, limits)

    assert counts["projects"] == 3
    assert counts["limits"] == 0


def test_dry_run_never_contacts_target(tmp_path: Path, caplog: pytest.LogCaptureFixture):
    caplog.set_level("INFO")
    source = tmp_path / "legacylift_data.json"
    _write_source_json(source, ["proj-a", "proj-b"])

    # An unreachable/non-resolving host — if the script ever opened a
    # connection despite --dry-run, this would raise or hang instead of
    # returning cleanly.
    exit_code = main(
        [
            "--source-json", str(source),
            "--target-database-url", "postgresql+asyncpg://user:secret_password@does-not-exist.invalid/db",
            "--dry-run",
        ]
    )

    assert exit_code == 0
    assert "'projects': 2" in caplog.text
    assert "secret_password" not in caplog.text


def test_real_run_lands_rows_in_target(tmp_path: Path):
    source = tmp_path / "legacylift_data.json"
    _write_source_json(source, ["proj-x", "proj-y"])
    target_db = tmp_path / "target.db"
    target_url = f"sqlite+aiosqlite:///{target_db}"

    exit_code = main(["--source-json", str(source), "--target-database-url", target_url])
    assert exit_code == 0

    import asyncio
    from db.session import create_engine, session_factory

    async def _check():
        engine = create_engine(target_url)
        async with session_factory(engine)() as session:
            projects = await load_all_projects(session)
        await engine.dispose()
        return projects

    projects = asyncio.run(_check())
    assert set(projects) == {"proj-x", "proj-y"}


def test_idempotent_rerun_produces_same_row_count(tmp_path: Path):
    source = tmp_path / "legacylift_data.json"
    _write_source_json(source, ["proj-x", "proj-y"])
    target_db = tmp_path / "target.db"
    target_url = f"sqlite+aiosqlite:///{target_db}"

    assert main(["--source-json", str(source), "--target-database-url", target_url]) == 0
    assert main(["--source-json", str(source), "--target-database-url", target_url]) == 0

    import asyncio
    from db.session import create_engine, session_factory

    async def _check():
        engine = create_engine(target_url)
        async with session_factory(engine)() as session:
            projects = await load_all_projects(session)
        await engine.dispose()
        return projects

    projects = asyncio.run(_check())
    assert len(projects) == 2


def test_refuses_default_target(tmp_path: Path):
    source = tmp_path / "legacylift_data.json"
    _write_source_json(source, ["proj-a"])

    exit_code = main(["--source-json", str(source), "--target-database-url", DEFAULT_DATABASE_URL])
    assert exit_code == 1


def test_never_logs_raw_credentials(tmp_path: Path, caplog: pytest.LogCaptureFixture):
    caplog.set_level("INFO")
    source = tmp_path / "legacylift_data.json"
    _write_source_json(source, ["proj-a"])

    main(
        [
            "--source-json", str(source),
            "--target-database-url", "postgresql+asyncpg://someuser:supersecret@does-not-exist.invalid/db",
            "--dry-run",
        ]
    )

    assert "supersecret" not in caplog.text
