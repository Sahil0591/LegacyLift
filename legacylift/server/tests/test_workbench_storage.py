"""
tests/test_workbench_storage.py — core/storage.py's DEMO_MODE=false path
(the shared SQLAlchemy DATABASE_URL / workbench_* tables), tested against a
temp-file SQLite DATABASE_URL (Neon/Postgres isn't available in CI).
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

import pytest
import pytest_asyncio
from sqlalchemy import select

import db.session as db_session_module
from core.storage import ProjectStorage
from db.models import (
    Base,
    WorkbenchChunkProgress,
    WorkbenchFileStatus,
    WorkbenchLesson,
    WorkbenchProject,
    WorkbenchProjectFile,
    WorkbenchUserLimit,
)
from db.session import get_session, init_db
from models.limits import UserLimit
from models.project import Project, SourceLanguage, UploadedFile


@pytest_asyncio.fixture
async def workbench_storage(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Points DATABASE_URL at a fresh temp-file sqlite DB and resets
    db/session.py's module-level engine/session-factory globals so
    get_engine() picks up the new URL — ProjectStorage manages its own
    sessions via those globals rather than an injected session."""
    db_file = tmp_path / "workbench-test.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite+aiosqlite:///{db_file}")
    monkeypatch.setenv("DEMO_MODE", "false")
    db_session_module._engine = None
    db_session_module._session_factory = None

    yield ProjectStorage

    engine = db_session_module.get_engine()
    await engine.dispose()
    db_session_module._engine = None
    db_session_module._session_factory = None


def _make_project(project_id: str = "proj-abc12345", owner_id: str = "user_1") -> Project:
    return Project(
        id=project_id,
        owner_id=owner_id,
        name="Test Project",
        source_language=SourceLanguage.COBOL,
        target_language="Python",
        files=[
            UploadedFile(
                # UploadedFile.id is uuid4-generated in production and thus
                # globally unique — derive from project_id here too so two
                # fabricated test projects never collide on the same id.
                id=f"file-{project_id}",
                filename="interest.cbl",
                language=SourceLanguage.COBOL,
                content="MOVE 10000 TO WS-LIMIT",
                size_bytes=42,
                line_count=3,
                detected_dependencies=["ACCOUNTS"],
            )
        ],
        layer0_chunks=[{"id": "chunk-1", "filename": "interest.cbl", "name": "CALC"}],
        chunk_approvals={"chunk-1": "approved"},
        chunk_migrations={"chunk-1": "def calc(): return 1"},
        chunk_static_analysis={"chunk-1": {"passed": True}},
        chunk_ai_reviews={"chunk-1": {"score": 0.9}},
        chunk_test_results={"chunk-1": [{"name": "test_calc", "passed": True}]},
        lessons=[
            {
                "id": "lesson-abc1234567",
                "source": "ai_review",
                "source_file": "interest.cbl",
                "chunk_name": "CALC",
                "text": "Watch for rounding.",
                "created_at": datetime.utcnow().isoformat(),
            }
        ],
        dependency_graph={"A": ["B"]},
        risk_scores={"interest.cbl": 0.4},
        error_log=["warning: something"],
    )


@pytest.mark.asyncio
async def test_schema_creates_all_six_workbench_tables(tmp_path: Path):
    from db.session import create_engine

    engine = create_engine(f"sqlite+aiosqlite:///{tmp_path / 'schema-test.db'}")
    await init_db(engine)

    expected = {
        WorkbenchProject.__tablename__,
        WorkbenchProjectFile.__tablename__,
        WorkbenchChunkProgress.__tablename__,
        WorkbenchFileStatus.__tablename__,
        WorkbenchLesson.__tablename__,
        WorkbenchUserLimit.__tablename__,
    }
    assert expected <= set(Base.metadata.tables)
    await engine.dispose()


@pytest.mark.asyncio
async def test_storage_roundtrip_persists_and_reloads_full_project(workbench_storage):
    project = _make_project()

    storage1 = workbench_storage()
    await storage1.load()  # creates schema (empty)
    storage1.put(project)
    await storage1.persist()

    storage2 = workbench_storage()
    await storage2.load()

    reloaded = storage2.get(project.id)
    assert reloaded is not None
    assert reloaded.name == "Test Project"
    assert reloaded.owner_id == "user_1"
    assert len(reloaded.files) == 1
    assert reloaded.files[0].filename == "interest.cbl"
    assert reloaded.files[0].content == "MOVE 10000 TO WS-LIMIT"
    assert reloaded.chunk_approvals == {"chunk-1": "approved"}
    assert reloaded.chunk_migrations == {"chunk-1": "def calc(): return 1"}
    assert reloaded.chunk_static_analysis == {"chunk-1": {"passed": True}}
    assert reloaded.chunk_ai_reviews == {"chunk-1": {"score": 0.9}}
    assert reloaded.chunk_test_results == {"chunk-1": [{"name": "test_calc", "passed": True}]}
    assert len(reloaded.lessons) == 1
    assert reloaded.lessons[0]["text"] == "Watch for rounding."
    assert reloaded.dependency_graph == {"A": ["B"]}
    assert reloaded.risk_scores == {"interest.cbl": 0.4}
    assert reloaded.error_log == ["warning: something"]


@pytest.mark.asyncio
async def test_owner_isolation_on_list_for_user(workbench_storage):
    project_a = _make_project(project_id="proj-owner-a", owner_id="user_a")
    project_b = _make_project(project_id="proj-owner-b", owner_id="user_b")

    storage1 = workbench_storage()
    await storage1.load()
    storage1.put(project_a)
    storage1.put(project_b)
    await storage1.persist()

    storage2 = workbench_storage()
    await storage2.load()

    a_projects = storage2.list_for_user("user_a")
    b_projects = storage2.list_for_user("user_b")
    assert [p.id for p in a_projects] == ["proj-owner-a"]
    assert [p.id for p in b_projects] == ["proj-owner-b"]


@pytest.mark.asyncio
async def test_user_limits_persist_and_reload(workbench_storage):
    storage1 = workbench_storage()
    await storage1.load()
    lim = storage1.get_limits("user_1")
    lim.projects_used = 3
    lim.migrations_today = 7
    await storage1.persist()

    storage2 = workbench_storage()
    await storage2.load()
    reloaded: UserLimit = storage2.get_limits("user_1")
    assert reloaded.projects_used == 3
    assert reloaded.migrations_today == 7


@pytest.mark.asyncio
async def test_file_status_projection_is_write_only(workbench_storage):
    project = _make_project()

    storage1 = workbench_storage()
    await storage1.load()
    storage1.put(project)
    await storage1.persist()

    async with get_session() as session:
        result = await session.execute(
            select(WorkbenchFileStatus).where(WorkbenchFileStatus.project_id == project.id)
        )
        rows = result.scalars().all()

    assert len(rows) == 1
    assert rows[0].filename == "interest.cbl"
    assert rows[0].total_chunks == 1
    assert rows[0].approved_chunks == 1
    assert rows[0].is_finalized is True

    # Not round-tripped into Project — no such field exists on the model.
    storage2 = workbench_storage()
    await storage2.load()
    reloaded = storage2.get(project.id)
    assert not hasattr(reloaded, "file_statuses")
    assert not hasattr(reloaded, "workbench_file_statuses")


@pytest.mark.asyncio
async def test_delete_project_cascades_children(workbench_storage):
    project = _make_project()

    storage1 = workbench_storage()
    await storage1.load()
    storage1.put(project)
    await storage1.persist()

    storage1.delete(project.id)
    await storage1.persist()

    async with get_session() as session:
        for table in (
            WorkbenchProject,
            WorkbenchProjectFile,
            WorkbenchChunkProgress,
            WorkbenchFileStatus,
            WorkbenchLesson,
        ):
            column = table.id if table is WorkbenchProject else table.project_id
            result = await session.execute(select(table).where(column == project.id))
            assert result.scalars().all() == [], f"{table.__tablename__} still has rows for {project.id}"
