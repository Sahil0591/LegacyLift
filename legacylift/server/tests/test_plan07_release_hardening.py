from __future__ import annotations

from contextlib import asynccontextmanager
import hashlib
import hmac
import json
from pathlib import Path
from typing import AsyncIterator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

import api.github_overlay as github_overlay
import api.main as main_api
from api.main import app
from db.models import GitHubWebhookDelivery, Repository
from db.repositories import (
    upsert_code_chunk,
    upsert_commit,
    upsert_decision_criterion,
    upsert_ownership_classification,
    upsert_pull_request,
    upsert_repository,
)
from db.session import create_engine, init_db, session_factory


@pytest_asyncio.fixture
async def plan07_store(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    db_file = tmp_path / "legacylift-plan07.db"
    engine = create_engine(f"sqlite+aiosqlite:///{db_file}")
    await init_db(engine)
    async_session = session_factory(engine)

    @asynccontextmanager
    async def test_get_session() -> AsyncIterator:
        async with async_session() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    monkeypatch.setattr(github_overlay, "get_session", test_get_session)
    monkeypatch.setattr(main_api, "get_session", test_get_session)
    if hasattr(github_overlay, "reset_overlay_rate_limiter"):
        github_overlay.reset_overlay_rate_limiter()

    async with async_session() as session:
        repository = await upsert_repository(
            session,
            github_owner="acme",
            github_name="checkout",
            default_branch="main",
            installation_id="4242",
        )
        await upsert_commit(session, repository_id=repository.id, sha="abc123", ref="main")
        chunk = await upsert_code_chunk(
            session,
            repository_id=repository.id,
            commit_sha="abc123",
            path="src/checkout/risk.cbl",
            name="CHECKOUT-RISK",
            language="cobol",
            start_line=10,
            end_line=18,
            source="IF PURCHASE-AMOUNT > 500.00 MOVE 'Y' TO MANUAL-REVIEW.",
        )
        criterion = await upsert_decision_criterion(
            session,
            code_chunk_id=chunk.id,
            summary="Orders over $500 require manual review.",
            hardcoded_values=["500.00"],
            evidence={"matched": "monetary threshold"},
            confidence=0.94,
        )
        await upsert_ownership_classification(
            session,
            decision_criterion_id=criterion.id,
            owner_name="Finance",
            confidence=0.91,
            evidence="Matched monetary threshold and manual-review gate.",
            matched_signals=["amount", "threshold"],
            inferred_by="classifier",
        )
        await upsert_repository(
            session,
            github_owner="acme",
            github_name="uninstalled",
            default_branch="main",
            installation_id=None,
        )
        await session.commit()
        yield async_session, f"ann_{criterion.id}"

    if hasattr(github_overlay, "reset_overlay_rate_limiter"):
        github_overlay.reset_overlay_rate_limiter()
    await engine.dispose()


@pytest_asyncio.fixture
async def plan07_client(plan07_store):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        yield client


def _auth_headers(user: str = "reviewer@example.com") -> dict[str, str]:
    return {
        "X-LegacyLift-User": user,
        "Authorization": "Bearer plan07-secret",
    }


def _signed_header(secret: str, body: bytes) -> str:
    digest = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    return f"sha256={digest}"


def _installation_payload() -> dict:
    return {
        "action": "created",
        "installation": {"id": 4242},
        "repositories": [
            {
                "id": 111,
                "name": "checkout",
                "full_name": "acme/checkout",
                "html_url": "https://github.com/acme/checkout",
                "default_branch": "main",
            }
        ],
    }


def test_setup_docs_include_release_readiness_commands_and_security_settings():
    # The README is intentionally a high-level tour; the canonical operational
    # reference (env vars, security settings, deep-dive commands) lives in
    # PIPELINE_DOCUMENTATION.md, which the README links to. Treat both together
    # as the "setup docs" so this check follows the content, not a single file.
    root = Path(__file__).resolve().parents[2]
    docs = (root / "README.md").read_text() + "\n" + (
        root / "PIPELINE_DOCUMENTATION.md"
    ).read_text()

    assert "cd legacylift/server" in docs
    assert "python -m pytest tests -q" in docs
    assert "cd legacylift/client" in docs
    assert "npm run type-check" in docs
    assert "cd legacylift/extension" in docs
    assert "DATABASE_URL" in docs
    assert "sqlite+aiosqlite:///./.data/legacylift.db" in docs
    assert "GITHUB_WEBHOOK_SECRET" in docs
    assert "OVERLAY_ALLOWED_REPOS_BY_USER" in docs
    assert "Load unpacked" in docs


@pytest.mark.asyncio
async def test_bdd_unauthorized_overlay_read_returns_no_private_annotations(
    plan07_client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setenv("OVERLAY_DEV_AUTH_TOKEN", "plan07-secret")
    monkeypatch.setenv("OVERLAY_REQUIRE_AUTH", "true")

    response = await plan07_client.get(
        "/github/overlay",
        params={
            "owner": "acme",
            "repo": "checkout",
            "path": "src/checkout/risk.cbl",
            "ref": "abc123",
            "start": 10,
            "end": 18,
        },
    )

    assert response.status_code == 401
    assert "annotations" not in response.text
    assert "Orders over $500" not in response.text
    assert "monetary threshold" not in response.text


@pytest.mark.asyncio
async def test_repo_permission_map_blocks_overlay_reads_without_leaking_snippets(
    plan07_client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setenv("OVERLAY_DEV_AUTH_TOKEN", "plan07-secret")
    monkeypatch.setenv("OVERLAY_ALLOWED_REPOS_BY_USER", json.dumps({"reviewer@example.com": ["other/repo"]}))

    response = await plan07_client.get(
        "/github/overlay",
        params={
            "owner": "acme",
            "repo": "checkout",
            "path": "src/checkout/risk.cbl",
            "ref": "abc123",
            "start": 10,
            "end": 18,
        },
        headers=_auth_headers(),
    )

    assert response.status_code == 403
    assert "Orders over $500" not in response.text
    assert "monetary threshold" not in response.text


@pytest.mark.asyncio
async def test_repo_permission_map_blocks_overlay_mutations_for_other_repos(
    plan07_client: AsyncClient,
    plan07_store,
    monkeypatch: pytest.MonkeyPatch,
):
    _, annotation_id = plan07_store
    monkeypatch.setenv("OVERLAY_DEV_AUTH_TOKEN", "plan07-secret")
    monkeypatch.setenv("OVERLAY_ALLOWED_REPOS_BY_USER", json.dumps({"reviewer@example.com": ["other/repo"]}))

    response = await plan07_client.patch(
        f"/github/overlay/annotation/{annotation_id}",
        json={"action": "confirm_owner"},
        headers=_auth_headers(),
    )

    assert response.status_code == 403
    assert "review state" not in response.text


@pytest.mark.asyncio
async def test_overlay_read_rate_limit_is_enforced_per_reviewer(
    plan07_client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setenv("OVERLAY_DEV_AUTH_TOKEN", "plan07-secret")
    monkeypatch.setenv("OVERLAY_RATE_LIMIT_PER_MINUTE", "1")
    if hasattr(github_overlay, "reset_overlay_rate_limiter"):
        github_overlay.reset_overlay_rate_limiter()

    params = {
        "owner": "acme",
        "repo": "checkout",
        "path": "src/checkout/risk.cbl",
        "ref": "abc123",
        "start": 10,
        "end": 18,
    }

    first = await plan07_client.get("/github/overlay", params=params, headers=_auth_headers())
    second = await plan07_client.get("/github/overlay", params=params, headers=_auth_headers())

    assert first.status_code == 200
    assert second.status_code == 429


@pytest.mark.asyncio
async def test_overlay_returns_repo_and_pr_failure_states(
    plan07_client: AsyncClient,
    plan07_store,
    monkeypatch: pytest.MonkeyPatch,
):
    async_session, _ = plan07_store
    monkeypatch.setenv("OVERLAY_DEV_AUTH_TOKEN", "plan07-secret")

    repo_not_indexed = await plan07_client.get(
        "/github/overlay",
        params={
            "owner": "acme",
            "repo": "missing",
            "path": "src/checkout/risk.cbl",
            "ref": "main",
        },
        headers=_auth_headers(),
    )
    pr_not_synced = await plan07_client.get(
        "/github/overlay",
        params={
            "owner": "acme",
            "repo": "checkout",
            "path": "src/checkout/risk.cbl",
            "pull_number": 42,
        },
        headers=_auth_headers("other@example.com"),
    )
    unsupported = await plan07_client.get(
        "/github/overlay",
        params={
            "owner": "acme",
            "repo": "checkout",
            "path": "assets/logo.png",
            "ref": "main",
        },
        headers=_auth_headers("third@example.com"),
    )

    async with async_session() as session:
        repository = (
            await session.execute(
                select(Repository).where(
                    Repository.github_owner == "acme",
                    Repository.github_name == "checkout",
                )
            )
        ).scalar_one()
        await upsert_commit(session, repository_id=repository.id, sha="empty123", ref="empty")
        await upsert_code_chunk(
            session,
            repository_id=repository.id,
            commit_sha="empty123",
            path="src/checkout/no-rules.cbl",
            name="NO-RULES",
            language="cobol",
            start_line=1,
            end_line=4,
            source="DISPLAY 'NO BUSINESS RULES'.",
        )
        await session.commit()

    empty = await plan07_client.get(
        "/github/overlay",
        params={
            "owner": "acme",
            "repo": "checkout",
            "path": "src/checkout/no-rules.cbl",
            "ref": "empty",
        },
        headers=_auth_headers("fourth@example.com"),
    )

    assert repo_not_indexed.json()["state"] == "repo_not_indexed"
    assert repo_not_indexed.json()["annotations"] == []
    assert pr_not_synced.json()["state"] == "pr_not_synced"
    assert unsupported.json()["state"] == "unsupported_file_type"
    assert empty.json()["state"] == "empty"


@pytest.mark.asyncio
async def test_health_check_reports_database_connectivity(plan07_client: AsyncClient):
    response = await plan07_client.get("/health")

    assert response.status_code == 200
    assert response.json()["database"]["status"] == "ok"


@pytest.mark.asyncio
async def test_webhook_route_rejects_bad_signature_without_recording_delivery(
    plan07_client: AsyncClient,
    plan07_store,
    monkeypatch: pytest.MonkeyPatch,
):
    async_session, _ = plan07_store
    monkeypatch.setenv("GITHUB_WEBHOOK_SECRET", "webhook-secret")
    body = json.dumps(_installation_payload()).encode("utf-8")

    response = await plan07_client.post(
        "/github/webhook",
        content=body,
        headers={
            "X-GitHub-Event": "installation",
            "X-GitHub-Delivery": "delivery-bad-signature",
            "X-Hub-Signature-256": _signed_header("wrong-secret", body),
            "Content-Type": "application/json",
        },
    )

    async with async_session() as session:
        deliveries = (await session.execute(select(GitHubWebhookDelivery))).scalars().all()

    assert response.status_code == 401
    assert deliveries == []


@pytest.mark.asyncio
async def test_webhook_route_rejects_replayed_delivery_id_and_logs_outcome(
    plan07_client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
):
    monkeypatch.setenv("GITHUB_WEBHOOK_SECRET", "webhook-secret")
    body = json.dumps(_installation_payload()).encode("utf-8")
    headers = {
        "X-GitHub-Event": "installation",
        "X-GitHub-Delivery": "delivery-replay",
        "X-Hub-Signature-256": _signed_header("webhook-secret", body),
        "Content-Type": "application/json",
    }

    first = await plan07_client.post("/github/webhook", content=body, headers=headers)
    second = await plan07_client.post("/github/webhook", content=body, headers=headers)

    assert first.status_code == 202
    assert second.status_code == 409
    assert second.json()["detail"] == "Duplicate GitHub webhook delivery"
    assert "delivery-replay" in caplog.text
    assert "installation" in caplog.text
    assert "duplicate" in caplog.text
