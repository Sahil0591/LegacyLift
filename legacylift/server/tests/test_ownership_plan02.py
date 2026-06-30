from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest
import pytest_asyncio

from db.models import ChangeGuidance, OwnershipClassification
from db.repositories import persist_layer0_analysis
from db.session import create_engine, init_db, session_factory
from models.business_rule import BusinessRule, OwnershipConfidence, RuleConfidence
from ownership.classifier import classify_rule_ownership
from ownership.guidance import generate_change_guidance


@pytest_asyncio.fixture
async def db_session(tmp_path: Path):
    db_file = tmp_path / "legacylift-plan02.db"
    engine = create_engine(f"sqlite+aiosqlite:///{db_file}")
    await init_db(engine)
    async_session = session_factory(engine)

    async with async_session() as session:
        yield session
        await session.rollback()

    await engine.dispose()


def business_rule(
    *,
    title: str,
    description: str,
    hardcoded_values: list[str] | None = None,
    source_file: str = "checkout-risk.cbl",
    source_lines: tuple[int, int] = (249, 256),
) -> BusinessRule:
    return BusinessRule(
        id="BR-PLAN02",
        title=title,
        description=description,
        source_file=source_file,
        source_lines=source_lines,
        confidence=RuleConfidence.HIGH,
        hardcoded_values=hardcoded_values or [],
    )


@pytest.mark.asyncio
async def test_bdd_finance_rule_matches_high_confidence_signals():
    rule = business_rule(
        title="Tier interest threshold",
        description=(
            "Accounts with balance above the monetary threshold use the higher "
            "interest rate."
        ),
        hardcoded_values=["500.00"],
    )

    result = await classify_rule_ownership(rule)

    assert result.primary_owner == "Finance"
    assert result.confidence == OwnershipConfidence.HIGH
    assert {"interest", "rate", "balance", "threshold"} <= set(result.matched_signals)
    assert "Matched" in result.evidence
    assert "Finance" in result.evidence


@pytest.mark.asyncio
async def test_bdd_compliance_rule_uses_configured_aliases():
    rule = business_rule(
        title="Identity gate",
        description="KYC and AML checks must complete before account activation.",
    )

    result = await classify_rule_ownership(rule)

    assert result.primary_owner in {"Compliance", "Risk"}
    assert result.confidence in {OwnershipConfidence.HIGH, OwnershipConfidence.MEDIUM}
    assert {"kyc", "aml"} <= set(result.matched_signals)


@pytest.mark.asyncio
async def test_bdd_weak_evidence_falls_back_to_unknown_low_confidence():
    rule = business_rule(
        title="Copy helper",
        description="Moves input fields to temporary working storage.",
        hardcoded_values=[],
    )

    result = await classify_rule_ownership(rule)

    assert result.primary_owner == "Unknown"
    assert result.confidence == OwnershipConfidence.LOW
    assert result.matched_signals == []


@pytest.mark.asyncio
async def test_bdd_custom_group_alias_takes_precedence_over_default_groups():
    rule = business_rule(
        title="Fraud moderation threshold",
        description="Transactions with fraud and abuse indicators are held for review.",
    )
    groups = [
        {
            "name": "Trust & Safety",
            "description": "Abuse, fraud, and marketplace trust controls.",
            "aliases": ["fraud", "abuse"],
            "color": "#d946ef",
            "is_default": False,
        }
    ]

    result = await classify_rule_ownership(rule, groups=groups)

    assert result.primary_owner == "Trust & Safety"
    assert result.confidence == OwnershipConfidence.HIGH
    assert {"fraud", "abuse"} <= set(result.matched_signals)
    assert result.review_status == "Inferred"


@pytest.mark.asyncio
async def test_malformed_llm_fallback_stays_unknown(monkeypatch: pytest.MonkeyPatch):
    async def malformed_complete(*args, **kwargs):
        return "not-json and no known owner"

    monkeypatch.setenv("DEMO_MODE", "false")
    monkeypatch.setattr("ownership.classifier.LLMClient.complete", malformed_complete)
    rule = business_rule(
        title="Opaque helper",
        description="Applies bespoke branch logic.",
    )

    result = await classify_rule_ownership(rule, use_llm_fallback=True)

    assert result.primary_owner == "Unknown"
    assert result.confidence == OwnershipConfidence.LOW
    assert "human confirmation" in result.evidence.lower()


def test_threshold_change_guidance_suggests_boundary_tests_and_finance_approval():
    rule = business_rule(
        title="Manual-review monetary threshold",
        description=(
            "Changing this monetary threshold affects manual-review volume, "
            "fraud exposure, and approval workload."
        ),
        hardcoded_values=["500.00"],
    )
    ownership = SimpleNamespace(
        primary_owner="Finance / Pricing",
        secondary_owners=["Risk", "Ops"],
        confidence="High",
        matched_signals=["threshold", "amount"],
    )

    guidance = generate_change_guidance(
        rule=rule,
        ownership=ownership,
        change_text="- IF AMOUNT > 450\n+ IF AMOUNT > 500",
    )

    assert guidance.primary_approval_group == "Finance / Pricing"
    assert guidance.secondary_groups == ["Risk", "Ops"]
    assert "$499.99 does not trigger review" in guidance.suggested_tests
    assert "$500.00 triggers review" in guidance.suggested_tests
    assert "$500.01 triggers review" in guidance.suggested_tests
    assert "Finance / Pricing-owned" in guidance.suggested_message
    assert guidance.merge_risk == "High"


def test_unknown_owner_guidance_requires_owner_confirmation():
    rule = business_rule(
        title="Unclear decision branch",
        description="A branch changes customer handling without clear business signals.",
    )
    ownership = SimpleNamespace(
        primary_owner="Unknown",
        secondary_owners=[],
        confidence="Low",
        matched_signals=[],
    )

    guidance = generate_change_guidance(rule=rule, ownership=ownership)

    assert guidance.primary_approval_group == "Unknown"
    assert any("Confirm owning group" in item for item in guidance.approval_checklist)
    assert guidance.merge_risk == "High"


@pytest.mark.asyncio
async def test_persistence_uses_classifier_and_stores_change_guidance(db_session):
    project = SimpleNamespace(id="proj-plan02", name="Plan 02 Upload")
    chunk = SimpleNamespace(
        id="checkout__risk_check",
        filename="checkout-risk.cbl",
        name="RISK-CHECK",
        language="cobol",
        source="IF PURCHASE-AMOUNT > 500.00 MOVE 'Y' TO MANUAL-REVIEW.",
        start_line=249,
        end_line=256,
    )
    rule = SimpleNamespace(
        id="rule-checkout__risk_check",
        chunk_id="checkout__risk_check",
        rule=(
            "Purchases above the monetary threshold trigger manual review and "
            "increase fraud exposure."
        ),
        confidence=0.92,
        owner="Unknown",
        owner_reasoning="Layer 0 did not assign a durable owner.",
        key_variables=["500.00"],
        needs_review=False,
    )

    summary = await persist_layer0_analysis(db_session, project, [chunk], [rule])
    await db_session.commit()

    classifications = (await db_session.execute(OwnershipClassification.__table__.select())).all()
    guidance_rows = (await db_session.execute(ChangeGuidance.__table__.select())).all()

    assert summary.classification_count == 1
    assert summary.guidance_count == 1
    assert classifications[0].owner_name in {"Finance", "Risk"}
    assert "threshold" in json.loads(classifications[0].matched_signals_json)
    assert len(guidance_rows) == 1
    assert guidance_rows[0].merge_risk == "High"
    assert "approv" in guidance_rows[0].suggested_message.lower()
