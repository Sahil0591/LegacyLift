from __future__ import annotations

from contextlib import asynccontextmanager
from dataclasses import dataclass
import os
from pathlib import Path
from typing import AsyncIterator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

os.environ.setdefault("DEMO_MODE", "true")
os.environ.setdefault("AUTO_APPROVE", "true")

from api.main import app
import api.github_overlay as github_overlay
from db.models import OwnershipReview
from db.repositories import (
    upsert_change_guidance,
    upsert_code_chunk,
    upsert_commit,
    upsert_decision_criterion,
    upsert_ownership_classification,
    upsert_ownership_review,
    upsert_pull_request,
    upsert_pull_request_changed_file,
    upsert_pull_request_hunk,
    upsert_pull_request_hunk_match,
    upsert_repository,
)
from db.session import create_engine, init_db, session_factory


@dataclass(frozen=True)
class OverlaySeed:
    annotation_id: str
    criterion_id: str
    chunk_id: str


@pytest_asyncio.fixture
async def overlay_store(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    db_file = tmp_path / "legacylift-overlay.db"
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

    async with async_session() as session:
        repository = await upsert_repository(
            session,
            github_owner="acme",
            github_name="checkout",
            default_branch="main",
        )
        await upsert_commit(session, repository_id=repository.id, sha="abc123", ref="refs/heads/main")
        chunk = await upsert_code_chunk(
            session,
            repository_id=repository.id,
            commit_sha="abc123",
            path="src/checkout/checkout-risk.cbl",
            name="CHECKOUT-RISK",
            language="cobol",
            start_line=249,
            end_line=256,
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
            owner_name="Finance / Pricing",
            confidence=0.91,
            evidence="Matched monetary threshold and manual-review gate.",
            matched_signals=["amount", "threshold", "manual-review"],
            inferred_by="classifier",
        )
        await upsert_ownership_review(
            session,
            decision_criterion_id=criterion.id,
            original_owner_name="Finance / Pricing",
            current_owner_name="Finance / Pricing",
            review_state="pending",
            approval_state="pending",
        )
        await upsert_change_guidance(
            session,
            decision_criterion_id=criterion.id,
            risk_summary="Changing this threshold may affect review volume, fraud exposure, and approval workload.",
            primary_approval_group="Finance / Pricing",
            secondary_groups=["Risk", "Ops"],
            approval_checklist=[
                "Confirm threshold with Finance / Pricing",
                "Ask Risk to review exposure impact",
                "Ask Ops to review manual-review volume",
                "Link approving Linear ticket before merge",
            ],
            suggested_tests=[
                "$499.99 does not trigger review",
                "$500.00 triggers review",
                "$500.01 triggers review",
            ],
            suggested_message=(
                "I am proposing to change the manual-review threshold in "
                "checkout-risk.cbl:249-256. LegacyLift identifies this as "
                "Finance / Pricing-owned. Can you confirm the intended threshold?"
            ),
            merge_risk="High",
        )
        pull_request = await upsert_pull_request(
            session,
            repository_id=repository.id,
            number=12,
            base_sha="abc123",
            head_sha="def456",
            state="open",
        )
        changed_file = await upsert_pull_request_changed_file(
            session,
            pull_request_id=pull_request.id,
            path="src/checkout/checkout-risk.cbl",
            status="modified",
            patch=(
                "@@ -249,8 +249,8 @@ CHECKOUT-RISK.\n"
                "-IF PURCHASE-AMOUNT > 450.00\n"
                "+IF PURCHASE-AMOUNT > 500.00\n"
            ),
        )
        hunk = await upsert_pull_request_hunk(
            session,
            changed_file_id=changed_file.id,
            path="src/checkout/checkout-risk.cbl",
            hunk_index=0,
            header="@@ -249,8 +249,8 @@ CHECKOUT-RISK.",
            old_start_line=249,
            old_end_line=256,
            new_start_line=249,
            new_end_line=256,
            patch=changed_file.patch,
        )
        await upsert_pull_request_hunk_match(
            session,
            hunk_id=hunk.id,
            code_chunk_id=chunk.id,
            overlap_start_line=249,
            overlap_end_line=256,
        )
        await session.commit()
        seed = OverlaySeed(
            annotation_id=f"ann_{criterion.id}",
            criterion_id=criterion.id,
            chunk_id=chunk.id,
        )

    yield async_session, seed
    await engine.dispose()


@pytest_asyncio.fixture
async def overlay_client(overlay_store):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        yield client


@pytest.mark.asyncio
async def test_bdd_matching_visible_lines_returns_normalized_annotation(overlay_client):
    response = await overlay_client.get(
        "/github/overlay",
        params={
            "owner": "acme",
            "repo": "checkout",
            "path": "src/checkout/checkout-risk.cbl",
            "ref": "abc123",
            "visible_lines": "249-256",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["repository"] == {"owner": "acme", "repo": "checkout"}
    assert payload["ref"] == "abc123"
    assert payload["path"] == "src/checkout/checkout-risk.cbl"
    assert len(payload["annotations"]) == 1

    annotation = payload["annotations"][0]
    assert annotation["line_range"] == [249, 256]
    assert annotation["criterion"] == "Orders over $500 require manual review."
    assert annotation["owner"] == "Finance / Pricing"
    assert annotation["confidence"] == "High"
    assert annotation["evidence"] == "Matched monetary threshold and manual-review gate."
    assert annotation["review_status"] == "Inferred"
    assert annotation["approval_status"] == "Approval needed"
    assert annotation["change_guidance"]["primary_approval_group"] == "Finance / Pricing"
    assert annotation["change_guidance"]["secondary_groups"] == ["Risk", "Ops"]
    assert annotation["actions"]["can_reassign"] is True


@pytest.mark.asyncio
async def test_bdd_no_matching_annotations_returns_empty_response_shape(overlay_client):
    response = await overlay_client.get(
        "/github/overlay",
        params={
            "owner": "acme",
            "repo": "checkout",
            "path": "src/checkout/checkout-risk.cbl",
            "ref": "abc123",
            "start": 300,
            "end": 310,
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "repository": {"owner": "acme", "repo": "checkout"},
        "ref": "abc123",
        "path": "src/checkout/checkout-risk.cbl",
        "annotations": [],
    }


@pytest.mark.asyncio
async def test_ref_lookup_accepts_stored_branch_ref_and_exact_file_path(overlay_client):
    matching = await overlay_client.get(
        "/github/overlay",
        params={
            "owner": "acme",
            "repo": "checkout",
            "path": "src/checkout/checkout-risk.cbl",
            "ref": "refs/heads/main",
            "start": 249,
            "end": 256,
        },
    )
    branch_shorthand = await overlay_client.get(
        "/github/overlay",
        params={
            "owner": "acme",
            "repo": "checkout",
            "path": "src/checkout/checkout-risk.cbl",
            "ref": "main",
            "start": 249,
            "end": 256,
        },
    )
    wrong_path = await overlay_client.get(
        "/github/overlay",
        params={
            "owner": "acme",
            "repo": "checkout",
            "path": "src/checkout/other.cbl",
            "ref": "refs/heads/main",
            "start": 249,
            "end": 256,
        },
    )
    shorthand_ref = await overlay_client.get(
        "/github/overlay",
        params={
            "owner": "acme",
            "repo": "checkout",
            "path": "src/checkout/checkout-risk.cbl",
            "ref": "main",
            "start": 249,
            "end": 256,
        },
    )

    assert matching.status_code == 200
    assert len(matching.json()["annotations"]) == 1
    assert branch_shorthand.status_code == 200
    assert len(branch_shorthand.json()["annotations"]) == 1
    assert wrong_path.status_code == 200
    assert wrong_path.json()["annotations"] == []
    assert shorthand_ref.status_code == 200
    assert len(shorthand_ref.json()["annotations"]) == 1


@pytest.mark.asyncio
async def test_pull_request_lookup_uses_changed_hunk_matches(overlay_client):
    response = await overlay_client.get(
        "/github/overlay",
        params={
            "owner": "acme",
            "repo": "checkout",
            "path": "src/checkout/checkout-risk.cbl",
            "pull_number": 12,
            "start": 249,
            "end": 256,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ref"] == "def456"
    assert payload["pull_request"] == {"number": 12, "state": "open"}
    assert payload["annotations"][0]["chunk_id"]


@pytest.mark.parametrize(
    ("action", "body", "review_status", "approval_status"),
    [
        ("confirm_owner", {}, "Confirmed", "Approval needed"),
        ("flag", {"reason": "Needs domain review"}, "Flagged", "Approval needed"),
        ("request_approval", {}, "Inferred", "Approval requested"),
        ("mark_approved", {}, "Inferred", "Approved"),
        ("waive_approval", {"reason": "Approved in CAB-42"}, "Inferred", "Approval waived"),
    ],
)
@pytest.mark.asyncio
async def test_annotation_mutations_persist_review_and_approval_state(
    overlay_client,
    overlay_store,
    action: str,
    body: dict,
    review_status: str,
    approval_status: str,
):
    _, seed = overlay_store

    response = await overlay_client.patch(
        f"/github/overlay/annotation/{seed.annotation_id}",
        json={"action": action} | body,
        headers={"X-LegacyLift-User": "reviewer@example.com"},
    )

    assert response.status_code == 200
    annotation = response.json()["annotation"]
    assert annotation["review_status"] == review_status
    assert annotation["approval_status"] == approval_status
    assert annotation["original_owner"] == "Finance / Pricing"


@pytest.mark.asyncio
async def test_bdd_reassign_owner_changes_future_overlay_and_preserves_original_inference(
    overlay_client,
    overlay_store,
):
    async_session, seed = overlay_store

    mutation = await overlay_client.patch(
        f"/github/overlay/annotation/{seed.annotation_id}",
        json={"action": "reassign_owner", "owner": "Risk", "reason": "Risk owns fraud exposure."},
        headers={"X-LegacyLift-User": "reviewer@example.com"},
    )
    future = await overlay_client.get(
        "/github/overlay",
        params={
            "owner": "acme",
            "repo": "checkout",
            "path": "src/checkout/checkout-risk.cbl",
            "ref": "abc123",
            "start": 249,
            "end": 256,
        },
    )

    async with async_session() as session:
        reviews = (
            await session.execute(
                select(OwnershipReview).where(OwnershipReview.decision_criterion_id == seed.criterion_id)
            )
        ).scalars().all()

    assert mutation.status_code == 200
    assert mutation.json()["annotation"]["owner"] == "Risk"
    assert mutation.json()["annotation"]["original_owner"] == "Finance / Pricing"
    assert future.json()["annotations"][0]["owner"] == "Risk"
    assert any(review.original_owner_name == "Finance / Pricing" for review in reviews)
    assert any(review.current_owner_name == "Risk" for review in reviews)
    assert len(reviews) >= 2


@pytest.mark.asyncio
async def test_waive_approval_requires_reason(overlay_client, overlay_store):
    _, seed = overlay_store

    response = await overlay_client.patch(
        f"/github/overlay/annotation/{seed.annotation_id}",
        json={"action": "waive_approval"},
        headers={"X-LegacyLift-User": "reviewer@example.com"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "waive_approval requires a reason"


@pytest.mark.asyncio
async def test_mutation_rejects_missing_dev_auth_identity(overlay_client, overlay_store):
    _, seed = overlay_store

    response = await overlay_client.patch(
        f"/github/overlay/annotation/{seed.annotation_id}",
        json={"action": "confirm_owner"},
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Missing LegacyLift reviewer identity"


@pytest.mark.asyncio
async def test_mutation_rejects_invalid_dev_auth_token(
    overlay_client,
    overlay_store,
    monkeypatch: pytest.MonkeyPatch,
):
    _, seed = overlay_store
    monkeypatch.setenv("OVERLAY_DEV_AUTH_TOKEN", "dev-secret")

    response = await overlay_client.patch(
        f"/github/overlay/annotation/{seed.annotation_id}",
        json={"action": "confirm_owner"},
        headers={
            "X-LegacyLift-User": "reviewer@example.com",
            "Authorization": "Bearer wrong-secret",
        },
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid LegacyLift overlay token"
