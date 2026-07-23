"""
tests/test_cross_chunk_context.py — Unit tests for the cross-chunk context and
dependency-ordered migration features:

  - utils/symbol_index.extract_exports          (target API surface extraction)
  - core/migration/ordering.compute_migration_order   (callees-before-callers)
  - core/migration/target_api.build_target_api / render_dependency_source
  - core/pipeline._build_project_manifest       (live-shape key fix)
  - utils/migration_prompts.build_migration_prompt / build_finalize_prompt
    (new DIRECT DEPENDENCIES + ALREADY-MIGRATED TARGET API blocks)

No HTTP / no LLM — pure deterministic logic.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from types import SimpleNamespace

os.environ.setdefault("DEMO_MODE", "true")
sys.path.insert(0, str(Path(__file__).parent.parent))


# ── demo-shaped fixture (mirrors the 3 sample COBOL files) ───────────────────

def _demo_chunks() -> list[dict]:
    return [
        {"id": "interest_calc__calc_interest", "name": "CALC-INTEREST", "filename": "interest_calc.cbl", "start_line": 57, "source": "CALC-INTEREST.\n  PERFORM APPLY-BONUS-RATE\n  PERFORM UPDATE-ACCOUNT"},
        {"id": "interest_calc__apply_bonus_rate", "name": "APPLY-BONUS-RATE", "filename": "interest_calc.cbl", "start_line": 73, "source": "APPLY-BONUS-RATE."},
        {"id": "interest_calc__update_account", "name": "UPDATE-ACCOUNT", "filename": "interest_calc.cbl", "start_line": 85, "source": "UPDATE-ACCOUNT.\n  PERFORM ERROR-HANDLER"},
        {"id": "interest_calc__error_handler", "name": "ERROR-HANDLER", "filename": "interest_calc.cbl", "start_line": 101, "source": "ERROR-HANDLER."},
        {"id": "eod__run_eod", "name": "RUN-EOD", "filename": "end_of_day_batch.cbl", "start_line": 60, "source": "RUN-EOD.\n  PERFORM CALC-INTEREST"},
    ]


def _demo_graph() -> dict:
    chunks = _demo_chunks()
    return {
        "nodes": [{"id": c["id"], "label": c["name"], "filename": c["filename"]} for c in chunks],
        "edges": [
            {"source": "interest_calc__calc_interest", "target": "interest_calc__apply_bonus_rate", "edge_type": "call"},
            {"source": "interest_calc__calc_interest", "target": "interest_calc__update_account", "edge_type": "call"},
            {"source": "interest_calc__update_account", "target": "interest_calc__error_handler", "edge_type": "call"},
            {"source": "eod__run_eod", "target": "interest_calc__calc_interest", "edge_type": "call"},
            # a data edge that must NOT constrain ordering:
            {"source": "interest_calc__update_account", "target": "acct_master__table", "edge_type": "data_write"},
        ],
    }


# ── symbol_index.extract_exports ─────────────────────────────────────────────

class TestExtractExports:

    def test_python_functions_types_constants(self):
        from utils.symbol_index import extract_exports
        code = (
            "from decimal import Decimal\n\n"
            'PREMIUM_BONUS = Decimal("0.0025")\n'
            "HIGH_BALANCE_THRESHOLD = 100000\n\n"
            "def calculate_interest(balance: Decimal, rate: Decimal, days: int) -> Decimal:\n"
            "    return balance\n\n"
            "class Account:\n    pass\n\n"
            "def _private(x):\n    return x\n"
        )
        s = extract_exports(code, "Python")
        assert any("def calculate_interest(balance: Decimal, rate: Decimal, days: int) -> Decimal" in f for f in s.functions)
        assert "class Account" in s.types
        assert "PREMIUM_BONUS" in s.constants
        assert "HIGH_BALANCE_THRESHOLD" in s.constants
        # private helpers are not part of the public surface
        assert not any("_private" in f for f in s.functions)

    def test_python_falls_back_to_regex_on_syntax_error(self):
        from utils.symbol_index import extract_exports
        # Trailing unfinished line breaks ast.parse; regex must still find the def.
        code = "def calc_interest(bal):\n    return bal\n\ndef broken(\n"
        s = extract_exports(code, "Python")
        assert any("calc_interest" in f for f in s.functions)

    def test_java(self):
        from utils.symbol_index import extract_exports
        code = (
            "public final class InterestCalc {\n"
            "    public static final int MAX = 100000;\n"
            "    public static BigDecimal calculateInterest(BigDecimal balance, int days) {\n"
            "        return balance;\n    }\n}\n"
        )
        s = extract_exports(code, "Java")
        assert any("calculateInterest" in f for f in s.functions)
        assert any("class InterestCalc" in t for t in s.types)
        assert "MAX" in s.constants

    def test_go(self):
        from utils.symbol_index import extract_exports
        code = "package legacylift\n\nfunc CalculateInterest(bal int64) int64 {\n    return bal\n}\n\ntype Ledger struct {\n}\n"
        s = extract_exports(code, "Go")
        assert any("CalculateInterest" in f for f in s.functions)
        assert any("Ledger" in t for t in s.types)

    def test_sql(self):
        from utils.symbol_index import extract_exports
        code = "CREATE TABLE account_master (id INT);\nCREATE OR REPLACE FUNCTION calc_interest() RETURNS NUMERIC AS $$ BEGIN RETURN 0; END; $$;"
        s = extract_exports(code, "SQL")
        assert any("account_master" in t for t in s.types)
        assert any("calc_interest" in f for f in s.functions)

    def test_empty_and_unknown_language(self):
        from utils.symbol_index import extract_exports
        assert extract_exports("", "Python").is_empty()
        assert extract_exports("def f(): pass", "Klingon").is_empty()


# ── ordering.compute_migration_order ─────────────────────────────────────────

class TestMigrationOrder:

    def test_callees_before_callers(self):
        from core.migration.ordering import compute_migration_order
        order = compute_migration_order(_demo_chunks(), _demo_graph())
        idx = {cid: i for i, cid in enumerate(order)}
        assert set(idx) == {c["id"] for c in _demo_chunks()}
        assert idx["interest_calc__error_handler"] < idx["interest_calc__update_account"]
        assert idx["interest_calc__update_account"] < idx["interest_calc__calc_interest"]
        assert idx["interest_calc__apply_bonus_rate"] < idx["interest_calc__calc_interest"]
        assert idx["interest_calc__calc_interest"] < idx["eod__run_eod"]

    def test_cycle_does_not_hang_and_covers_all(self):
        from core.migration.ordering import compute_migration_order
        chunks = [
            {"id": "a", "name": "A", "filename": "f.cbl", "start_line": 1},
            {"id": "b", "name": "B", "filename": "f.cbl", "start_line": 2},
        ]
        graph = {"nodes": [], "edges": [
            {"source": "a", "target": "b", "edge_type": "call"},
            {"source": "b", "target": "a", "edge_type": "call"},
        ]}
        order = compute_migration_order(chunks, graph)
        assert sorted(order) == ["a", "b"]

    def test_data_and_unknown_edges_ignored(self):
        from core.migration.ordering import compute_migration_order
        chunks = [{"id": "x", "name": "X", "filename": "f.cbl", "start_line": 1}]
        graph = {"nodes": [], "edges": [
            {"source": "x", "target": "some_table", "edge_type": "data_read"},
            {"source": "x", "target": "external_prog", "edge_type": "unknown"},
        ]}
        assert compute_migration_order(chunks, graph) == ["x"]

    def test_empty(self):
        from core.migration.ordering import compute_migration_order
        assert compute_migration_order([], None) == []


# ── target_api.build_target_api / render_dependency_source ────────────────────

class TestTargetApi:

    def _project(self, **overrides):
        base = dict(
            layer0_chunks=_demo_chunks(),
            layer0_graph=_demo_graph(),
            layer0_rules=[{"id": "r", "chunk_id": "interest_calc__calc_interest", "rule": "Interest = bal*rate/100*days/365 ROUNDED."}],
            chunk_migrations={},
            current_migration=None,
            chunk_approvals={},
        )
        base.update(overrides)
        return SimpleNamespace(**base)

    def test_caller_sees_generated_dependency_signature(self):
        from core.migration.target_api import build_target_api
        project = self._project(
            chunk_migrations={
                "interest_calc__calc_interest": (
                    "from decimal import Decimal\n\n"
                    "def calculate_interest(balance: Decimal, rate: Decimal, days: int) -> Decimal:\n"
                    "    return balance\n"
                ),
            },
            chunk_approvals={"interest_calc__calc_interest": "approved"},
        )
        api = build_target_api(project, "eod__run_eod", lambda fn: "Python")
        assert "calculate_interest" in api
        assert "interest_calc.py" in api
        assert "[approved]" in api

    def test_draft_status_for_unapproved(self):
        from core.migration.target_api import build_target_api
        project = self._project(
            chunk_migrations={"interest_calc__calc_interest": "def calculate_interest():\n    return 0\n"},
        )
        api = build_target_api(project, "eod__run_eod", lambda fn: "Python")
        assert "[draft]" in api

    def test_empty_when_no_generated_deps(self):
        from core.migration.target_api import build_target_api
        api = build_target_api(self._project(), "eod__run_eod", lambda fn: "Python")
        assert api == ""

    def test_render_dependency_source(self):
        from core.migration.target_api import render_dependency_source
        out = render_dependency_source([
            {"name": "CALC-INTEREST", "source": "CALC-INTEREST.\n  PERFORM APPLY-BONUS-RATE", "rule": "Interest formula."},
        ])
        assert "CALC-INTEREST" in out
        assert "PERFORM APPLY-BONUS-RATE" in out
        assert "rule: Interest formula." in out


# ── pipeline._build_project_manifest (live-shape key fix) ─────────────────────

class TestProjectManifest:

    def test_manifest_emits_edges_and_rules_for_live_shape(self):
        from core.pipeline import _build_project_manifest
        project = SimpleNamespace(
            layer0_graph=_demo_graph(),
            layer0_chunks=_demo_chunks(),
            layer0_rules=[
                {"id": "r1", "chunk_id": "interest_calc__calc_interest", "rule": "Interest = bal*rate/100*days/365."},
            ],
        )
        # Build the manifest as seen from RUN-EOD's file: it must describe the
        # OTHER file (interest_calc.cbl) with real edges + rules (previously empty).
        manifest = _build_project_manifest(project, "end_of_day_batch.cbl")
        assert "interest_calc.cbl" in manifest
        assert "depends:" in manifest  # edges are emitted (bug previously dropped them)
        assert "CALC-INTEREST" in manifest  # node labels used, not raw ids
        assert "rule:" in manifest and "Interest =" in manifest  # rules attributed via chunk_id


# ── migration_prompts new blocks ─────────────────────────────────────────────

class TestPromptBlocks:

    def test_migration_prompt_includes_dependency_and_api_blocks(self):
        from utils.migration_prompts import build_migration_prompt
        system, user = build_migration_prompt(
            name="RUN-EOD",
            source_code="RUN-EOD. PERFORM CALC-INTEREST.",
            source_lang="COBOL",
            target_lang="Python",
            dependencies_source="--- CALC-INTEREST ---\nCALC-INTEREST. PERFORM APPLY-BONUS-RATE.",
            generated_api="- CALC-INTEREST  ->  interest_calc.py  [approved]\n    def calculate_interest(balance, rate, days)",
        )
        assert "DIRECT DEPENDENCIES" in user
        assert "APPLY-BONUS-RATE" in user
        assert "ALREADY-MIGRATED TARGET API" in user
        assert "calculate_interest" in user
        # naming convention lives in the system prompt
        assert "NAMING CONVENTION" in system

    def test_migration_prompt_omits_blocks_when_absent(self):
        from utils.migration_prompts import build_migration_prompt
        _, user = build_migration_prompt(
            name="X", source_code=".", source_lang="COBOL", target_lang="Python",
        )
        assert "ALREADY-MIGRATED TARGET API" not in user
        assert "DIRECT DEPENDENCIES" not in user

    def test_finalize_prompt_includes_generated_api(self):
        from utils.migration_prompts import build_finalize_prompt
        _, user = build_finalize_prompt(
            filename="eod.py",
            target_lang="Python",
            assembled_code="x = 1",
            generated_api="- CALC-INTEREST  ->  interest_calc.py  [approved]\n    def calculate_interest(...)",
        )
        assert "ALREADY-MIGRATED TARGET API OF OTHER FILES" in user
        assert "calculate_interest" in user
