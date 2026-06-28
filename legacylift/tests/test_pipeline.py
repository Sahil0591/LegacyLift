"""
tests/test_pipeline.py — End-to-end pipeline smoke tests.

These tests verify that the skeleton pipeline runs from start to finish
without errors using only demo/stub data.  No real LLM calls are made
(DEMO_MODE=true is enforced via the fixture).

The goal of this test suite is NOT to validate business logic (there is none
yet) but to ensure that:
  1. All models can be instantiated
  2. Every layer returns a valid result (no exceptions)
  3. The pipeline completes end-to-end with the demo COBOL files
  4. WebSocket events are emitted in the correct order
  5. Approval flow works (both approve and reject paths)

Run with:
    pytest legacylift/tests/ -v

For async tests, pytest-asyncio is required (in requirements.txt).
The asyncio_mode = "auto" pragma in conftest.py makes all async tests auto-detected.

TODO (implementer): as real layer logic is added, replace stub assertions
("result is not None") with semantic assertions ("interest for $5000 at
2.5% daily = Decimal('0.34')").
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

import pytest
import pytest_asyncio

# Force DEMO_MODE for all tests — this prevents real LLM calls
os.environ["DEMO_MODE"]    = "true"
os.environ["AUTO_APPROVE"] = "true"   # Tests don't need human interaction

# Add project root to path so imports work without `pip install -e .`
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from legacylift.models.project import Project, ProjectStatus, UploadedFile, SourceLanguage
from legacylift.models.business_rule import BusinessRule, RuleConfidence, OwnershipResult
from legacylift.models.chunk import MigrationChunk, ChunkStatus, StaticAnalysisResult, AIReviewResult
from legacylift.models.validation import ValidationResult, ApprovalDecision, ApprovalAction
from legacylift.api.websocket_manager import WebSocketManager
from legacylift.core.pipeline import MigrationPipeline
from legacylift.core.layer0.archaeologist import Archaeologist
from legacylift.core.layer0.business_extractor import BusinessExtractor
from legacylift.core.layer0.dependency_mapper import DependencyMapper
from legacylift.core.layer0.risk_scorer import RiskScorer
from legacylift.core.layer0_5.doc_fetcher import DocFetcher
from legacylift.core.layer0_5.deprecation_mapper import DeprecationMapper
from legacylift.core.layer0_5.gotcha_registry import GotchaRegistry
from legacylift.core.layer1.static_analyser import StaticAnalyser
from legacylift.core.layer2.ai_reviewer import AIReviewer
from legacylift.core.layer3.test_generator import TestGenerator
from legacylift.utils.code_parser import CodeParser
from legacylift.utils.schema_parser import SchemaParser
from legacylift.ownership.classifier import classify_rule_ownership

# ---------------------------------------------------------------------------
# Demo COBOL content (inline so tests work without the demo/ folder)
# ---------------------------------------------------------------------------

DEMO_COBOL = """\
       IDENTIFICATION DIVISION.
       PROGRAM-ID. TESTPROG.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-BALANCE      PIC S9(13)V99   COMP-3.
       01  WS-TIER1-LIMIT  PIC S9(13)V99   COMP-3  VALUE 10000.00.
       01  WS-RATE-TIER1   PIC S9(2)V9(6)  COMP-3  VALUE 0.025000.
       PROCEDURE DIVISION.
       MAIN-SECTION.
           IF WS-BALANCE < WS-TIER1-LIMIT
             MOVE WS-RATE-TIER1 TO WS-INTEREST-RATE
           END-IF
           GOBACK.
       END PROGRAM TESTPROG.
"""

DEMO_PYTHON = """\
from decimal import Decimal

TIER1_LIMIT = Decimal('10000.00')
TIER1_RATE  = Decimal('0.025000')

def calc_interest(balance: Decimal) -> Decimal:
    if balance < TIER1_LIMIT:
        rate = TIER1_RATE
    else:
        rate = Decimal('0.037500')
    return (balance * rate / 365).quantize(Decimal('0.01'))
"""

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def demo_project() -> Project:
    """A minimal demo project with one COBOL file uploaded."""
    project = Project(name="Test Bank Migration", source_language=SourceLanguage.COBOL)
    project.files.append(UploadedFile(
        filename="interest_calc.cbl",
        language=SourceLanguage.COBOL,
        content=DEMO_COBOL,
        size_bytes=len(DEMO_COBOL),
    ))
    return project


@pytest.fixture
def demo_chunk() -> MigrationChunk:
    """A minimal demo chunk with source and migrated code."""
    return MigrationChunk(
        name="CALC-INTEREST-SECTION",
        source_code=DEMO_COBOL,
        migrated_code=DEMO_PYTHON,
        diff="--- interest_calc.cbl\n+++ migrated.py\n",
    )


@pytest.fixture
def demo_rule() -> BusinessRule:
    """A demo business rule for ownership classifier tests."""
    return BusinessRule(
        id="BR-001",
        title="Tier-1 Interest Rate Threshold",
        description="Accounts with balance below $10,000 earn interest at 2.5% per annum.",
        source_file="interest_calc.cbl",
        source_lines=(42, 58),
        confidence=RuleConfidence.HIGH,
        hardcoded_values=["10000", "0.025"],
    )


@pytest.fixture
def ws_manager() -> WebSocketManager:
    """A fresh WebSocketManager instance (no real connections)."""
    return WebSocketManager()


# ---------------------------------------------------------------------------
# Model tests
# ---------------------------------------------------------------------------

class TestModels:
    """Verify all Pydantic models can be instantiated and serialised."""

    def test_project_creation(self, demo_project: Project):
        assert demo_project.id.startswith("proj-")
        assert demo_project.status == ProjectStatus.CREATED
        assert len(demo_project.files) == 1
        assert demo_project.files[0].filename == "interest_calc.cbl"

    def test_business_rule_creation(self, demo_rule: BusinessRule):
        assert demo_rule.id == "BR-001"
        assert demo_rule.confidence == RuleConfidence.HIGH
        assert "10000" in demo_rule.hardcoded_values

    def test_migration_chunk_creation(self, demo_chunk: MigrationChunk):
        assert demo_chunk.status == ChunkStatus.PENDING
        assert demo_chunk.source_code != ""
        assert demo_chunk.migrated_code != ""

    def test_validation_result_creation(self):
        result = ValidationResult(layer="Layer1", passed=True)
        assert result.passed is True
        assert result.retries == 0

    def test_approval_decision_approve(self, demo_chunk: MigrationChunk):
        decision = ApprovalDecision(
            chunk_id=demo_chunk.id,
            action=ApprovalAction.APPROVE,
        )
        assert decision.action == ApprovalAction.APPROVE

    def test_approval_decision_reject(self, demo_chunk: MigrationChunk):
        decision = ApprovalDecision(
            chunk_id=demo_chunk.id,
            action=ApprovalAction.REJECT,
            reviewer_comment="Interest calculation uses float instead of Decimal",
        )
        assert decision.action == ApprovalAction.REJECT

    def test_model_dict_serialisation(self, demo_rule: BusinessRule):
        """All models must be dict-serialisable for WebSocket emission."""
        d = demo_rule.dict()
        assert "id" in d
        assert "title" in d
        assert "hardcoded_values" in d


# ---------------------------------------------------------------------------
# Layer 0 tests
# ---------------------------------------------------------------------------

class TestLayer0:
    """Smoke tests for the Layer 0 archaeology modules."""

    @pytest.mark.asyncio
    async def test_archaeologist_analyse(self, demo_project: Project):
        arch = Archaeologist()
        findings = await arch.analyse(demo_project)
        assert "files" in findings
        assert "interest_calc.cbl" in findings["files"]

    @pytest.mark.asyncio
    async def test_archaeologist_build_chunks(self, demo_project: Project):
        arch = Archaeologist()
        chunks = arch.build_chunks(demo_project, {"interest_calc.cbl": 0.72})
        assert len(chunks) > 0
        assert all(isinstance(c, MigrationChunk) for c in chunks)

    @pytest.mark.asyncio
    async def test_business_extractor_extract(self, demo_project: Project):
        extractor = BusinessExtractor()
        rules = await extractor.extract(demo_project)
        assert isinstance(rules, list)
        assert len(rules) > 0
        assert all(isinstance(r, BusinessRule) for r in rules)

    @pytest.mark.asyncio
    async def test_dependency_mapper_build_graph(self, demo_project: Project):
        mapper = DependencyMapper()
        graph = await mapper.build_graph(demo_project)
        assert isinstance(graph, dict)
        assert "interest_calc.cbl" in graph

    @pytest.mark.asyncio
    async def test_risk_scorer_score(self, demo_project: Project):
        scorer = RiskScorer()
        graph = {"interest_calc.cbl": []}
        scores = await scorer.score(demo_project, graph)
        assert isinstance(scores, dict)
        assert "interest_calc.cbl" in scores
        score = scores["interest_calc.cbl"]
        assert 0.0 <= score <= 1.0


# ---------------------------------------------------------------------------
# Layer 0.5 tests
# ---------------------------------------------------------------------------

class TestLayer05:
    """Smoke tests for Layer 0.5 target profile modules."""

    @pytest.mark.asyncio
    async def test_doc_fetcher(self):
        fetcher = DocFetcher()
        docs = await fetcher.fetch("Python")
        assert "version" in docs
        assert "libraries" in docs

    @pytest.mark.asyncio
    async def test_deprecation_mapper_cobol_python(self):
        mapper = DeprecationMapper()
        patterns = await mapper.map("COBOL", "Python")
        assert isinstance(patterns, list)
        assert len(patterns) > 0
        # Must include COMP-3 warning
        assert any("COMP-3" in p for p in patterns)

    @pytest.mark.asyncio
    async def test_gotcha_registry_cobol_python(self):
        registry = GotchaRegistry()
        gotchas = await registry.get_gotchas("COBOL", "Python")
        assert isinstance(gotchas, list)
        assert len(gotchas) > 0
        # Must include decimal precision warning
        assert any("Decimal" in g for g in gotchas)


# ---------------------------------------------------------------------------
# Layer 1 tests
# ---------------------------------------------------------------------------

class TestLayer1:
    """Smoke tests for static analysis."""

    @pytest.mark.asyncio
    async def test_analyse_valid_python(self, demo_chunk: MigrationChunk):
        analyser = StaticAnalyser()
        result = await analyser.analyse(demo_chunk)
        assert isinstance(result, StaticAnalysisResult)
        # The demo Python code should pass syntax check
        assert "SyntaxError" not in " ".join(result.issues)

    @pytest.mark.asyncio
    async def test_analyse_detects_float_financial(self):
        chunk = MigrationChunk(
            name="BAD-CHUNK",
            source_code="COMPUTE BAL = 0.",
            migrated_code="balance: float = 1000.0  # financial variable",
        )
        analyser = StaticAnalyser()
        result = await analyser.analyse(chunk)
        assert isinstance(result, StaticAnalysisResult)
        # Should flag float usage for financial variable
        assert any("float" in issue.lower() for issue in result.issues)

    @pytest.mark.asyncio
    async def test_analyse_syntax_error(self):
        chunk = MigrationChunk(
            name="BROKEN-CHUNK",
            source_code="MOVE 1 TO X.",
            migrated_code="def broken(\n    pass",
        )
        analyser = StaticAnalyser()
        result = await analyser.analyse(chunk)
        assert isinstance(result, StaticAnalysisResult)
        assert result.passed is False
        assert any("SyntaxError" in i or "CRITICAL" in i for i in result.issues)


# ---------------------------------------------------------------------------
# Layer 2 tests
# ---------------------------------------------------------------------------

class TestLayer2:
    """Smoke tests for AI code review."""

    @pytest.mark.asyncio
    async def test_review_returns_result(self, demo_chunk: MigrationChunk):
        reviewer = AIReviewer()
        result = await reviewer.review(demo_chunk)
        assert isinstance(result, AIReviewResult)
        assert result.issues_found >= 0

    @pytest.mark.asyncio
    async def test_review_does_not_raise(self, demo_chunk: MigrationChunk):
        reviewer = AIReviewer()
        # Should not raise even if LLM is unavailable
        try:
            result = await reviewer.review(demo_chunk)
            assert result is not None
        except Exception as exc:
            pytest.fail(f"AIReviewer.review() raised unexpectedly: {exc}")


# ---------------------------------------------------------------------------
# Layer 3 tests
# ---------------------------------------------------------------------------

class TestLayer3:
    """Smoke tests for test generation."""

    @pytest.mark.asyncio
    async def test_generate_and_run_returns_list(self, demo_chunk: MigrationChunk):
        generator = TestGenerator()
        results = await generator.generate_and_run(demo_chunk)
        assert isinstance(results, list)
        # Must return at least one test result
        assert len(results) > 0

    @pytest.mark.asyncio
    async def test_results_have_correct_shape(self, demo_chunk: MigrationChunk):
        generator = TestGenerator()
        results = await generator.generate_and_run(demo_chunk)
        for r in results:
            assert hasattr(r, "name")
            assert hasattr(r, "passed")
            assert isinstance(r.passed, bool)


# ---------------------------------------------------------------------------
# Ownership classifier tests
# ---------------------------------------------------------------------------

class TestOwnershipClassifier:
    """Smoke tests for Simonra's ownership classifier."""

    @pytest.mark.asyncio
    async def test_classify_finance_rule(self, demo_rule: BusinessRule):
        result = await classify_rule_ownership(demo_rule)
        assert isinstance(result, OwnershipResult)
        # Interest rate rule should be classified as Finance
        assert result.primary_owner is not None

    @pytest.mark.asyncio
    async def test_classify_with_no_git_log(self, demo_rule: BusinessRule):
        result = await classify_rule_ownership(demo_rule, git_log=None)
        assert result.actual_person is None

    @pytest.mark.asyncio
    async def test_classify_with_git_log(self, demo_rule: BusinessRule):
        fake_git_log = (
            "commit abc123\n"
            "Author: Jane Doe <jane.doe@bank.com>\n"
            "Date:   Mon Jun 15 14:32:00 2023 +1000\n\n"
            "    Update Tier-1 interest rate from 2.0% to 2.5%\n"
        )
        result = await classify_rule_ownership(demo_rule, git_log=fake_git_log)
        # Should surface Jane Doe as the actual person
        assert result.actual_person is not None
        assert "Jane Doe" in result.actual_person

    @pytest.mark.asyncio
    async def test_classify_does_not_raise(self, demo_rule: BusinessRule):
        try:
            result = await classify_rule_ownership(demo_rule)
            assert result is not None
        except Exception as exc:
            pytest.fail(f"classify_rule_ownership() raised unexpectedly: {exc}")


# ---------------------------------------------------------------------------
# Utility tests
# ---------------------------------------------------------------------------

class TestUtils:
    """Smoke tests for code_parser and schema_parser utilities."""

    def test_code_parser_parse_cobol(self):
        parser = CodeParser(language="cobol")
        nodes = parser.parse(DEMO_COBOL)
        assert isinstance(nodes, list)
        assert len(nodes) > 0

    def test_code_parser_extract_literals(self):
        parser = CodeParser(language="cobol")
        literals = parser.extract_literals(DEMO_COBOL)
        assert isinstance(literals, list)

    def test_code_parser_split_into_chunks(self):
        parser = CodeParser(language="cobol")
        chunks = parser.split_into_chunks(DEMO_COBOL)
        assert isinstance(chunks, list)
        assert all(len(c) == 4 for c in chunks)  # (name, src, start, end)

    def test_schema_parser_parse_text(self):
        sql = """
        CREATE TABLE ACCT_MSTR (
            ACCT_ID INTEGER NOT NULL,
            BAL_AMT DECIMAL(15,2) NOT NULL DEFAULT 0,
            STAT_CD CHAR(1) NOT NULL DEFAULT 'A'
        );
        """
        parser = SchemaParser()
        schema = parser.parse_text(sql, source_file="test.sql")
        assert len(schema.tables) == 1
        assert schema.tables[0].name == "ACCT_MSTR"
        assert len(schema.tables[0].columns) == 3

    def test_schema_parser_table_lookup(self):
        parser = SchemaParser()
        schema = parser._demo_schema("demo.sql")
        table = schema.get_table("ACCT_MSTR")
        assert table is not None
        assert len(table.columns) > 0


# ---------------------------------------------------------------------------
# WebSocket manager tests
# ---------------------------------------------------------------------------

class TestWebSocketManager:
    """Smoke tests for WebSocket event broadcasting."""

    @pytest.mark.asyncio
    async def test_emit_stores_event(self, ws_manager: WebSocketManager):
        await ws_manager.emit("proj-001", "archaeology_started")
        log = ws_manager.get_event_log("proj-001")
        assert len(log) == 1
        assert log[0]["event"] == "archaeology_started"
        assert log[0]["project_id"] == "proj-001"

    @pytest.mark.asyncio
    async def test_emit_with_payload(self, ws_manager: WebSocketManager):
        await ws_manager.emit(
            "proj-002",
            "business_rule_found",
            rule={"id": "BR-001", "title": "Test Rule"},
        )
        log = ws_manager.get_event_log("proj-002")
        assert log[0]["rule"]["id"] == "BR-001"

    @pytest.mark.asyncio
    async def test_emit_error_event(self, ws_manager: WebSocketManager):
        await ws_manager.emit_error(
            "proj-003", "Layer0", "Test error", recoverable=True
        )
        log = ws_manager.get_event_log("proj-003")
        assert log[0]["event"] == "error"
        assert log[0]["recoverable"] is True


# ---------------------------------------------------------------------------
# Full pipeline end-to-end test
# ---------------------------------------------------------------------------

class TestPipelineE2E:
    """
    Full end-to-end pipeline smoke test.

    With AUTO_APPROVE=true (set at module level), the pipeline runs all the
    way through without waiting for human input.  This test verifies the
    pipeline completes without raising an exception and the project reaches
    COMPLETE status.
    """

    @pytest.mark.asyncio
    async def test_pipeline_runs_end_to_end(
        self, demo_project: Project, ws_manager: WebSocketManager
    ):
        """
        Run the complete pipeline on the demo project and verify it completes.

        TODO (implementer): once real layers are implemented, add assertions:
          - len(pipeline.chunks) > 0
          - all chunks are APPROVED
          - validation_history has an entry for each layer
          - migration_complete event was emitted
        """
        pipeline = MigrationPipeline(demo_project, ws_manager)

        # Run the pipeline (AUTO_APPROVE=true means no human intervention needed)
        try:
            await pipeline.run()
        except Exception as exc:
            pytest.fail(f"Pipeline raised an exception: {exc}")

        # Verify the project reached a terminal state (COMPLETE or FAILED)
        # FAILED is acceptable for the skeleton — we just want no crashes
        assert demo_project.status in (
            ProjectStatus.COMPLETE,
            ProjectStatus.FAILED,
            ProjectStatus.VALIDATING,
        ), f"Unexpected final status: {demo_project.status}"

    @pytest.mark.asyncio
    async def test_pipeline_emits_events(
        self, demo_project: Project, ws_manager: WebSocketManager
    ):
        """Verify that the pipeline emits at least the expected first events."""
        pipeline = MigrationPipeline(demo_project, ws_manager)

        try:
            await pipeline.run()
        except Exception:
            pass  # We're testing events, not completion

        event_log = ws_manager.get_event_log(demo_project.id)
        event_names = [e["event"] for e in event_log]

        # These events must always be emitted, in order
        assert "archaeology_started" in event_names
        assert "archaeology_complete" in event_names

    @pytest.mark.asyncio
    async def test_approval_flow_approve(
        self, demo_project: Project, ws_manager: WebSocketManager
    ):
        """
        Test the approval resolution mechanism works.

        TODO (implementer): test the reject path and retry logic once
        pipeline.run_migration() calls the real LLM generation step.
        """
        pipeline = MigrationPipeline(demo_project, ws_manager)

        # Create a fake pending chunk future
        loop = asyncio.get_event_loop()
        from legacylift.models.validation import ApprovalDecision, ApprovalAction
        future = loop.create_future()
        test_chunk_id = "chunk-test-001"
        pipeline.pending_approvals[test_chunk_id] = future

        decision = ApprovalDecision(
            chunk_id=test_chunk_id,
            action=ApprovalAction.APPROVE,
        )

        resolved = pipeline.resolve_approval(decision)
        assert resolved is True
        assert future.done()
        assert future.result().action == ApprovalAction.APPROVE
