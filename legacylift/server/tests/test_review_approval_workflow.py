from __future__ import annotations

import os

import pytest
from httpx import ASGITransport, AsyncClient

os.environ.setdefault("DEMO_MODE", "true")
os.environ.setdefault("AUTO_APPROVE", "true")

import api.main as main
from api.main import app
from models.project import Project, ProjectStatus


@pytest.fixture(autouse=True)
def clear_projects():
    main.projects.clear()
    yield
    main.projects.clear()


@pytest.fixture
def project() -> Project:
    project = Project(name="Review workflow", status=ProjectStatus.READY)
    project.layer0_chunks = [
        {"id": "chunk-finance", "name": "Finance rule"},
        {"id": "chunk-unknown", "name": "Unknown rule"},
    ]
    project.layer0_rules = [
        {
            "id": "rule-finance",
            "chunk_id": "chunk-finance",
            "title": "Finance threshold",
            "ownership_category": "Finance",
            "owner": "Finance",
        },
        {
            "id": "rule-unknown",
            "chunk_id": "chunk-unknown",
            "title": "Needs triage",
            "ownership_category": "Unknown",
            "owner": "Unknown",
        },
    ]
    main.projects[project.id] = project
    return project


@pytest.mark.asyncio
async def test_workbench_confirm_owner_stores_review_audit_and_allows_migration(
    project: Project,
    monkeypatch: pytest.MonkeyPatch,
):
    async def fake_run_migration_generation(_project: Project, _chunk_id: str) -> None:
        return None

    monkeypatch.setattr(main, "run_migration_generation", fake_run_migration_generation)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        confirmed = await client.post(
            f"/project/{project.id}/confirm-rule/chunk-finance",
            json={
                "action": "confirm_owner",
                "reviewer_identity": "domain@example.com",
                "reason": "Finance confirmed the rule.",
            },
        )
        selected = await client.post(f"/project/{project.id}/select-chunk/chunk-finance")

    assert confirmed.status_code == 200
    body = confirmed.json()
    assert body["review_state"] == "Confirmed"
    assert body["approval_state"] == "Approval needed"
    assert body["current_owner"] == "Finance"
    assert body["audit_trail"][-1]["reviewer_identity"] == "domain@example.com"
    assert body["audit_trail"][-1]["source_surface"] == "LegacyLift workbench"
    assert body["audit_trail"][-1]["reviewed_at"] is not None
    assert selected.status_code == 202


@pytest.mark.asyncio
async def test_flagged_rule_blocks_migration_until_resolved(project: Project):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        flagged = await client.post(
            f"/project/{project.id}/confirm-rule/chunk-finance",
            json={
                "action": "flag",
                "reviewer_identity": "domain@example.com",
                "reason": "Policy text conflicts with source.",
            },
        )
        selected = await client.post(f"/project/{project.id}/select-chunk/chunk-finance")

    assert flagged.status_code == 200
    assert flagged.json()["review_state"] == "Flagged"
    assert selected.status_code == 400
    assert selected.json()["detail"] == "Business rule is flagged and must be resolved before migration can begin"


@pytest.mark.asyncio
async def test_confirmed_unknown_owner_requires_explicit_override(
    project: Project,
    monkeypatch: pytest.MonkeyPatch,
):
    async def fake_run_migration_generation(_project: Project, _chunk_id: str) -> None:
        return None

    monkeypatch.setattr(main, "run_migration_generation", fake_run_migration_generation)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        implicit = await client.post(
            f"/project/{project.id}/confirm-rule/chunk-unknown",
            json={"action": "confirm_owner", "reviewer_identity": "domain@example.com"},
        )
        explicit = await client.post(
            f"/project/{project.id}/confirm-rule/chunk-unknown",
            json={
                "action": "confirm_owner",
                "reviewer_identity": "domain@example.com",
                "allow_unknown_owner": True,
                "reason": "No owning group exists; workbench owner accepted accountability.",
            },
        )
        selected = await client.post(f"/project/{project.id}/select-chunk/chunk-unknown")

    assert implicit.status_code == 400
    assert implicit.json()["detail"] == "Unknown owner requires explicit confirmation before migration"
    assert explicit.status_code == 200
    assert explicit.json()["review_state"] == "Confirmed"
    assert selected.status_code == 202
