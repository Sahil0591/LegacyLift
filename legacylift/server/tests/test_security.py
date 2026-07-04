"""
tests/test_security.py — Security-focused integration tests.

Covers:
  - WebSocket cross-tenant access (issue #3)
  - Upload file count, size, extension, and duplicate limits (issue #4)
"""

from __future__ import annotations

import io
import os
import sys
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

# ── Environment must be set BEFORE importing the app ─────────────────────────
os.environ["DEMO_MODE"] = "true"
os.environ.setdefault(
    "CLERK_JWKS_URL",
    "https://placeholder.clerk.accounts.dev/.well-known/jwks.json",
)

sys.path.insert(0, str(Path(__file__).parent.parent))

from api.auth import get_current_user_id
from api.main import app, _MAX_UPLOAD_FILES, _MAX_FILE_BYTES
from core.storage import storage
from models.project import Project, SourceLanguage

OWNER_ID  = "user_owner_111"
OTHER_ID  = "user_other_222"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_project(owner_id: str) -> Project:
    p = Project(
        name="Test Project",
        source_language=SourceLanguage.COBOL,
        target_language="Python",
        owner_id=owner_id,
    )
    storage.put(p)
    return p


def _client_for(user_id: str) -> TestClient:
    """Return a TestClient whose auth dependency resolves to user_id."""
    app.dependency_overrides[get_current_user_id] = lambda: user_id
    return TestClient(app, raise_server_exceptions=True)


@pytest.fixture(autouse=True)
def clean_storage():
    yield
    # Remove any projects and limits created during the test
    storage._projects.clear()
    storage._limits.pop(OWNER_ID, None)
    storage._limits.pop(OTHER_ID, None)
    app.dependency_overrides.pop(get_current_user_id, None)


# ===========================================================================
# WebSocket — tenant isolation (issue #3)
# ===========================================================================

class TestWebSocketTenantIsolation:

    def test_owner_can_connect(self):
        """Project owner can open a WebSocket for their own project."""
        project = _make_project(OWNER_ID)
        with patch("api.main.verify_ws_token", return_value=OWNER_ID):
            client = TestClient(app)
            with client.websocket_connect(
                f"/ws/{project.id}?token=VALID_OWNER_TOKEN"
            ) as ws:
                # Connection accepted — receive any replayed events or just confirm open
                pass  # no exception means accepted

    def test_other_user_cannot_connect(self):
        """Authenticated user who does not own the project gets close code 4003."""
        project = _make_project(OWNER_ID)
        with patch("api.main.verify_ws_token", return_value=OTHER_ID):
            client = TestClient(app)
            with pytest.raises(Exception):
                # TestClient raises WebSocketDisconnect or similar on 4003
                with client.websocket_connect(
                    f"/ws/{project.id}?token=VALID_OTHER_TOKEN"
                ) as ws:
                    ws.receive_json()

    def test_missing_token_rejected(self):
        """WebSocket without a token gets close code 4001."""
        project = _make_project(OWNER_ID)
        client = TestClient(app)
        with pytest.raises(Exception):
            with client.websocket_connect(f"/ws/{project.id}") as ws:
                ws.receive_json()

    def test_invalid_token_rejected(self):
        """WebSocket with an invalid token gets close code 4001."""
        project = _make_project(OWNER_ID)
        with patch("api.main.verify_ws_token", side_effect=Exception("bad token")):
            client = TestClient(app)
            with pytest.raises(Exception):
                with client.websocket_connect(
                    f"/ws/{project.id}?token=GARBAGE"
                ) as ws:
                    ws.receive_json()

    def test_nonexistent_project_denied(self):
        """WebSocket for a project_id that doesn't exist gets close code 4003."""
        with patch("api.main.verify_ws_token", return_value=OWNER_ID):
            client = TestClient(app)
            with pytest.raises(Exception):
                with client.websocket_connect(
                    "/ws/proj-does-not-exist?token=VALID_TOKEN"
                ) as ws:
                    ws.receive_json()


class TestTargetLanguageValidation:
    def test_create_project_rejects_unsupported_target(self):
        client = _client_for(OWNER_ID)
        r = client.post(
            "/project",
            json={
                "name": "Unsupported Target",
                "source_language": "cobol",
                "target_language": "Brainfuck",
            },
        )

        assert r.status_code == 422
        assert "Unsupported target language" in r.text

    def test_import_project_rejects_unsupported_target_config(self):
        client = _client_for(OWNER_ID)
        r = client.post(
            "/project/import",
            json={
                "analysis": {"chunks": [], "summary": {}, "targetProfile": {}},
                "config": {"targets": {"default": "Brainfuck"}},
            },
        )

        assert r.status_code == 422
        assert "Unsupported target language" in r.text

    def test_import_project_rejects_unsupported_per_file_target_config(self):
        client = _client_for(OWNER_ID)
        r = client.post(
            "/project/import",
            json={
                "analysis": {"chunks": [], "summary": {}, "targetProfile": {}},
                "config": {
                    "targets": {
                        "default": "Python",
                        "perFile": {"interest.cbl": "Brainfuck"},
                    }
                },
            },
        )

        assert r.status_code == 422
        assert "Unsupported target language for interest.cbl" in r.text

    def test_save_progress_rejects_unsupported_per_file_target_before_mutating(self):
        project = _make_project(OWNER_ID)
        project.chunk_migrations = {"chunk-1": "keep this migration"}
        project.client_config = {"targets": {"default": "Python"}}

        client = _client_for(OWNER_ID)
        r = client.put(
            f"/project/{project.id}/progress",
            json={
                "chunks": [],
                "finalized_files": {},
                "config": {
                    "targets": {
                        "default": "Python",
                        "perFile": {"interest.cbl": "Brainfuck"},
                    }
                },
            },
        )

        assert r.status_code == 422
        assert "Unsupported target language for interest.cbl" in r.text
        assert project.chunk_migrations == {"chunk-1": "keep this migration"}
        assert project.client_config == {"targets": {"default": "Python"}}


# ===========================================================================
# Upload — file count, size, extension, and duplicate limits (issue #4)
# ===========================================================================

class TestUploadLimits:

    def _upload(self, project_id: str, files: list[tuple[str, bytes, str]]):
        """POST /project/{id}/upload with the given (name, content, content_type) tuples."""
        client = _client_for(OWNER_ID)
        return client.post(
            f"/project/{project_id}/upload",
            files=[("files", (name, content, ct)) for name, content, ct in files],
        )

    def test_happy_path_single_file(self):
        project = _make_project(OWNER_ID)
        r = self._upload(project.id, [("main.cbl", b"IDENTIFICATION DIVISION.", "text/plain")])
        assert r.status_code == 200
        assert r.json()["file_count"] == 1

    def test_too_many_files_rejected(self):
        project = _make_project(OWNER_ID)
        files = [(f"file_{i}.cbl", b"DATA.", "text/plain") for i in range(_MAX_UPLOAD_FILES + 1)]
        r = self._upload(project.id, files)
        assert r.status_code == 400
        assert "too many" in r.json()["detail"].lower()

    def test_file_too_large_rejected(self):
        project = _make_project(OWNER_ID)
        big = b"X" * (_MAX_FILE_BYTES + 1)
        r = self._upload(project.id, [("big.cbl", big, "text/plain")])
        assert r.status_code == 413
        assert "limit" in r.json()["detail"].lower()

    def test_empty_file_rejected(self):
        project = _make_project(OWNER_ID)
        r = self._upload(project.id, [("empty.cbl", b"", "text/plain")])
        assert r.status_code == 400
        assert "empty" in r.json()["detail"].lower()

    def test_disallowed_extension_rejected(self):
        project = _make_project(OWNER_ID)
        r = self._upload(project.id, [("script.exe", b"MZ", "application/octet-stream")])
        assert r.status_code == 415
        assert "not allowed" in r.json()["detail"].lower()

    def test_duplicate_filename_rejected(self):
        project = _make_project(OWNER_ID)
        r = self._upload(
            project.id,
            [
                ("main.cbl", b"DATA.", "text/plain"),
                ("main.cbl", b"DATA.", "text/plain"),
            ],
        )
        assert r.status_code == 400
        assert "duplicate" in r.json()["detail"].lower()

    def test_other_user_cannot_upload_to_project(self):
        """Non-owner upload returns 403."""
        project = _make_project(OWNER_ID)
        client = _client_for(OTHER_ID)
        r = client.post(
            f"/project/{project.id}/upload",
            files=[("files", ("main.cbl", b"DATA.", "text/plain"))],
        )
        assert r.status_code == 403
