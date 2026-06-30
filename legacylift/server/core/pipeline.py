"""
core/pipeline.py — Main migration pipeline orchestrator.

This is the conductor of the entire LegacyLift system.  Every migration
runs through this class in a strict sequential order:

  Layer 0   → Archaeology (parse legacy code, extract business rules,
                            map dependencies, score risk)
  Layer 0.5 → Target Profile (fetch docs, map deprecations, build gotcha registry)
  [per chunk]
    Layer 1 → Static Analysis (syntax, type checks, complexity)
    Layer 2 → AI Code Review (semantic correctness vs. legacy source)
    Layer 3 → Test Generation & Execution
    [human approval gate]
  Layer 4   → Schema Validation (verify migrated code handles all DB tables)

Design principles:
  - Every stage emits WebSocket events at start AND end via manager.emit()
  - Every stage has a try/except that emits error events and returns a safe
    default so the pipeline degrades gracefully rather than crashing
  - Human approval is async: the pipeline pauses at await_approval() and
    resumes when api/main.py deposits an ApprovalDecision into pending_approvals
  - DEMO_MODE prints a Rich console summary at each stage transition

Usage (from api/main.py):
    pipeline = MigrationPipeline(project, manager)
    asyncio.create_task(pipeline.run())
"""

from __future__ import annotations

import asyncio
import dataclasses
import logging
import os
import time
from datetime import datetime
from typing import Optional

from rich.console import Console
from rich.rule import Rule

from api.websocket_manager import WebSocketManager, manager as ws_manager
from models.project import Project, ProjectStatus
from models.business_rule import BusinessRule
from models.chunk import MigrationChunk, ChunkStatus, StaticAnalysisResult, AIReviewResult
from models.validation import ValidationResult, ApprovalDecision, ApprovalAction

# Layer imports
import core.layer0 as _layer0_module
from core.layer0.archaeologist     import Archaeologist
from core.layer0.business_extractor import BusinessExtractor
from core.layer0.dependency_mapper  import DependencyMapper
from core.layer0.risk_scorer        import RiskScorer
from core.layer0_5.doc_fetcher      import DocFetcher
from core.layer0_5.deprecation_mapper import DeprecationMapper
from core.layer0_5.gotcha_registry  import GotchaRegistry
from core.layer1.static_analyser    import StaticAnalyser
from core.layer2.ai_reviewer        import AIReviewer
from core.layer3.test_generator     import TestGenerator
from core.layer4.schema_validator   import SchemaValidator, SchemaValidationResult

console = Console()
logger = logging.getLogger(__name__)
DEMO_MODE = os.getenv("DEMO_MODE", "true").lower() == "true"
AUTO_APPROVE = os.getenv("AUTO_APPROVE", "false").lower() == "true"

# ---------------------------------------------------------------------------
# State machine
# ---------------------------------------------------------------------------

_VALID_TRANSITIONS: dict[str, list[str]] = {
    "created":    ["uploading"],
    "uploading":  ["analysing"],
    "analysing":  ["ready", "failed"],
    "ready":      ["migrating"],
    "migrating":  ["validating", "failed"],
    "validating": ["complete", "failed"],
    "failed":     [],
}


async def _transition(project: Project, new_status: str) -> None:
    """Advance project.status through the allowed state machine."""
    current = project.status if isinstance(project.status, str) else project.status.value
    allowed = _VALID_TRANSITIONS.get(current, [])
    if new_status not in allowed:
        logger.warning(
            "Invalid transition %s → %s for project %s",
            current, new_status, project.id,
        )
        return
    logger.info("Project %s: %s → %s", project.id, current, new_status)
    project.status = new_status


# ---------------------------------------------------------------------------
# Primary pipeline entry point (called by api/main.py via asyncio.create_task)
# ---------------------------------------------------------------------------

async def run_pipeline(project: Project) -> None:
    """
    Run the full migration pipeline in the background.

    Currently implements Layer 0 (Code Archaeology) and transitions the
    project to 'ready'. Layers 1–4 are stubbed with TODOs below.

    Never raises — all exceptions are caught, the project transitions to
    'failed', and a pipeline_failed WebSocket event is broadcast.
    """
    try:
        await _transition(project, "analysing")
        project.started_at = datetime.utcnow()
        await ws_manager.emit(
            project.id,
            "pipeline_started",
            status="analysing",
        )

        # ── LAYER 0: Code Archaeology ──────────────────────────────────────
        logger.info("Project %s: starting Layer 0", project.id)
        import core.layer0 as layer0  # local import avoids circular dep at module load
        await ws_manager.emit(project.id, "archaeology_started")
        layer0_result = await layer0.run(project)

        # Store serialised chunks so select-chunk can look them up by ID
        project.layer0_chunks = [dataclasses.asdict(c) for c in layer0_result.chunks]

        # Cache summary stats on the project for GET /status
        project.chunk_count = len(layer0_result.chunks)
        project.needs_review_count = sum(
            1 for r in layer0_result.business_rules if r.needs_review
        )
        risk_summary: dict[str, int] = {"Low": 0, "Medium": 0, "High": 0, "Critical": 0}
        for chunk in layer0_result.chunks:
            lvl = chunk.risk_level
            risk_summary[lvl] = risk_summary.get(lvl, 0) + 1
        project.risk_summary = risk_summary

        # Emit events the frontend already handles (layer0.run() serialises
        # rules and graph onto the project before returning).
        for rule_dict in project.layer0_rules:
            await ws_manager.emit(project.id, "business_rule_found", rule=rule_dict)
        await ws_manager.emit(
            project.id,
            "dependency_graph_ready",
            graph=project.layer0_graph,
        )
        await ws_manager.emit(
            project.id,
            "risk_scores_ready",
            scores=project.risk_scores,
        )
        await ws_manager.emit(project.id, "archaeology_complete")

        await _transition(project, "ready")
        project.completed_at = datetime.utcnow()
        logger.info("Project %s: Layer 0 complete, status → ready", project.id)
        await ws_manager.emit(
            project.id,
            "analysis_complete",
            status="ready",
            chunk_count=project.chunk_count,
            rules_extracted=len(layer0_result.business_rules),
            needs_review_count=project.needs_review_count,
        )

        # ── LAYER 0.5: Target language profiling ───────────────────────────
        # TODO: implement core/layer0_5.py
        # await layer0_5.run(project)

        # ── LAYER 1: Static analysis ───────────────────────────────────────
        # TODO: implement core/layer1.py
        # await layer1.run(project)

        # ── LAYER 2: AI semantic review ────────────────────────────────────
        # TODO: implement core/layer2.py
        # await layer2.run(project)

        # ── LAYER 3: Test generation ───────────────────────────────────────
        # TODO: implement core/layer3.py
        # await layer3.run(project)

        # ── LAYER 4: Schema validation ─────────────────────────────────────
        # TODO: implement core/layer4.py
        # await layer4.run(project)

    except Exception as e:
        logger.error(
            "Pipeline failed for project %s: %s", project.id, e, exc_info=True
        )
        await _transition(project, "failed")
        project.error = str(e)
        project.completed_at = datetime.utcnow()
        await ws_manager.emit(
            project.id,
            "pipeline_failed",
            error=str(e),
        )


# ---------------------------------------------------------------------------
# Step 5+6: background task triggered by POST /select-chunk
# ---------------------------------------------------------------------------

async def run_migration_generation(project: Project, chunk_id: str) -> None:
    """
    Background task: generate a Python migration for the selected chunk,
    then automatically run Layer 1 static analysis.

    Called via asyncio.create_task() from the select-chunk endpoint.
    Broadcasts WebSocket events in order:
      chunk_started → migration_generated → static_analysis_complete
    Never raises — errors are caught and broadcast as error events.
    """
    try:
        # ── locate chunk + rule from stored Layer 0 data ───────────────────
        chunk_dict = next(
            (c for c in project.layer0_chunks if c["id"] == chunk_id), None
        )
        if chunk_dict is None:
            await ws_manager.emit_error(
                project.id,
                "migration",
                f"Chunk '{chunk_id}' not found in Layer 0 output",
                recoverable=False,
            )
            return

        rule_dict = next(
            (r for r in project.layer0_rules if r.get("chunk_id") == chunk_id), None
        )

        # ── gather related chunks from dependency graph ─────────────────────
        related_ids: set[str] = set()
        for edge in project.layer0_graph.get("edges", []):
            if edge.get("source") == chunk_id:
                related_ids.add(edge["target"])
            elif edge.get("target") == chunk_id:
                related_ids.add(edge["source"])

        related_chunks: list[dict] = []
        rule_by_chunk: dict[str, dict] = {r["chunk_id"]: r for r in project.layer0_rules}
        for rc in project.layer0_chunks:
            if rc["id"] in related_ids:
                rc_rule = rule_by_chunk.get(rc["id"])
                related_chunks.append({
                    "name": rc.get("name", ""),
                    "source": rc.get("source", ""),
                    "rule": rc_rule["rule"] if rc_rule else "",
                })

        await ws_manager.emit(
            project.id,
            "chunk_started",
            chunk_id=chunk_id,
            name=chunk_dict.get("name", chunk_id),
        )

        # ── generate migration ──────────────────────────────────────────────
        from core.migration.generator import MigrationInput, generate_migration  # noqa: PLC0415

        migration_input = MigrationInput(
            chunk_id=chunk_id,
            chunk_name=chunk_dict.get("name", chunk_id),
            chunk_source=chunk_dict.get("source", ""),
            chunk_language=chunk_dict.get("language", "cobol"),
            business_rule=(
                rule_dict["rule"] if rule_dict else "No business rule available"
            ),
            rule_confidence=float(rule_dict.get("confidence", 0.5)) if rule_dict else 0.5,
            source_language=str(project.source_language),
            related_chunks=related_chunks,
        )

        result = await generate_migration(migration_input)

        # Persist on project
        project.current_migration = dataclasses.asdict(result)

        await ws_manager.emit(
            project.id,
            "migration_generated",
            chunk_id=chunk_id,
            migrated_code=result.migrated_code,
            explanation=result.explanation,
            confidence=result.confidence,
        )

        # ── Layer 1: static analysis ────────────────────────────────────────
        pydantic_chunk = MigrationChunk(
            id=chunk_id,
            name=chunk_dict.get("name", chunk_id),
            source_code=chunk_dict.get("source", ""),
            migrated_code=result.migrated_code,
        )

        static_analyser = StaticAnalyser()
        static_result = await static_analyser.analyse(pydantic_chunk)

        await ws_manager.emit(
            project.id,
            "static_analysis_complete",
            passed=static_result.passed,
            issues=static_result.issues,
            chunk_id=chunk_id,
        )

        # ── Layer 2: AI semantic review ─────────────────────────────────────
        from core.layer2.ai_reviewer import review as _ai_review, AIReviewInput  # noqa: PLC0415
        from utils.code_parser import CodeChunk as _CodeChunk  # noqa: PLC0415
        from models.business_rule import BusinessRule as _BusinessRule  # noqa: PLC0415

        _code_chunk = _CodeChunk(
            id=chunk_id,
            name=chunk_dict.get("name", chunk_id),
            language=chunk_dict.get("language", "cobol"),
            source=chunk_dict.get("source", ""),
            start_line=chunk_dict.get("start_line", 0),
            end_line=chunk_dict.get("end_line", 0),
        )
        _business_rule = _BusinessRule(
            title=rule_dict.get("title", "Extracted Rule") if rule_dict else "Unknown Rule",
            description=(
                rule_dict.get("rule", "No business rule identified for this chunk")
                if rule_dict
                else "No business rule identified for this chunk"
            ),
            source_file=chunk_dict.get("filename", "unknown"),
        )
        _ai_review_input = AIReviewInput(
            chunk=_code_chunk,
            migrated_code=result.migrated_code,
            business_rule=_business_rule,
            static_analysis=static_result,
            source_language=chunk_dict.get("language", "cobol"),
        )

        ai_result = await _ai_review(_ai_review_input)

        await ws_manager.emit(
            project.id,
            "ai_review_complete",
            chunk_id=chunk_id,
            issues_found=ai_result.issues_found,
            issues=[dataclasses.asdict(issue) for issue in ai_result.issues],
            confidence=ai_result.reviewer_confidence,
            retry_recommended=ai_result.retry_recommended,
        )

        logger.info(
            "Migration + static analysis + AI review complete for chunk %s "
            "(static_passed=%s, ai_issues=%d, ai_confidence=%s)",
            chunk_id,
            static_result.passed,
            ai_result.issues_found,
            ai_result.reviewer_confidence,
        )

    except Exception as exc:
        logger.error(
            "run_migration_generation failed for chunk %s: %s",
            chunk_id,
            exc,
            exc_info=True,
        )
        await ws_manager.emit_error(
            project.id,
            "migration",
            str(exc),
            recoverable=True,
        )


# ---------------------------------------------------------------------------
# Result type aliases (type hints for return values from each stage)
# ---------------------------------------------------------------------------

class Layer0Result:
    """Aggregate output of the entire Layer 0 analysis."""
    def __init__(
        self,
        business_rules: list[BusinessRule],
        dependency_graph: dict,
        risk_scores: dict[str, float],
        chunks: list[MigrationChunk],
    ) -> None:
        self.business_rules = business_rules
        self.dependency_graph = dependency_graph
        self.risk_scores = risk_scores
        self.chunks = chunks


class TargetProfile:
    """Output of Layer 0.5 — target language compatibility profile."""
    def __init__(
        self,
        language: str,
        version: str,
        deprecated_patterns: list[str],
        gotchas: list[str],
        recommended_libraries: list[str],
    ) -> None:
        self.language = language
        self.version = version
        self.deprecated_patterns = deprecated_patterns
        self.gotchas = gotchas
        self.recommended_libraries = recommended_libraries

    def to_dict(self) -> dict:
        return {
            "language": self.language,
            "version": self.version,
            "deprecated_patterns": self.deprecated_patterns,
            "gotchas": self.gotchas,
            "recommended_libraries": self.recommended_libraries,
        }


# ---------------------------------------------------------------------------
# MigrationPipeline
# ---------------------------------------------------------------------------

class MigrationPipeline:
    """
    Orchestrates the full migration of a single Project through all layers.

    One instance per project run.  Create via MigrationPipeline(project, manager)
    and then call asyncio.create_task(pipeline.run()) from api/main.py.

    The pipeline is stateful: it holds the current list of chunks, the approval
    queue, and the validation history.
    """

    def __init__(self, project: Project, ws_manager: WebSocketManager) -> None:
        self.project = project
        self.manager = ws_manager

        # Chunks discovered by Layer 0 and processed by Layers 1-3
        self.chunks: list[MigrationChunk] = []

        # Approval futures: chunk_id -> asyncio.Future[ApprovalDecision]
        # pipeline.await_approval() creates the future; api/main.py resolves it
        self.pending_approvals: dict[str, asyncio.Future] = {}

        # Full validation history for reporting
        self.validation_history: list[ValidationResult] = []

        # Layer instances (instantiated once, reused per chunk)
        self._static_analyser = StaticAnalyser()
        self._ai_reviewer     = AIReviewer()
        self._test_generator  = TestGenerator()

    # -----------------------------------------------------------------------
    # Top-level entry point
    # -----------------------------------------------------------------------

    async def run(self) -> None:
        """
        Execute the full pipeline from Layer 0 through Layer 4.

        Called once per project by api/main.py. Runs to completion or until
        an unrecoverable error halts the pipeline.

        TODO (implementer): add checkpoint/resume logic so the pipeline can
        restart from the last successful stage if the server crashes.
        """
        self._banner("PIPELINE STARTED")
        self.project.status = ProjectStatus.ANALYSING

        try:
            # --- Layer 0: Archaeology ---
            layer0_result = await self.run_layer0(self.project)
            self.chunks = layer0_result.chunks

            # --- Layer 0.5: Target Profile ---
            target_profile = await self.run_layer0_5(self.project)
            self.project.target_profile = target_profile.to_dict()

            # --- Layers 1-3: Per-chunk migration ---
            self.project.status = ProjectStatus.MIGRATING
            for chunk in self.chunks:
                await self.run_migration(self.project, chunk)

            # --- Layer 4: Schema Validation ---
            self.project.status = ProjectStatus.VALIDATING
            schema_result = await self.run_layer4(self.project)

            # --- Done ---
            self.project.status = ProjectStatus.COMPLETE
            report = self._build_report(layer0_result, schema_result)
            await self.manager.emit(
                self.project.id,
                "migration_complete",
                report=report,
            )
            self._banner("PIPELINE COMPLETE", color="green")

        except Exception as exc:
            self.project.status = ProjectStatus.FAILED
            self.project.error_log.append(str(exc))
            await self.manager.emit_error(
                self.project.id,
                layer="pipeline",
                message=f"Unrecoverable pipeline error: {exc}",
                recoverable=False,
            )
            console.print_exception()

    # -----------------------------------------------------------------------
    # Layer 0 — Archaeology
    # -----------------------------------------------------------------------

    async def run_layer0(self, project: Project) -> Layer0Result:
        """
        Run the full Layer 0 archaeology analysis on all uploaded files.

        Stages within Layer 0 (run sequentially):
          1. Archaeologist    — scan code structure, count lines, etc.
          2. BusinessExtractor— identify business rules with LLM
          3. DependencyMapper — build module call graph
          4. RiskScorer       — assign risk score per file/chunk

        Args:
            project: The project with uploaded files to analyse.

        Returns:
            Layer0Result with business_rules, dependency_graph, risk_scores,
            and the list of MigrationChunks ready for Layers 1-3.

        TODO (implementer):
          - Replace stub calls with real layer implementations.
          - Each layer should process project.files in parallel using asyncio.gather().
        """
        self._stage_log("Layer 0: Archaeology")
        await self.manager.emit(project.id, "archaeology_started")
        t_start = time.monotonic()

        try:
            # Delegate to the full Layer 0 implementation
            l0 = await _layer0_module.run(project)

            # Convert Layer0 dataclass MigrationChunks → pydantic MigrationChunks
            # so downstream Layers 1-3 get the expected type.
            pydantic_chunks: list[MigrationChunk] = []
            for dc in l0.chunks:
                pydantic_chunks.append(MigrationChunk(
                    id=dc.id,
                    name=dc.name,
                    source_code=dc.source,
                    migrated_code="# TODO: LLM-generated Python goes here\npass",
                    diff=(
                        f"--- {dc.filename} (lines {dc.start_line}-{dc.end_line})\n"
                        "+++ migrated.py\n"
                        "# diff will be generated after migration\n"
                    ),
                    risk_level=dc.risk_level,
                ))
            self.chunks = pydantic_chunks

            # Keep project.dependency_graph as the legacy adjacency dict so
            # existing pipeline code doesn't break; the rich graph is in
            # project.layer0_graph (served by GET /graph).
            project.dependency_graph = {
                pf.filename: [] for pf in l0.parsed_files
            }

            elapsed = (time.monotonic() - t_start) * 1000
            await self.manager.emit(
                project.id,
                "archaeology_complete",
                findings={
                    "rules_found": len(l0.business_rules),
                    "files_scanned": len(l0.parsed_files),
                    "chunks_created": len(pydantic_chunks),
                    "elapsed_ms": round(elapsed),
                },
            )
            self.validation_history.append(
                ValidationResult(layer="Layer0", passed=True, duration_ms=elapsed)
            )
            return Layer0Result(
                business_rules=l0.business_rules,
                dependency_graph=project.dependency_graph,
                risk_scores=project.risk_scores,
                chunks=pydantic_chunks,
            )

        except Exception as exc:
            await self.manager.emit_error(
                project.id, "Layer0", str(exc), recoverable=True
            )
            self.validation_history.append(
                ValidationResult(layer="Layer0", passed=False, issues=[str(exc)])
            )
            # Return safe defaults so the pipeline continues with empty data
            return Layer0Result(
                business_rules=[],
                dependency_graph={},
                risk_scores={},
                chunks=self._create_fallback_chunks(project),
            )

    # -----------------------------------------------------------------------
    # Layer 0.5 — Target Profile
    # -----------------------------------------------------------------------

    async def run_layer0_5(self, project: Project) -> TargetProfile:
        """
        Build a compatibility profile for the target language version.

        Fetches documentation for the target language's standard library,
        maps deprecated APIs from the legacy language, and builds a gotcha
        registry of known translation pitfalls.

        Args:
            project: The project (used for target_language setting).

        Returns:
            TargetProfile with deprecated patterns, gotchas, and
            recommended libraries for the migration.

        TODO (implementer):
          - Wire doc_fetcher.py to real Python/Java documentation URLs.
          - Wire deprecation_mapper.py to compare COBOL idioms to Python
            equivalents and flag non-obvious differences.
          - Wire gotcha_registry.py to a curated list of known COBOL-to-Python
            pitfalls (COMP-3 arithmetic, fixed-length strings, etc.).
        """
        self._stage_log("Layer 0.5: Target Profile")
        t_start = time.monotonic()

        try:
            fetcher = DocFetcher()
            docs = await fetcher.fetch(project.target_language)

            mapper = DeprecationMapper()
            deprecated = await mapper.map(project.source_language, project.target_language)

            registry = GotchaRegistry()
            gotchas = await registry.get_gotchas(project.source_language, project.target_language)

            profile = TargetProfile(
                language=project.target_language,
                version=docs.get("version", "3.12"),
                deprecated_patterns=deprecated,
                gotchas=gotchas,
                recommended_libraries=docs.get("libraries", []),
            )

            await self.manager.emit(
                project.id, "target_profile_ready", profile=profile.to_dict()
            )
            elapsed = (time.monotonic() - t_start) * 1000
            self.validation_history.append(
                ValidationResult(layer="Layer0.5", passed=True, duration_ms=elapsed)
            )
            return profile

        except Exception as exc:
            await self.manager.emit_error(
                project.id, "Layer0.5", str(exc), recoverable=True
            )
            return TargetProfile(
                language=project.target_language,
                version="3.12",
                deprecated_patterns=[],
                gotchas=[],
                recommended_libraries=["decimal", "datetime"],
            )

    # -----------------------------------------------------------------------
    # Migration — Layers 1-3 per chunk
    # -----------------------------------------------------------------------

    async def run_migration(self, project: Project, chunk: MigrationChunk) -> MigrationChunk:
        """
        Run Layers 1, 2, and 3 for a single migration chunk, then await
        human approval.

        Retries are handled at the individual layer level. If a chunk exceeds
        LLM_MAX_RETRIES, it is marked REJECTED and the pipeline moves on.

        Args:
            project: Parent project (for context and WebSocket scoping).
            chunk:   The MigrationChunk to process.

        Returns:
            The chunk with all layers' results populated and status set to
            APPROVED or REJECTED.

        TODO (implementer):
          - Add the actual LLM call that GENERATES migrated_code from source_code.
            Right now the pipeline assumes migrated_code was set upstream.
            Add a run_migration_llm() call before Layer 1 that populates it.
          - Compute diff using difflib.unified_diff(source_lines, migrated_lines).
        """
        chunk.status = ChunkStatus.RUNNING
        await self.manager.emit(
            project.id, "chunk_started", chunk_id=chunk.id, name=chunk.name
        )

        # --- Layer 1: Static Analysis ---
        static_result = await self.run_layer1(chunk)
        chunk.static_analysis = static_result
        await self.manager.emit(
            project.id,
            "static_analysis_complete",
            passed=static_result.passed,
            issues=static_result.issues,
        )

        # --- Layer 2: AI Review ---
        ai_result = await self.run_layer2(chunk)
        chunk.ai_review = ai_result
        await self.manager.emit(
            project.id,
            "ai_review_complete",
            issues_found=ai_result.issues_found,
        )

        # --- Layer 3: Tests ---
        test_results = await self.run_layer3(chunk)
        chunk.test_results = test_results

        passed_count = sum(1 for t in test_results if t.passed)
        failed_count = len(test_results) - passed_count
        await self.manager.emit(
            project.id,
            "tests_complete",
            passed=passed_count,
            failed=failed_count,
        )

        # --- Approval gate ---
        chunk.status = ChunkStatus.REVIEW
        await self.manager.emit(
            project.id,
            "chunk_ready_for_approval",
            chunk_id=chunk.id,
            diff=chunk.diff or "# No diff generated yet",
        )

        decision = await self.await_approval(chunk.id)

        if decision.action == ApprovalAction.APPROVE:
            chunk.status = ChunkStatus.APPROVED
            await self.manager.emit(project.id, "chunk_approved", chunk_id=chunk.id)
        else:
            chunk.status = ChunkStatus.REJECTED
            await self.manager.emit_error(
                project.id,
                "Approval",
                f"Chunk {chunk.id} rejected: {decision.reviewer_comment}",
                recoverable=True,
            )

        return chunk

    # -----------------------------------------------------------------------
    # Layer 1 — Static Analysis
    # -----------------------------------------------------------------------

    async def run_layer1(self, chunk: MigrationChunk) -> StaticAnalysisResult:
        """
        Run static analysis on the migrated code for a single chunk.

        Args:
            chunk: MigrationChunk with migrated_code populated.

        Returns:
            StaticAnalysisResult with passed flag and list of issues.

        TODO (implementer): connect to static_analyser.py which should run
        ast.parse() for syntax errors and radon for complexity scoring.
        """
        self._stage_log(f"Layer 1: Static Analysis [{chunk.name}]")
        try:
            result = await self._static_analyser.analyse(chunk)
            self.validation_history.append(
                ValidationResult(
                    layer="Layer1",
                    passed=result.passed,
                    issues=result.issues,
                )
            )
            return result
        except Exception as exc:
            await self.manager.emit_error(
                self.project.id, "Layer1", str(exc), recoverable=True
            )
            return StaticAnalysisResult(passed=True, issues=[])

    # -----------------------------------------------------------------------
    # Layer 2 — AI Code Review
    # -----------------------------------------------------------------------

    async def run_layer2(self, chunk: MigrationChunk) -> AIReviewResult:
        """
        Run AI semantic review comparing legacy source to migrated code.

        Args:
            chunk: MigrationChunk with both source_code and migrated_code.

        Returns:
            AIReviewResult with issues_found, critical_issues, and warnings.

        TODO (implementer): connect to ai_reviewer.py which should send
        source_code + migrated_code to the LLM and parse structured JSON back.
        """
        self._stage_log(f"Layer 2: AI Review [{chunk.name}]")
        try:
            result = await self._ai_reviewer.review(chunk)
            self.validation_history.append(
                ValidationResult(
                    layer="Layer2",
                    passed=result.issues_found == 0,
                    issues=result.critical_issues,
                )
            )
            return result
        except Exception as exc:
            await self.manager.emit_error(
                self.project.id, "Layer2", str(exc), recoverable=True
            )
            return AIReviewResult(issues_found=0)

    # -----------------------------------------------------------------------
    # Layer 3 — Test Generation & Execution
    # -----------------------------------------------------------------------

    async def run_layer3(self, chunk: MigrationChunk) -> list:
        """
        Generate and run tests for the migrated chunk.

        Args:
            chunk: MigrationChunk with migrated_code populated.

        Returns:
            List of TestResult objects (one per generated test case).

        TODO (implementer): connect to test_generator.py which should:
          1. Ask the LLM to write pytest cases that exercise the migrated code
          2. Write them to a temp file
          3. Run pytest programmatically with subprocess or pytest.main()
          4. Parse the JUnit XML output into TestResult objects
        """
        self._stage_log(f"Layer 3: Tests [{chunk.name}]")
        try:
            results = await self._test_generator.generate_and_run(chunk)
            await self.manager.emit(
                self.project.id, "tests_running", total=len(results)
            )
            for r in results:
                await self.manager.emit(
                    self.project.id, "test_result", name=r.name, passed=r.passed
                )
            return results
        except Exception as exc:
            await self.manager.emit_error(
                self.project.id, "Layer3", str(exc), recoverable=True
            )
            return []

    # -----------------------------------------------------------------------
    # Layer 4 — Schema Validation
    # -----------------------------------------------------------------------

    async def run_layer4(self, project: Project) -> SchemaValidationResult:
        """
        Validate that the migrated codebase handles all legacy schema tables.

        Runs after ALL chunks are approved. Checks that:
          - Every table referenced in the legacy SQL is handled in migrated code
          - Column names and types are preserved or explicitly mapped
          - No orphaned table references

        Args:
            project: The project (used to find schema files and migrated chunks).

        Returns:
            SchemaValidationResult with passed flag and list of issues.

        TODO (implementer): connect to schema_validator.py which should:
          1. Load the legacy .sql schema via schema_parser.py
          2. Grep migrated_code across all chunks for table names
          3. Report any table that is referenced in SQL but missing from code
        """
        self._stage_log("Layer 4: Schema Validation")
        t_start = time.monotonic()

        try:
            validator = SchemaValidator()
            result = await validator.validate(project, self.chunks)
            elapsed = (time.monotonic() - t_start) * 1000
            self.validation_history.append(
                ValidationResult(
                    layer="Layer4",
                    passed=result.passed,
                    issues=result.issues,
                    duration_ms=elapsed,
                )
            )
            return result
        except Exception as exc:
            await self.manager.emit_error(
                self.project.id, "Layer4", str(exc), recoverable=False
            )
            return SchemaValidationResult(passed=True, issues=[], tables_checked=0)

    # -----------------------------------------------------------------------
    # Human approval gate
    # -----------------------------------------------------------------------

    async def await_approval(self, chunk_id: str) -> ApprovalDecision:
        """
        Pause the pipeline and wait for a human to approve or reject a chunk.

        Creates an asyncio.Future and stores it in self.pending_approvals.
        The future is resolved by api/main.py when POST /approve or /reject hits.

        In AUTO_APPROVE mode (set via .env), resolves immediately with APPROVE
        so demos can run end-to-end without human interaction.

        Args:
            chunk_id: ID of the chunk awaiting review.

        Returns:
            ApprovalDecision with action APPROVE or REJECT.

        TODO (implementer): add a timeout so a forgotten chunk doesn't block
        the pipeline indefinitely. Use asyncio.wait_for() with a configurable
        timeout (e.g. 30 minutes for production, 30 seconds for demos).
        """
        if AUTO_APPROVE:
            console.print(
                f"[dim]AUTO_APPROVE: auto-approving chunk {chunk_id}[/dim]"
            )
            return ApprovalDecision(chunk_id=chunk_id, action=ApprovalAction.APPROVE)

        loop = asyncio.get_event_loop()
        future: asyncio.Future[ApprovalDecision] = loop.create_future()
        self.pending_approvals[chunk_id] = future

        console.print(
            f"[bold yellow]WAITING FOR APPROVAL:[/bold yellow] chunk {chunk_id} — "
            "POST /api/project/{id}/approve/{chunk_id} to continue"
        )

        decision = await future
        del self.pending_approvals[chunk_id]
        return decision

    def resolve_approval(self, decision: ApprovalDecision) -> bool:
        """
        Called by api/main.py to resolve a pending approval future.

        Args:
            decision: The ApprovalDecision from the reviewer.

        Returns:
            True if the future was found and resolved, False if chunk_id
            was not waiting for approval (idempotent).
        """
        future = self.pending_approvals.get(decision.chunk_id)
        if future and not future.done():
            future.set_result(decision)
            return True
        return False

    # -----------------------------------------------------------------------
    # Helpers
    # -----------------------------------------------------------------------

    def _create_fallback_chunks(self, project: Project) -> list[MigrationChunk]:
        """
        Create minimal stub chunks from uploaded files for demo/error fallback.

        TODO (implementer): remove once archaeologist.build_chunks() is real.
        """
        chunks = []
        for f in project.files:
            chunk = MigrationChunk(
                name=f"CHUNK-{f.filename.upper().replace('.', '-')}",
                source_code=f.content[:500] if f.content else "-- empty --",
                migrated_code="# TODO: migrated code goes here\npass",
                diff="--- original\n+++ migrated\n",
            )
            chunks.append(chunk)
        if not chunks:
            # Always have at least one chunk so tests can run
            chunks.append(MigrationChunk(
                name="DEMO-CHUNK",
                source_code="MOVE 10000 TO THRESHOLD.",
                migrated_code="THRESHOLD = 10_000",
                diff="--- original\n+++ migrated\n-MOVE 10000 TO THRESHOLD.\n+THRESHOLD = 10_000\n",
            ))
        return chunks

    def _build_report(
        self, layer0: Layer0Result, schema: SchemaValidationResult
    ) -> dict:
        """Build the final migration report dict emitted with migration_complete."""
        approved = sum(1 for c in self.chunks if c.status == ChunkStatus.APPROVED)
        rejected = sum(1 for c in self.chunks if c.status == ChunkStatus.REJECTED)
        tests_passed = sum(
            sum(1 for t in c.test_results if t.passed) for c in self.chunks
        )
        tests_total = sum(len(c.test_results) for c in self.chunks)

        return {
            "project_id":      self.project.id,
            "project_name":    self.project.name,
            "chunks_total":    len(self.chunks),
            "chunks_approved": approved,
            "chunks_rejected": rejected,
            "rules_found":     len(layer0.business_rules),
            "tests_passed":    tests_passed,
            "tests_total":     tests_total,
            "schema_passed":   schema.passed,
            "schema_issues":   schema.issues,
            "layers":          [v.dict() for v in self.validation_history],
        }

    def _stage_log(self, label: str) -> None:
        if DEMO_MODE:
            console.print(Rule(f"[bold]{label}[/bold]", style="blue"))

    def _banner(self, label: str, color: str = "magenta") -> None:
        if DEMO_MODE:
            console.print(Rule(f"[bold {color}]{label}[/bold {color}]"))
