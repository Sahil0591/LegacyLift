from __future__ import annotations

import hashlib
import hmac
import json
from pathlib import Path

import pytest
import pytest_asyncio
from sqlalchemy import select

from db.models import (
    BaselineIndexJob,
    CodeChunk,
    GitHubWebhookDelivery,
    PullRequestChangedFile,
    PullRequestHunk,
    PullRequestHunkMatch,
)
from db.repositories import upsert_code_chunk, upsert_commit, upsert_repository
from db.session import create_engine, init_db, session_factory
from integrations.github_app import (
    GitHubAppSettings,
    create_mock_installation_token,
    verify_webhook_signature,
)
from integrations.github_client import MockGitHubClient
from integrations.github_ingestion import (
    parse_changed_file,
    parse_installation_repositories,
    process_github_webhook,
    sync_pull_request_files,
)
from integrations.github_patches import parse_patch_hunks


@pytest_asyncio.fixture
async def db_session(tmp_path: Path):
    db_file = tmp_path / "legacylift-github-app.db"
    engine = create_engine(f"sqlite+aiosqlite:///{db_file}")
    await init_db(engine)
    async_session = session_factory(engine)

    async with async_session() as session:
        yield session
        await session.rollback()

    await engine.dispose()


def signed_header(secret: str, body: bytes) -> str:
    digest = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    return f"sha256={digest}"


def installation_payload() -> dict:
    return {
        "action": "created",
        "installation": {"id": 4242},
        "repositories": [
            {
                "id": 111,
                "name": "accounts",
                "full_name": "legacy-bank/accounts",
                "html_url": "https://github.com/legacy-bank/accounts",
                "default_branch": "main",
            }
        ],
    }


def pull_request_payload() -> dict:
    return {
        "action": "opened",
        "installation": {"id": 4242},
        "repository": {
            "id": 111,
            "name": "accounts",
            "full_name": "legacy-bank/accounts",
            "html_url": "https://github.com/legacy-bank/accounts",
            "default_branch": "main",
        },
        "pull_request": {
            "number": 7,
            "state": "open",
            "base": {"sha": "base123", "ref": "main"},
            "head": {"sha": "head456", "ref": "feature/rate-change"},
        },
    }


def changed_file_payload() -> dict:
    return {
        "filename": "src/interest.cbl",
        "status": "modified",
        "sha": "file-sha",
        "additions": 2,
        "deletions": 1,
        "changes": 3,
        "patch": (
            "@@ -10,6 +10,7 @@ CALC-INTEREST.\n"
            " MOVE WS-BALANCE TO WS-AMOUNT.\n"
            "-IF WS-BALANCE > 10000\n"
            "+IF WS-BALANCE > 15000\n"
            "+  MOVE 0.035 TO WS-RATE\n"
            " END-IF.\n"
        ),
    }


def test_github_app_settings_reads_documented_environment(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("GITHUB_APP_ID", "123")
    monkeypatch.setenv("GITHUB_PRIVATE_KEY", "-----BEGIN PRIVATE KEY-----\\n...")
    monkeypatch.setenv("GITHUB_WEBHOOK_SECRET", "top-secret")
    monkeypatch.setenv("GITHUB_CLIENT_ID", "client-id")
    monkeypatch.setenv("GITHUB_CLIENT_SECRET", "client-secret")

    settings = GitHubAppSettings.from_env()

    assert settings.app_id == "123"
    assert settings.webhook_secret == "top-secret"
    assert settings.client_id == "client-id"
    assert settings.client_secret == "client-secret"


def test_webhook_signature_verification_accepts_valid_and_rejects_invalid_signature():
    body = json.dumps({"zen": "Keep it logically awesome."}).encode("utf-8")

    assert verify_webhook_signature(body, signed_header("secret", body), "secret") is True
    assert verify_webhook_signature(body, "sha256=bad", "secret") is False
    assert verify_webhook_signature(body, "", "secret") is False


def test_installation_and_changed_file_payload_parsing():
    repositories = parse_installation_repositories(installation_payload())
    changed_file = parse_changed_file(changed_file_payload())

    assert repositories[0].owner == "legacy-bank"
    assert repositories[0].name == "accounts"
    assert repositories[0].github_repository_id == "111"
    assert changed_file.path == "src/interest.cbl"
    assert changed_file.status == "modified"
    assert changed_file.patch.startswith("@@ -10")


def test_patch_hunk_parser_extracts_new_and_old_line_ranges():
    hunks = parse_patch_hunks(changed_file_payload()["patch"])

    assert len(hunks) == 1
    assert hunks[0].header == "@@ -10,6 +10,7 @@ CALC-INTEREST."
    assert hunks[0].old_start_line == 10
    assert hunks[0].old_end_line == 15
    assert hunks[0].new_start_line == 10
    assert hunks[0].new_end_line == 16
    assert "15000" in hunks[0].patch


@pytest.mark.asyncio
async def test_bdd_app_installation_stores_repository_and_queues_baseline_indexing(db_session):
    body = json.dumps(installation_payload()).encode("utf-8")

    result = await process_github_webhook(
        db_session,
        event="installation",
        delivery_id="delivery-install-1",
        payload=installation_payload(),
        raw_body=body,
    )
    await db_session.commit()

    jobs = (await db_session.execute(select(BaselineIndexJob))).scalars().all()

    assert result["status"] == "processed"
    assert result["repositories"] == 1
    assert len(jobs) == 1
    assert jobs[0].status == "queued"
    assert jobs[0].ref == "main"


@pytest.mark.asyncio
async def test_bdd_pull_request_opened_stores_changed_files_hunks_and_chunk_matches(db_session):
    repository = await upsert_repository(
        db_session,
        github_owner="legacy-bank",
        github_name="accounts",
        default_branch="main",
        installation_id="4242",
    )
    await upsert_commit(db_session, repository_id=repository.id, sha="base123", ref="main")
    chunk = await upsert_code_chunk(
        db_session,
        repository_id=repository.id,
        commit_sha="base123",
        path="src/interest.cbl",
        name="CALC-INTEREST",
        language="cobol",
        start_line=8,
        end_line=20,
        source="IF WS-BALANCE > 10000 MOVE 0.025 TO WS-RATE.",
    )
    client = MockGitHubClient(
        changed_files={("legacy-bank", "accounts", 7): [changed_file_payload()]},
    )

    result = await process_github_webhook(
        db_session,
        event="pull_request",
        delivery_id="delivery-pr-1",
        payload=pull_request_payload(),
        raw_body=json.dumps(pull_request_payload()).encode("utf-8"),
        github_client=client,
    )
    await db_session.commit()

    files = (await db_session.execute(select(PullRequestChangedFile))).scalars().all()
    hunks = (await db_session.execute(select(PullRequestHunk))).scalars().all()
    matches = (await db_session.execute(select(PullRequestHunkMatch))).scalars().all()

    assert result["status"] == "processed"
    assert result["files"] == 1
    assert result["hunks"] == 1
    assert files[0].path == "src/interest.cbl"
    assert hunks[0].new_start_line == 10
    assert matches[0].code_chunk_id == chunk.id
    assert matches[0].overlap_start_line == 10
    assert matches[0].overlap_end_line == 16


@pytest.mark.asyncio
async def test_bdd_webhook_retry_is_idempotent_by_delivery_id(db_session):
    payload = installation_payload()
    body = json.dumps(payload).encode("utf-8")

    first = await process_github_webhook(
        db_session,
        event="installation",
        delivery_id="delivery-install-dup",
        payload=payload,
        raw_body=body,
    )
    second = await process_github_webhook(
        db_session,
        event="installation",
        delivery_id="delivery-install-dup",
        payload=payload,
        raw_body=body,
    )
    await db_session.commit()

    deliveries = (await db_session.execute(select(GitHubWebhookDelivery))).scalars().all()
    jobs = (await db_session.execute(select(BaselineIndexJob))).scalars().all()

    assert first["status"] == "processed"
    assert second["status"] == "duplicate"
    assert len(deliveries) == 1
    assert len(jobs) == 1


@pytest.mark.asyncio
async def test_sync_pull_request_files_is_idempotent_for_same_pr_head(db_session):
    repository = await upsert_repository(
        db_session,
        github_owner="legacy-bank",
        github_name="accounts",
        default_branch="main",
        installation_id="4242",
    )
    pull_request = await sync_pull_request_files(
        db_session,
        repository=repository,
        pr_number=7,
        base_sha="base123",
        head_sha="head456",
        state="open",
        files=[changed_file_payload()],
    )
    same_pull_request = await sync_pull_request_files(
        db_session,
        repository=repository,
        pr_number=7,
        base_sha="base123",
        head_sha="head456",
        state="open",
        files=[changed_file_payload()],
    )
    await db_session.commit()

    files = (await db_session.execute(select(PullRequestChangedFile))).scalars().all()
    hunks = (await db_session.execute(select(PullRequestHunk))).scalars().all()

    assert same_pull_request.id == pull_request.id
    assert len(files) == 1
    assert len(hunks) == 1


@pytest.mark.asyncio
async def test_mock_installation_token_and_client_helpers_are_deterministic():
    token = create_mock_installation_token(installation_id="4242", app_id="123")
    client = MockGitHubClient(
        tree={("legacy-bank", "accounts", "main"): [{"path": "src/interest.cbl", "type": "blob"}]},
        contents={("legacy-bank", "accounts", "src/interest.cbl", "main"): "DISPLAY 'HELLO'."},
        changed_files={("legacy-bank", "accounts", 7): [changed_file_payload()]},
    )

    assert token.token.startswith("mock-installation-token-123-4242")
    assert token.expires_at.isoformat().endswith("+00:00")
    assert await client.repository_tree("legacy-bank", "accounts", "main") == [
        {"path": "src/interest.cbl", "type": "blob"}
    ]
    assert await client.file_contents("legacy-bank", "accounts", "src/interest.cbl", "main") == "DISPLAY 'HELLO'."
    assert (await client.pull_request_files("legacy-bank", "accounts", 7))[0]["filename"] == "src/interest.cbl"
