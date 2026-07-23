"""
tests/test_llm_routes.py — Integration tests for the backend LLM proxy endpoints.

Covers POST /llm/migrate, /llm/review, and /llm/tests.

Design rules:
- No real Venice call is made. LLMClient is patched to return canned text.
- Storage lifespan events are NOT triggered (TestClient used without context
  manager) — the LLM routes have no dependency on loaded storage.
- Auth dependency is overridden via app.dependency_overrides in the auth fixture.
- Rate-limit state and per-user storage limits are cleared between test cases.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

# ── Environment must be set BEFORE importing the app ─────────────────────────
os.environ["DEMO_MODE"] = "true"
os.environ.setdefault(
    "CLERK_JWKS_URL",
    "https://placeholder.clerk.accounts.dev/.well-known/jwks.json",
)

sys.path.insert(0, str(Path(__file__).parent.parent))

import api.main as _main
from api.auth import get_current_user_id
from api.main import app, _rl_hits
from core.storage import storage

TEST_USER_ID = "user_test_llm_123"


# ── Helpers ───────────────────────────────────────────────────────────────────

MIGRATE_BODY = {
    "name": "INTEREST-CALC",
    "source_code": "COMPUTE WS-INT = WS-BAL * 0.025.",
    "source_lang": "COBOL",
    "target_lang": "Python",
    "business_rules": [
        {
            "title": "Daily interest",
            "description": "2.5 % annual rate",
            "hardcoded_values": ["0.025"],
        }
    ],
    "target_profile": {
        "language": "Python",
        "version": "3.12",
        "test_framework": "pytest",
        "notes": "use Decimal",
    },
    "instructions": None,
}

REVIEW_BODY = {
    "name": "INTEREST-CALC",
    "source_code": "COMPUTE WS-INT = WS-BAL * 0.025.",
    "migrated_code": "interest = balance * Decimal('0.025')",
    "source_lang": "COBOL",
    "target_lang": "Python",
}

TESTS_BODY = {
    "name": "INTEREST-CALC",
    "migrated_code": "def calc(b): return b * Decimal('0.025')",
    "target_lang": "Python",
}

SUMMARIZE_BODY = {
    "filename": "interest.cbl",
    "source_code": "       INTEREST-CALC SECTION.\n           COMPUTE WS-INT = WS-BAL * 0.025.",
    "source_lang": "COBOL",
    "business_rules": [
        {"title": "Daily interest", "description": "2.5% annual rate", "hardcoded_values": ["0.025"]}
    ],
    "institutional_context": "Money fields are GBP pence.",
}

SUMMARY_JSON = (
    '{"technical": "Computes daily interest on the balance.",'
    ' "layman": "Works out how much interest a customer owes each day."}'
)

FINALIZE_BODY = {
    "filename": "interest.cbl",
    "assembled_code": (
        "from decimal import Decimal\n\n"
        "def calc_interest(bal):\n    return bal * Decimal('0.025')\n\n\n"
        "def calcInterest(bal):\n    return bal * Decimal('0.025')\n"
    ),
    "source_code": "COMPUTE WS-INT = WS-BAL * 0.025.",
    "target_lang": "Python",
    "business_rules": [
        {"title": "Daily interest", "description": "2.5% annual rate", "hardcoded_values": ["0.025"]}
    ],
    "project_manifest": "- ledger.cbl\n    depends: interest -> ledger (CALL)",
    "institutional_context": "Money fields are GBP pence.",
    "target_profile": {"language": "Python", "version": "3.12"},
}

FINALIZED_CODE = (
    "from decimal import Decimal\n\n"
    "def calc_interest(bal):\n    return bal * Decimal('0.025')"
)

VALIDATE_BODY = {"code": "def f(x):\n    return x + 1\n", "target_lang": "Python"}
INVALID_PY_BODY = {"code": "def f(x)\n    return x + 1\n", "target_lang": "Python"}

MIGRATED_CODE = "interest = balance * Decimal('0.025')"
REVIEW_JSON = (
    '{"equivalent": true, "confidence": "High", "issues_found": 0,'
    ' "critical_issues": [], "warnings": [], "suggestions": []}'
)
TESTS_JSON = (
    '{"tests": [{"name": "test_basic", "purpose": "happy path"}],'
    ' "code": "def test_basic(): assert True"}'
)


def _make_llm(complete_returns: str = MIGRATED_CODE) -> MagicMock:
    """Return a mock LLMClient that is configured and returns canned output."""
    m = MagicMock()
    m.is_configured.return_value = True
    m.model = "test-model"
    m.complete = AsyncMock(return_value=complete_returns)
    return m


def _unconfigured_llm() -> MagicMock:
    m = MagicMock()
    m.is_configured.return_value = False
    m.model = "test-model"
    return m


@pytest.fixture(autouse=True)
def auth_override():
    """Override get_current_user_id so LLM routes return TEST_USER_ID without a real JWT."""
    app.dependency_overrides[get_current_user_id] = lambda: TEST_USER_ID
    yield
    app.dependency_overrides.pop(get_current_user_id, None)


@pytest.fixture(autouse=True)
def clear_rate_limit():
    """Wipe in-memory rate-limit counters and per-user quota before each test."""
    _rl_hits.clear()
    storage._limits.pop(TEST_USER_ID, None)
    yield
    _rl_hits.clear()
    storage._limits.pop(TEST_USER_ID, None)


# ── /llm/migrate ─────────────────────────────────────────────────────────────

@pytest.mark.parametrize(
    ("endpoint", "body"),
    [
        ("/llm/migrate", MIGRATE_BODY),
        ("/llm/review", REVIEW_BODY),
        ("/llm/tests", TESTS_BODY),
        ("/llm/finalize-file", FINALIZE_BODY),
        ("/validate-file", VALIDATE_BODY),
    ],
)
def test_llm_routes_reject_unsupported_targets(endpoint: str, body: dict):
    client = TestClient(app, raise_server_exceptions=True)
    r = client.post(endpoint, json={**body, "target_lang": "Brainfuck"})

    assert r.status_code == 422
    assert "Unsupported target language" in r.text


class TestLlmMigrate:

    def test_returns_migrated_code(self):
        with patch.object(_main, "_get_llm", return_value=_make_llm(MIGRATED_CODE)):
            client = TestClient(app, raise_server_exceptions=True)
            r = client.post("/llm/migrate", json=MIGRATE_BODY)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "migrated_code" in data
        assert data["migrated_code"] == MIGRATED_CODE
        assert data["model"] == "test-model"

    def test_strips_code_fence(self):
        fenced = f"```python\n{MIGRATED_CODE}\n```"
        with patch.object(_main, "_get_llm", return_value=_make_llm(fenced)):
            client = TestClient(app, raise_server_exceptions=True)
            r = client.post("/llm/migrate", json=MIGRATE_BODY)
        assert r.status_code == 200
        assert r.json()["migrated_code"] == MIGRATED_CODE

    def test_accepts_rich_profile_and_institutional_context(self):
        """New multi-language + context fields are accepted and reach the prompt."""
        body = {
            **MIGRATE_BODY,
            "target_lang": "Java",
            "target_profile": {
                "language": "Java",
                "version": "21",
                "test_framework": "JUnit 5",
                "numeric_policy": "Use BigDecimal for money.",
                "risk_focus": ["BigDecimal scale", "transaction boundaries"],
                "recommended_libraries": ["java.math.BigDecimal"],
            },
            "institutional_context": "ACME rule: post to GLEDGER via copybook.",
        }
        llm = _make_llm(MIGRATED_CODE)
        with patch.object(_main, "_get_llm", return_value=llm):
            client = TestClient(app, raise_server_exceptions=True)
            r = client.post("/llm/migrate", json=body)
        assert r.status_code == 200, r.text
        user_prompt = llm.complete.await_args.kwargs["user"]
        assert "BigDecimal" in user_prompt
        assert "ORGANIZATION CONTEXT" in user_prompt
        assert "GLEDGER" in user_prompt

    def test_cross_chunk_context_reaches_prompt(self):
        """dependencies_source + generated_api are accepted and reach the prompt,
        so the model sees its callees' legacy source AND generated target API."""
        body = {
            **MIGRATE_BODY,
            "name": "RUN-EOD",
            "dependencies_source": "--- CALC-INTEREST ---\nCALC-INTEREST. PERFORM APPLY-BONUS-RATE.",
            "generated_api": (
                "- CALC-INTEREST  ->  interest_calc.py  [approved]\n"
                "    def calculate_interest(balance, rate, days)"
            ),
        }
        llm = _make_llm(MIGRATED_CODE)
        with patch.object(_main, "_get_llm", return_value=llm):
            client = TestClient(app, raise_server_exceptions=True)
            r = client.post("/llm/migrate", json=body)
        assert r.status_code == 200, r.text
        user_prompt = llm.complete.await_args.kwargs["user"]
        assert "DIRECT DEPENDENCIES" in user_prompt
        assert "APPLY-BONUS-RATE" in user_prompt
        assert "ALREADY-MIGRATED TARGET API" in user_prompt
        assert "calculate_interest" in user_prompt

    def test_501_when_not_configured(self):
        with patch.object(_main, "_get_llm", return_value=_unconfigured_llm()):
            client = TestClient(app, raise_server_exceptions=True)
            r = client.post("/llm/migrate", json=MIGRATE_BODY)
        assert r.status_code == 501
        assert "not configured" in r.json()["detail"].lower()

    def test_400_missing_required_fields(self):
        with patch.object(_main, "_get_llm", return_value=_make_llm()):
            client = TestClient(app, raise_server_exceptions=True)
            r = client.post("/llm/migrate", json={"name": "X"})  # source_code missing
        assert r.status_code == 422  # FastAPI validation error

    def test_502_on_demo_sentinel_response(self):
        from utils.llm_client import DEMO_RESPONSE
        with patch.object(_main, "_get_llm", return_value=_make_llm(DEMO_RESPONSE)):
            client = TestClient(app, raise_server_exceptions=True)
            r = client.post("/llm/migrate", json=MIGRATE_BODY)
        assert r.status_code == 502
        assert "temporarily unavailable" in r.json()["detail"].lower()

    def test_raw_venice_error_is_not_leaked(self):
        """Internal error message must never surface raw upstream details."""
        from utils.llm_client import DEMO_RESPONSE
        with patch.object(_main, "_get_llm", return_value=_make_llm(DEMO_RESPONSE)):
            client = TestClient(app, raise_server_exceptions=True)
            r = client.post("/llm/migrate", json=MIGRATE_BODY)
        assert r.status_code in (501, 502, 429)
        body = r.text
        # None of these should appear in a sanitized response
        assert "Traceback" not in body
        assert "VENICE_API_KEY" not in body
        assert "api.venice.ai" not in body


# ── /llm/review ──────────────────────────────────────────────────────────────

class TestLlmReview:

    def test_returns_review_result(self):
        llm = _make_llm(REVIEW_JSON)
        with patch.object(_main, "_get_llm", return_value=llm):
            client = TestClient(app, raise_server_exceptions=True)
            r = client.post("/llm/review", json=REVIEW_BODY)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["equivalent"] is True
        assert data["confidence"] == "High"
        assert data["ai_confidence"] == "High"
        assert data["issues_found"] == 0
        assert data["critical_issues"] == []
        assert data["warnings"] == []
        assert data["suggestions"] == []
        assert llm.complete.await_args.kwargs["json_response"] is True

    def test_handles_unstructured_output_gracefully(self):
        with patch.object(_main, "_get_llm", return_value=_make_llm("Looks fine to me!")):
            client = TestClient(app, raise_server_exceptions=True)
            r = client.post("/llm/review", json=REVIEW_BODY)
        assert r.status_code == 200
        data = r.json()
        assert data["confidence"] == "Low"
        assert "unstructured output" in data["warnings"][0]
        assert "raw_response" in data

    def test_501_when_not_configured(self):
        with patch.object(_main, "_get_llm", return_value=_unconfigured_llm()):
            client = TestClient(app, raise_server_exceptions=True)
            r = client.post("/llm/review", json=REVIEW_BODY)
        assert r.status_code == 501

    def test_raw_response_excluded_on_success(self):
        """raw_response must be empty string on a clean parse (no debug data leaked)."""
        with patch.object(_main, "_get_llm", return_value=_make_llm(REVIEW_JSON)):
            client = TestClient(app, raise_server_exceptions=True)
            r = client.post("/llm/review", json=REVIEW_BODY)
        assert r.json()["raw_response"] == ""


# ── /llm/tests ───────────────────────────────────────────────────────────────

class TestLlmTests:

    def test_returns_tests_and_code(self):
        llm = _make_llm(TESTS_JSON)
        with patch.object(_main, "_get_llm", return_value=llm):
            client = TestClient(app, raise_server_exceptions=True)
            r = client.post("/llm/tests", json=TESTS_BODY)
        assert r.status_code == 200, r.text
        data = r.json()
        assert len(data["tests"]) == 1
        assert data["tests"][0]["name"] == "test_basic"
        assert data["code"] == "def test_basic(): assert True"
        assert llm.complete.await_args.kwargs["json_response"] is True

    def test_empty_tests_on_bad_json(self):
        with patch.object(_main, "_get_llm", return_value=_make_llm("not json at all")):
            client = TestClient(app, raise_server_exceptions=True)
            r = client.post("/llm/tests", json=TESTS_BODY)
        assert r.status_code == 200
        data = r.json()
        assert data["tests"] == []
        assert data["code"] == ""

    def test_501_when_not_configured(self):
        with patch.object(_main, "_get_llm", return_value=_unconfigured_llm()):
            client = TestClient(app, raise_server_exceptions=True)
            r = client.post("/llm/tests", json=TESTS_BODY)
        assert r.status_code == 501

    def test_caps_at_8_tests(self):
        big_tests = [{"name": f"test_{i}", "purpose": "x"} for i in range(20)]
        import json
        big_json = json.dumps({"tests": big_tests, "code": "pass"})
        with patch.object(_main, "_get_llm", return_value=_make_llm(big_json)):
            client = TestClient(app, raise_server_exceptions=True)
            r = client.post("/llm/tests", json=TESTS_BODY)
        assert r.status_code == 200
        assert len(r.json()["tests"]) == 8


# ── /llm/summarize-file ──────────────────────────────────────────────────────

class TestLlmSummarizeFile:

    def test_returns_two_summaries(self):
        llm = _make_llm(SUMMARY_JSON)
        with patch.object(_main, "_get_llm", return_value=llm):
            client = TestClient(app, raise_server_exceptions=True)
            r = client.post("/llm/summarize-file", json=SUMMARIZE_BODY)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "interest" in data["technical"].lower()
        assert "customer" in data["layman"].lower()
        assert data["model"] == "test-model"
        assert llm.complete.await_args.kwargs["json_response"] is True

    def test_prompt_includes_rules_and_context(self):
        """The whole-file summary prompt carries the file's rules + org context."""
        llm = _make_llm(SUMMARY_JSON)
        with patch.object(_main, "_get_llm", return_value=llm):
            client = TestClient(app, raise_server_exceptions=True)
            r = client.post("/llm/summarize-file", json=SUMMARIZE_BODY)
        assert r.status_code == 200
        user_prompt = llm.complete.await_args.kwargs["user"]
        assert "interest.cbl" in user_prompt
        assert "Daily interest" in user_prompt
        assert "ORGANIZATION CONTEXT" in user_prompt
        assert "GBP pence" in user_prompt

    def test_501_when_not_configured(self):
        with patch.object(_main, "_get_llm", return_value=_unconfigured_llm()):
            client = TestClient(app, raise_server_exceptions=True)
            r = client.post("/llm/summarize-file", json=SUMMARIZE_BODY)
        assert r.status_code == 501


# ── /llm/finalize-file ───────────────────────────────────────────────────────

class TestLlmFinalizeFile:

    def test_returns_reconciled_code(self):
        with patch.object(_main, "_get_llm", return_value=_make_llm(FINALIZED_CODE)):
            client = TestClient(app, raise_server_exceptions=True)
            r = client.post("/llm/finalize-file", json=FINALIZE_BODY)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["code"] == FINALIZED_CODE
        assert data["model"] == "test-model"

    def test_strips_code_fence(self):
        fenced = f"```python\n{FINALIZED_CODE}\n```"
        with patch.object(_main, "_get_llm", return_value=_make_llm(fenced)):
            client = TestClient(app, raise_server_exceptions=True)
            r = client.post("/llm/finalize-file", json=FINALIZE_BODY)
        assert r.status_code == 200, r.text
        assert r.json()["code"] == FINALIZED_CODE

    def test_prompt_carries_assembled_and_source(self):
        """The finalize prompt reconciles the assembled file and references the
        original source for equivalence."""
        llm = _make_llm(FINALIZED_CODE)
        with patch.object(_main, "_get_llm", return_value=llm):
            client = TestClient(app, raise_server_exceptions=True)
            r = client.post("/llm/finalize-file", json=FINALIZE_BODY)
        assert r.status_code == 200
        user_prompt = llm.complete.await_args.kwargs["user"]
        assert "interest.cbl" in user_prompt
        assert "ASSEMBLED" in user_prompt
        assert "calcInterest" in user_prompt  # the assembled body is present
        assert "WS-BAL" in user_prompt  # original source reference included

    def test_generated_api_reaches_finalize_prompt(self):
        """The cross-file generated API reaches the reconcile prompt so cross-file
        references finalize to real neighbour names."""
        body = {
            **FINALIZE_BODY,
            "generated_api": (
                "- VALIDATE-KYC  ->  account_master.py  [approved]\n"
                "    def validate_kyc(account_id: str) -> bool"
            ),
        }
        llm = _make_llm(FINALIZED_CODE)
        with patch.object(_main, "_get_llm", return_value=llm):
            client = TestClient(app, raise_server_exceptions=True)
            r = client.post("/llm/finalize-file", json=body)
        assert r.status_code == 200, r.text
        user_prompt = llm.complete.await_args.kwargs["user"]
        assert "ALREADY-MIGRATED TARGET API OF OTHER FILES" in user_prompt
        assert "validate_kyc" in user_prompt

    def test_prompt_carries_rules_manifest_and_org_context(self):
        """Reconcile gets the same authoritative context as the original
        migration: business rules, the cross-file manifest, and org context."""
        llm = _make_llm(FINALIZED_CODE)
        with patch.object(_main, "_get_llm", return_value=llm):
            client = TestClient(app, raise_server_exceptions=True)
            r = client.post("/llm/finalize-file", json=FINALIZE_BODY)
        assert r.status_code == 200
        user_prompt = llm.complete.await_args.kwargs["user"]
        assert "Daily interest" in user_prompt  # business rule
        assert "ledger.cbl" in user_prompt  # project manifest
        assert "PROJECT MANIFEST" in user_prompt
        assert "GBP pence" in user_prompt  # organization context
        assert "ORGANIZATION CONTEXT" in user_prompt

    def test_501_when_not_configured(self):
        with patch.object(_main, "_get_llm", return_value=_unconfigured_llm()):
            client = TestClient(app, raise_server_exceptions=True)
            r = client.post("/llm/finalize-file", json=FINALIZE_BODY)
        assert r.status_code == 501

    def test_400_missing_assembled_code(self):
        with patch.object(_main, "_get_llm", return_value=_make_llm()):
            client = TestClient(app, raise_server_exceptions=True)
            r = client.post("/llm/finalize-file", json={"filename": "x.cbl"})
        assert r.status_code == 422


# ── /validate-file ───────────────────────────────────────────────────────────

class TestValidateFile:

    def test_passes_valid_python(self):
        client = TestClient(app, raise_server_exceptions=True)
        r = client.post("/validate-file", json=VALIDATE_BODY)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["status"] == "passed"
        assert data["passed"] is True
        assert data["issues"] == []

    def test_fails_invalid_python_with_issue(self):
        client = TestClient(app, raise_server_exceptions=True)
        r = client.post("/validate-file", json=INVALID_PY_BODY)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["status"] == "failed"
        assert data["passed"] is False
        assert any("SyntaxError" in issue for issue in data["issues"])

    def test_does_not_require_llm_configured(self):
        """Validation is not an LLM call - it works even with no model configured."""
        with patch.object(_main, "_get_llm", return_value=_unconfigured_llm()):
            client = TestClient(app, raise_server_exceptions=True)
            r = client.post("/validate-file", json=VALIDATE_BODY)
        assert r.status_code == 200
        assert r.json()["status"] == "passed"


# ── Rate limiter ──────────────────────────────────────────────────────────────

class TestRateLimit:

    def test_429_after_limit_exceeded(self):
        llm = _make_llm(MIGRATED_CODE)
        with patch.object(_main, "_get_llm", return_value=llm), \
             patch.object(_main, "_RL_LIMIT", 2):
            client = TestClient(app, raise_server_exceptions=True)
            r1 = client.post("/llm/migrate", json=MIGRATE_BODY)
            r2 = client.post("/llm/migrate", json=MIGRATE_BODY)
            r3 = client.post("/llm/migrate", json=MIGRATE_BODY)
        assert r1.status_code == 200
        assert r2.status_code == 200
        assert r3.status_code == 429
        assert "Retry-After" in r3.headers

    def test_429_when_daily_quota_exhausted(self):
        """Exceeding migrations_today budget returns 429 before touching Venice."""
        lim = storage.get_limits(TEST_USER_ID)
        lim.migrations_today = lim.max_migrations_per_day  # exhaust quota
        with patch.object(_main, "_get_llm", return_value=_make_llm(MIGRATED_CODE)):
            client = TestClient(app, raise_server_exceptions=True)
            r = client.post("/llm/migrate", json=MIGRATE_BODY)
        assert r.status_code == 429
        assert "quota" in r.json()["detail"].lower()

    def test_quota_increments_on_success(self):
        """Successful /llm/migrate call increments migrations_today by 1."""
        before = storage.get_limits(TEST_USER_ID).migrations_today
        with patch.object(_main, "_get_llm", return_value=_make_llm(MIGRATED_CODE)):
            client = TestClient(app, raise_server_exceptions=True)
            client.post("/llm/migrate", json=MIGRATE_BODY)
        assert storage.get_limits(TEST_USER_ID).migrations_today == before + 1


class TestLlmAuthRequired:
    """Verify that /llm/* endpoints return 401 when no auth is present."""

    def test_migrate_requires_auth(self):
        app.dependency_overrides.pop(get_current_user_id, None)
        try:
            client = TestClient(app, raise_server_exceptions=True)
            r = client.post("/llm/migrate", json=MIGRATE_BODY)
        finally:
            app.dependency_overrides[get_current_user_id] = lambda: TEST_USER_ID
        assert r.status_code == 401

    def test_review_requires_auth(self):
        app.dependency_overrides.pop(get_current_user_id, None)
        try:
            client = TestClient(app, raise_server_exceptions=True)
            r = client.post("/llm/review", json=REVIEW_BODY)
        finally:
            app.dependency_overrides[get_current_user_id] = lambda: TEST_USER_ID
        assert r.status_code == 401

    def test_tests_requires_auth(self):
        app.dependency_overrides.pop(get_current_user_id, None)
        try:
            client = TestClient(app, raise_server_exceptions=True)
            r = client.post("/llm/tests", json=TESTS_BODY)
        finally:
            app.dependency_overrides[get_current_user_id] = lambda: TEST_USER_ID
        assert r.status_code == 401


# ── Prompt + JSON helper unit tests ──────────────────────────────────────────

class TestMigrationPrompts:
    """Fast unit tests for the prompt builders and JSON helpers (no app/HTTP)."""

    def test_build_migration_prompt_includes_name(self):
        from utils.migration_prompts import build_migration_prompt
        _, user = build_migration_prompt(
            name="LOAN-CALC",
            source_code="COMPUTE X = 1.",
            source_lang="COBOL",
            target_lang="Python",
        )
        assert "LOAN-CALC" in user

    def test_build_migration_prompt_includes_rules(self):
        from utils.migration_prompts import build_migration_prompt
        _, user = build_migration_prompt(
            name="X",
            source_code=".",
            source_lang="COBOL",
            target_lang="Python",
            business_rules=[{"title": "Cap", "description": "max 1000", "hardcoded_values": ["1000"]}],
        )
        assert "Cap — max 1000 (values: 1000)" in user

    def test_build_migration_prompt_includes_reviewer_guidance(self):
        from utils.migration_prompts import build_migration_prompt
        _, user = build_migration_prompt(
            name="X", source_code=".", source_lang="COBOL", target_lang="Python",
            instructions="use banker rounding",
        )
        assert "REVIEWER GUIDANCE" in user
        assert "use banker rounding" in user

    def test_build_review_prompt(self):
        from utils.migration_prompts import build_review_prompt
        system, user = build_review_prompt(
            name="X", source_lang="COBOL", target_lang="Python",
            source_code="COMPUTE X = 1.", migrated_code="x = 1",
        )
        assert "SEMANTIC EQUIVALENCE" in system
        assert "COBOL" in user and "Python" in user

    def test_build_test_prompt(self):
        from utils.migration_prompts import build_test_prompt
        system, user = build_test_prompt(
            name="LOAN-CALC", migrated_code="def f(): pass", target_lang="Python"
        )
        assert "pytest" in system
        assert "LOAN-CALC" in user

    # ── Multi-language: prompts must reflect the chosen target, not Python ──

    JAVA_PROFILE = {
        "language": "Java",
        "version": "21",
        "test_framework": "JUnit 5",
        "numeric_policy": "Use BigDecimal for money; never double.",
        "type_system": "records and sealed types",
        "notes": "Preserve double-entry invariants.",
    }

    def test_migration_prompt_is_language_specific_for_java(self):
        from utils.migration_prompts import build_migration_prompt
        system, user = build_migration_prompt(
            name="processTransfer",
            source_code="public void processTransfer() {}",
            source_lang="Java",
            target_lang="Java",
            target_profile=self.JAVA_PROFILE,
        )
        # System prompt is parameterized on the target language, not Python.
        assert "Java" in system
        assert "decimal.Decimal" not in system
        # Profile guidance flows into the user prompt.
        assert "BigDecimal" in user
        assert "JUnit 5" in user

    def test_test_prompt_uses_profile_framework_for_java(self):
        from utils.migration_prompts import build_test_prompt
        system, _ = build_test_prompt(
            name="processTransfer",
            migrated_code="void f() {}",
            target_lang="Java",
            target_profile=self.JAVA_PROFILE,
        )
        assert "JUnit 5" in system
        assert "pytest" not in system

    def test_test_prompt_defaults_framework_by_language(self):
        """With no profile, the framework is inferred from the target language."""
        from utils.migration_prompts import build_test_prompt
        system, _ = build_test_prompt(
            name="X", migrated_code="fn f() {}", target_lang="Rust"
        )
        assert "cargo test" in system
        assert "pytest" not in system

    def test_migration_prompt_includes_institutional_context(self):
        from utils.migration_prompts import build_migration_prompt
        _, user = build_migration_prompt(
            name="X", source_code=".", source_lang="COBOL", target_lang="Python",
            institutional_context="ACME rule: money fields are GBP pence; never change the £25 cap.",
        )
        assert "ORGANIZATION CONTEXT" in user
        assert "GBP pence" in user

    def test_review_prompt_includes_institutional_context(self):
        from utils.migration_prompts import build_review_prompt
        _, user = build_review_prompt(
            name="X", source_lang="COBOL", target_lang="Java",
            source_code="COMPUTE X = 1.", migrated_code="var x = 1;",
            institutional_context="ACME rule: route external transfers to suspense.",
        )
        assert "ORGANIZATION CONTEXT" in user
        assert "suspense" in user

    def test_strip_code_fence(self):
        from utils.migration_prompts import strip_code_fence
        assert strip_code_fence("```python\nx=1\n```") == "x=1"
        assert strip_code_fence("  plain  ") == "plain"

    def test_parse_json_loose_clean(self):
        from utils.migration_prompts import parse_json_loose
        result = parse_json_loose('{"a": 1}')
        assert result == {"a": 1}

    def test_parse_json_loose_embedded(self):
        from utils.migration_prompts import parse_json_loose
        result = parse_json_loose('Here is the answer: {"a": 1} done.')
        assert result == {"a": 1}

    def test_parse_json_loose_fenced(self):
        from utils.migration_prompts import parse_json_loose
        result = parse_json_loose("```json\n{\"a\": 1}\n```")
        assert result == {"a": 1}

    def test_parse_json_loose_returns_none_on_garbage(self):
        from utils.migration_prompts import parse_json_loose
        assert parse_json_loose("no json here at all") is None

    def test_llm_client_is_configured_false_without_key(self):
        from utils.llm_client import LLMClient
        original = os.environ.pop("VENICE_API_KEY", None)
        try:
            client = LLMClient()
            assert client.is_configured() is False
        finally:
            if original:
                os.environ["VENICE_API_KEY"] = original

    @pytest.mark.asyncio
    async def test_llm_client_preserves_venice_request_options(self):
        from utils.llm_client import LLMClient

        client = LLMClient()
        client._client = MagicMock()
        client._client.chat.completions.create = AsyncMock(
            return_value=MagicMock(
                choices=[MagicMock(message=MagicMock(content='{"ok": true}'))]
            )
        )
        client.reasoning_effort = "low"

        await client.complete(
            system="system",
            user="user",
            temperature=0.1,
            max_tokens=123,
            json_response=True,
        )

        kwargs = client._client.chat.completions.create.await_args.kwargs
        assert kwargs["response_format"] == {"type": "json_object"}
        assert kwargs["max_tokens"] == 123
        assert kwargs["extra_body"]["max_completion_tokens"] == 123
        assert kwargs["extra_body"]["reasoning_effort"] == "low"
        assert kwargs["extra_body"]["venice_parameters"] == {
            "enable_web_search": "off",
            "include_venice_system_prompt": False,
        }
