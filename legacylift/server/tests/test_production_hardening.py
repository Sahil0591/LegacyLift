"""
tests/test_production_hardening.py — MVP production-readiness checks.

Covers the behaviours a hackathon-prototype backend is prone to fake:
  - VB6 upload + parsing is real, not an unsupported false claim
  - The upload allow-list matches what the parser can actually chunk
  - DEMO_MODE=false never silently falls back to placeholder LLM output
  - Layer 0 fails the pipeline honestly when it finds nothing to migrate
  - SQLite persistence (DEMO_MODE=false) survives a process restart
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

# ── Environment must be set BEFORE importing the app ─────────────────────────
os.environ["DEMO_MODE"] = "true"
os.environ.setdefault(
    "CLERK_JWKS_URL",
    "https://placeholder.clerk.accounts.dev/.well-known/jwks.json",
)

sys.path.insert(0, str(Path(__file__).parent.parent))

import db.session as db_session_module
from api.auth import get_current_user_id
from api.main import app, _ALLOWED_EXTENSIONS
from core.storage import ProjectStorage
from core.pipeline import run_pipeline
from models.project import Project, SourceLanguage, UploadedFile
from utils.code_parser import parse_file

OWNER_ID = "user_hardening_001"


def _make_project(owner_id: str = OWNER_ID, **kwargs) -> Project:
    defaults = dict(name="Hardening Project", source_language=SourceLanguage.COBOL,
                     target_language="Python", owner_id=owner_id)
    defaults.update(kwargs)
    return Project(**defaults)


def _client_for(user_id: str) -> TestClient:
    app.dependency_overrides[get_current_user_id] = lambda: user_id
    return TestClient(app, raise_server_exceptions=True)


@pytest.fixture(autouse=True)
def clean_dependency_overrides():
    yield
    app.dependency_overrides.pop(get_current_user_id, None)


# ===========================================================================
# VB6 support — real parsing, not a false "supported" claim
# ===========================================================================

VB6_SOURCE = """\
Attribute VB_Name = "modInterest"
Public InterestThreshold As Currency

Public Function CalcInterest(ByVal balance As Currency) As Currency
    Dim rate As Double
    If balance < InterestThreshold Then
        rate = 0.025
    Else
        rate = 0.0375
    End If
    CalcInterest = balance * rate
End Function

Private Sub LogInterest(ByVal amount As Currency)
    Call CalcInterest(1000)
End Sub
"""


class TestVB6Parsing:
    def test_vb6_extension_detected(self):
        parsed = parse_file("modInterest.bas", VB6_SOURCE)
        assert parsed.language == "vb6"

    def test_vb6_extracts_procedures(self):
        parsed = parse_file("modInterest.bas", VB6_SOURCE)
        names = {c.name for c in parsed.chunks}
        assert names == {"CalcInterest", "LogInterest"}
        assert all(c.language == "vb6" for c in parsed.chunks)

    def test_vb6_extracts_call_edges(self):
        parsed = parse_file("modInterest.bas", VB6_SOURCE)
        log_chunk = next(c for c in parsed.chunks if c.name == "LogInterest")
        assert "CalcInterest" in log_chunk.calls

    def test_vb6_extracts_module_variable(self):
        parsed = parse_file("modInterest.bas", VB6_SOURCE)
        names = {d.name for d in parsed.data_items}
        assert "InterestThreshold" in names
        assert "modInterest" in names

    def test_unsupported_extension_returns_empty_not_crash(self):
        parsed = parse_file("weird.xyz", "whatever content")
        assert parsed.language == "unknown"
        assert parsed.chunks == []


# ===========================================================================
# Upload allow-list — frontend/backend parity, VB6 included, junk excluded
# ===========================================================================

class TestUploadAllowList:
    def _upload(self, project_id: str, filename: str, content: bytes = b"data"):
        client = _client_for(OWNER_ID)
        return client.post(
            f"/project/{project_id}/upload",
            files=[("files", (filename, content, "text/plain"))],
        )

    @pytest.mark.parametrize("ext", [".vb", ".bas", ".frm", ".cls"])
    def test_vb6_extensions_accepted(self, ext):
        from core.storage import storage
        project = _make_project()
        storage.put(project)
        r = self._upload(project.id, f"module{ext}", b"Public Sub Foo()\nEnd Sub\n")
        assert r.status_code == 200, r.text
        storage.delete(project.id)

    @pytest.mark.parametrize("ext", [".py", ".js", ".ts", ".txt", ".jcl", ".pco", ".exe"])
    def test_unparseable_extensions_rejected(self, ext):
        """Anything the parser can't chunk must not silently claim to be supported."""
        from core.storage import storage
        project = _make_project()
        storage.put(project)
        r = self._upload(project.id, f"file{ext}")
        assert r.status_code == 415
        storage.delete(project.id)

    def test_allowed_extensions_all_map_to_a_known_parser_language(self):
        """Every extension the backend accepts must resolve to a real chunker."""
        from utils.code_parser import _detect_language
        for ext in _ALLOWED_EXTENSIONS:
            assert _detect_language(ext) != "unknown", f"{ext} accepted but unparseable"


# ===========================================================================
# DEMO_MODE=false — no silent placeholder fallback
# ===========================================================================

class TestNoSilentDemoFallback:
    @pytest.mark.asyncio
    async def test_complete_raises_when_not_configured_in_production(self, monkeypatch):
        monkeypatch.setenv("DEMO_MODE", "false")
        monkeypatch.delenv("VENICE_API_KEY", raising=False)
        from utils.llm_client import LLMClient, LLMNotConfiguredError

        client = LLMClient()
        assert client.is_configured() is False
        with pytest.raises(LLMNotConfiguredError):
            await client.complete(system="sys", user="usr")

    def test_placeholder_env_value_is_not_treated_as_configured(self, monkeypatch):
        """The literal .env.example placeholder must never look 'configured'."""
        monkeypatch.setenv("DEMO_MODE", "false")
        monkeypatch.setenv("VENICE_API_KEY", "your-venice-api-key-here")
        from utils.llm_client import LLMClient

        client = LLMClient()
        assert client.is_configured() is False

    @pytest.mark.asyncio
    async def test_demo_mode_still_returns_canned_response(self, monkeypatch):
        """DEMO_MODE=true must keep working without a key (existing demo UX)."""
        monkeypatch.setenv("DEMO_MODE", "true")
        monkeypatch.delenv("VENICE_API_KEY", raising=False)
        from utils.llm_client import LLMClient

        client = LLMClient()
        result = await client.complete(system="sys", user="usr")
        assert result  # canned demo response, not an exception


# ===========================================================================
# Layer 0 — zero chunks must fail the pipeline, not silently succeed
# ===========================================================================

class TestLayer0NoChunksFailure:
    @pytest.mark.asyncio
    async def test_pipeline_fails_when_no_chunks_found(self):
        project = _make_project(name="Empty COBOL Project")
        project.files.append(UploadedFile(
            filename="empty.cbl",
            language=SourceLanguage.COBOL,
            # No PROCEDURE DIVISION / paragraphs -> zero chunks from the parser.
            content="       IDENTIFICATION DIVISION.\n       PROGRAM-ID. EMPTYPROG.\n",
            size_bytes=64,
        ))

        await run_pipeline(project)

        status = project.status if isinstance(project.status, str) else project.status.value
        assert status == "failed"
        assert project.error
        assert "no migratable code" in project.error.lower()

    @pytest.mark.asyncio
    async def test_pipeline_succeeds_when_chunks_found(self):
        project = _make_project(name="Real COBOL Project")
        project.files.append(UploadedFile(
            filename="real.cbl",
            language=SourceLanguage.COBOL,
            content=(
                "       IDENTIFICATION DIVISION.\n"
                "       PROGRAM-ID. REALPROG.\n"
                "       PROCEDURE DIVISION.\n"
                "       MAIN-PARA.\n"
                "           DISPLAY 'HELLO'.\n"
            ),
            size_bytes=128,
        ))

        await run_pipeline(project)

        status = project.status if isinstance(project.status, str) else project.status.value
        assert status == "ready"
        assert project.chunk_count > 0


# ===========================================================================
# Persistence — SQLite storage survives a reload
# ===========================================================================

class TestSqlitePersistenceReload:
    @pytest.mark.asyncio
    async def test_project_and_limits_survive_reload(self, tmp_path, monkeypatch):
        db_path = tmp_path / "hardening_test.db"
        monkeypatch.setenv("DEMO_MODE", "false")
        monkeypatch.setenv("DATABASE_URL", f"sqlite+aiosqlite:///{db_path}")
        db_session_module._engine = None
        db_session_module._session_factory = None

        try:
            store1 = ProjectStorage()
            await store1.load()
            project = _make_project(name="Persisted Project", owner_id="user_persist")
            store1.put(project)
            store1.get_limits("user_persist").projects_used = 3
            await store1.persist()
            await store1.close()

            store2 = ProjectStorage()
            await store2.load()
            try:
                reloaded = store2.get(project.id)
                assert reloaded is not None
                assert reloaded.name == "Persisted Project"
                assert store2.get_limits("user_persist").projects_used == 3
            finally:
                await store2.close()
        finally:
            engine = db_session_module.get_engine()
            await engine.dispose()
            db_session_module._engine = None
            db_session_module._session_factory = None


# ===========================================================================
# Layer 4 — no silent substitution of an unrelated demo schema in production
# ===========================================================================

class TestLayer4NoSilentSchemaFallback:
    @pytest.mark.asyncio
    async def test_no_sql_uploaded_skips_honestly_in_production(self, monkeypatch):
        """A project with no .sql upload must not be validated against the
        bundled demo schema (ACCT_MSTR/TXNS) — that would report bogus
        MISSING TABLE issues for tables the project never had."""
        monkeypatch.setattr("core.layer4.schema_validator.DEMO_MODE", False)
        from core.layer4.schema_validator import SchemaValidator

        project = _make_project(name="No Schema Project")
        result = await SchemaValidator().validate(project, [])

        assert result.passed is True
        assert result.tables_checked == 0
        assert not any("ACCT_MSTR" in issue for issue in result.issues)

    @pytest.mark.asyncio
    async def test_demo_mode_still_uses_bundled_demo_schema(self, monkeypatch):
        """DEMO_MODE=true must keep the existing demo UX (no upload required)."""
        monkeypatch.setattr("core.layer4.schema_validator.DEMO_MODE", True)
        from core.layer4.schema_validator import SchemaValidator

        project = _make_project(name="Demo Schema Project")
        result = await SchemaValidator().validate(project, [])

        assert result.tables_checked > 0
