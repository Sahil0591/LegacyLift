"""Layer 0 — Code Archaeology: parse legacy code and extract structured insights.

Public entry point:
    async def run(project: Project) -> Layer0Result

Called by core/pipeline.py. Never raises — degrades gracefully on sub-step
failures and returns partial results with error markers.
"""

from __future__ import annotations

import asyncio
import dataclasses
import json
import logging
import re
from dataclasses import dataclass, field
from typing import Optional

from utils.code_parser import parse_file, ParsedFile, CodeChunk
from utils.llm_client import LLMClient
from models.project import Project

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Layer 0 data contracts (plain dataclasses — not pydantic)
# ---------------------------------------------------------------------------

@dataclass
class BusinessRule:
    id: str
    chunk_id: str
    rule: str
    confidence: float
    owner: str
    owner_reasoning: str
    key_variables: list[str] = field(default_factory=list)
    depends_on: list[str] = field(default_factory=list)
    needs_review: bool = False
    extraction_error: Optional[str] = None


@dataclass
class GraphNode:
    id: str
    label: str
    filename: str
    language: str
    risk_level: str = "Unknown"
    risk_score: int = 0


@dataclass
class GraphEdge:
    source: str
    target: str
    edge_type: str = "call"


@dataclass
class DependencyGraph:
    nodes: list[GraphNode] = field(default_factory=list)
    edges: list[GraphEdge] = field(default_factory=list)


@dataclass
class MigrationChunk:
    id: str
    name: str
    filename: str
    language: str
    source: str
    start_line: int
    end_line: int
    business_rule: Optional[BusinessRule] = None
    risk_level: str = "Unknown"
    risk_score: int = 0
    status: str = "pending"
    migrated_code: Optional[str] = None
    review_result: Optional[str] = None


@dataclass
class Layer0Result:
    parsed_files: list[ParsedFile]
    business_rules: list[BusinessRule]
    dependency_graph: DependencyGraph
    chunks: list[MigrationChunk]


# ---------------------------------------------------------------------------
# Venice AI prompt templates
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT = (
    "You are a senior business analyst reading legacy COBOL code "
    "for a bank. Your job is to extract the single business rule "
    "this code implements. Be precise. Use plain English a "
    "non-engineer can understand. Do not describe what the code "
    "does mechanically — describe what business outcome it produces. "
    "Output JSON only. No prose. No markdown fences. No explanation."
)


def _build_user_prompt(chunk: CodeChunk) -> str:
    return (
        f"Program: {chunk.name}\n"
        f"Language: {chunk.language}\n"
        f"Source:\n{chunk.source}\n\n"
        "Respond with this exact JSON and nothing else:\n"
        '{\n'
        '  "rule": "one sentence plain English business rule",\n'
        '  "confidence": 0.85,\n'
        '  "owner": "Finance",\n'
        '  "owner_reasoning": "one sentence explaining classification",\n'
        '  "key_variables": ["VAR1", "VAR2"],\n'
        '  "depends_on": ["PARAGRAPH-NAME"]\n'
        '}\n\n'
        "owner must be exactly one of: Finance, Compliance, Risk, "
        "Product, Ops, Engineering, Unknown"
    )


# ---------------------------------------------------------------------------
# Demo mode rule mapping
# ---------------------------------------------------------------------------

_DEMO_RULES: dict[str, dict] = {
    "CALC-INTEREST": {
        "rule": (
            "Calculates compound interest on savings accounts using daily compounding, "
            "with a bonus rate applied for eligible high-balance accounts."
        ),
        "owner": "Finance",
        "owner_reasoning": "Directly computes monetary interest accrual on customer savings products.",
        "confidence": 0.95,
        "needs_review": False,
    },
    "APPLY-BONUS-RATE": {
        "rule": (
            "Applies a 0.15% bonus interest rate to accounts with balances generating "
            "over £500 interest, incentivising long-term savings."
        ),
        "owner": "Finance",
        "owner_reasoning": "Governs rate adjustments tied to product tier and balance thresholds.",
        "confidence": 0.88,
        "needs_review": False,
    },
    "UPDATE-ACCOUNT": {
        "rule": (
            "Posts the calculated interest amount to the account master record and "
            "triggers immediate balance adjustment if the adjustment flag is set."
        ),
        "owner": "Ops",
        "owner_reasoning": "Handles operational write of computed values to the account data store.",
        "confidence": 0.82,
        "needs_review": False,
    },
    "OPEN-ACCOUNT": {
        "rule": (
            "Creates a new customer account in pending status after KYC verification, "
            "preventing activation until compliance checks pass."
        ),
        "owner": "Compliance",
        "owner_reasoning": "Account creation is gated by regulatory KYC requirements.",
        "confidence": 0.91,
        "needs_review": False,
    },
    "CLOSE-ACCOUNT": {
        "rule": (
            "Permanently closes an active account after confirming it is not frozen, "
            "recording an audit trail of the closure."
        ),
        "owner": "Ops",
        "owner_reasoning": "Account closure is an operational lifecycle event with audit obligations.",
        "confidence": 0.87,
        "needs_review": False,
    },
    "FREEZE-ACCOUNT": {
        "rule": (
            "Suspends all account activity and notifies the compliance team when "
            "regulatory or risk thresholds are breached."
        ),
        "owner": "Compliance",
        "owner_reasoning": "Account freeze is triggered by compliance or risk threshold violations.",
        "confidence": 0.93,
        "needs_review": False,
    },
    "VALIDATE-KYC": {
        "rule": (
            "Blocks account operations for customers who have not completed identity "
            "verification or who exceed the risk tier threshold."
        ),
        "owner": "Risk",
        "owner_reasoning": "KYC validation enforces risk-based identity verification policy.",
        "confidence": 0.96,
        "needs_review": False,
    },
    "OPEN-ACCOUNT-EXIT": {
        "rule": "Marks the successful completion of account opening workflow after all validations pass.",
        "owner": "Ops",
        "owner_reasoning": "Workflow completion is an operational control step.",
        "confidence": 0.75,
        "needs_review": False,
    },
    "RUN-EOD": {
        "rule": (
            "Orchestrates the full end-of-day processing cycle including interest "
            "calculation, reconciliation, reporting, and downstream notification."
        ),
        "owner": "Ops",
        "owner_reasoning": "End-of-day batch orchestration is a core operational process.",
        "confidence": 0.94,
        "needs_review": False,
    },
    "RECONCILE-TOTALS": {
        "rule": (
            "Verifies that total interest applied across all accounts matches the sum "
            "of individual calculations, flagging any discrepancy for investigation."
        ),
        "owner": "Finance",
        "owner_reasoning": "Reconciliation ensures financial accuracy of posted interest amounts.",
        "confidence": 0.89,
        "needs_review": False,
    },
    "GENERATE-REPORT": {
        "rule": (
            "Produces the daily summary report of account activity and interest applied, "
            "triggering an alert if account volumes exceed operational thresholds."
        ),
        "owner": "Ops",
        "owner_reasoning": "Report generation is an operational deliverable for daily close.",
        "confidence": 0.83,
        "needs_review": False,
    },
    "NOTIFY-DOWNSTREAM": {
        "rule": "Sends end-of-day completion signals to dependent systems once processing is confirmed successful.",
        "owner": "Ops",
        "owner_reasoning": "Downstream notification is an operational integration step.",
        "confidence": 0.78,
        "needs_review": False,
    },
    "RECON-FAILED": {
        "rule": (
            "Records reconciliation failures and increments the error counter without "
            "halting the batch, allowing partial processing to continue."
        ),
        "owner": "Risk",
        "owner_reasoning": "Error recording during reconciliation is a risk management control.",
        "confidence": 0.71,
        "needs_review": True,
    },
}

# Keywords that elevate risk score when found in a chunk name
_HIGH_VALUE_KEYWORDS = frozenset({
    "PAYMENT", "TRANSFER", "INTEREST", "TAX", "COMPLIANCE",
    "REGULATORY", "AUDIT", "RECONCIL", "FREEZE", "KYC", "RISK",
})

# SQL statement patterns for data-edge detection
_SQL_WRITE_RE = re.compile(r"\b(?:INSERT|UPDATE|DELETE)\b", re.IGNORECASE)
_SQL_READ_RE  = re.compile(r"\b(?:SELECT|FROM)\b", re.IGNORECASE)


# ---------------------------------------------------------------------------
# Sub-step 0b helpers
# ---------------------------------------------------------------------------

def _demo_rule(chunk: CodeChunk) -> BusinessRule:
    """Return a hardcoded BusinessRule for DEMO_MODE."""
    name_upper = chunk.name.upper()

    if chunk.language == "sql":
        return BusinessRule(
            id=f"rule_{chunk.id}",
            chunk_id=chunk.id,
            rule=f"Stores {chunk.name} records for the core banking system.",
            confidence=0.80,
            owner="Engineering",
            owner_reasoning="SQL table definitions are owned by engineering as data infrastructure.",
        )

    stub = _DEMO_RULES.get(name_upper)
    if stub:
        return BusinessRule(
            id=f"rule_{chunk.id}",
            chunk_id=chunk.id,
            rule=stub["rule"],
            confidence=stub["confidence"],
            owner=stub["owner"],
            owner_reasoning=stub.get("owner_reasoning", ""),
            needs_review=stub.get("needs_review", False),
        )

    return BusinessRule(
        id=f"rule_{chunk.id}",
        chunk_id=chunk.id,
        rule="Business rule unclear — manual review required.",
        confidence=0.40,
        owner="Unknown",
        owner_reasoning="Could not determine business domain from chunk name or content.",
        needs_review=True,
    )


def _strip_fences(text: str) -> str:
    """Remove accidental markdown code fences before JSON parsing."""
    text = text.strip()
    if not text.startswith("```"):
        return text
    lines = text.split("\n")
    inner: list[str] = []
    in_block = False
    for line in lines:
        if not in_block:
            if line.startswith("```"):
                in_block = True
            continue
        if line.strip() == "```":
            break
        inner.append(line)
    return "\n".join(inner)


async def _extract_rule(
    client: LLMClient,
    sem: asyncio.Semaphore,
    chunk: CodeChunk,
) -> BusinessRule:
    """Call the LLM to extract a single BusinessRule. Never raises."""
    async with sem:
        try:
            content = await client.complete(
                system=_SYSTEM_PROMPT,
                user=_build_user_prompt(chunk),
                temperature=0.2,
                json_response=True,
            )

            parsed = json.loads(_strip_fences(content))

            raw_conf = float(parsed.get("confidence", 0.5))
            confidence = max(0.0, min(1.0, raw_conf))
            owner = str(parsed.get("owner", "Unknown"))
            needs_review = confidence < 0.5 or owner == "Unknown"

            return BusinessRule(
                id=f"rule_{chunk.id}",
                chunk_id=chunk.id,
                rule=str(parsed["rule"]),
                confidence=confidence,
                owner=owner,
                owner_reasoning=str(parsed.get("owner_reasoning", "")),
                key_variables=list(parsed.get("key_variables", [])),
                depends_on=list(parsed.get("depends_on", [])),
                needs_review=needs_review,
                extraction_error=None,
            )

        except Exception as exc:
            logger.error(
                "Layer0 0b: extraction failed for %s (%s): %s",
                chunk.id, type(exc).__name__, exc,
            )
            return BusinessRule(
                id=f"rule_{chunk.id}",
                chunk_id=chunk.id,
                rule="Extraction failed — manual review required",
                confidence=0.0,
                owner="Unknown",
                owner_reasoning="",
                needs_review=True,
                extraction_error=str(exc),
            )


# ---------------------------------------------------------------------------
# Sub-step 0c helpers — SQL data-edge detection
# ---------------------------------------------------------------------------

def _sql_data_edges(
    chunk: CodeChunk,
    sql_table_by_name: dict[str, tuple[str, str]],
) -> list[tuple[str, str, str]]:
    """
    Scan a COBOL/Java chunk's source for SQL table references.

    Returns list of (source_chunk_id, target_node_id, edge_type) where
    edge_type is "data_read" or "data_write".
    """
    if chunk.language not in ("cobol", "java"):
        return []

    src_upper = chunk.source.upper()
    seen: set[tuple[str, str]] = set()
    result: list[tuple[str, str, str]] = []

    for table_upper, (node_id, _fn) in sql_table_by_name.items():
        search_pos = 0
        while True:
            idx = src_upper.find(table_upper, search_pos)
            if idx == -1:
                break

            # Look at up to 80 characters before the table name for SQL verb
            context = src_upper[max(0, idx - 80):idx]

            if _SQL_WRITE_RE.search(context):
                etype = "data_write"
            elif _SQL_READ_RE.search(context):
                etype = "data_read"
            else:
                search_pos = idx + 1
                continue

            key = (chunk.id, node_id)
            if key not in seen:
                seen.add(key)
                result.append((chunk.id, node_id, etype))
            break  # one edge per (chunk, table) pair

    return result


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

async def run(project: Project) -> Layer0Result:
    """
    Run the full Layer 0 Code Archaeology pipeline.

    Sub-steps:
      0a — structural scan (code_parser)
      0b — business rule extraction (Venice AI or DEMO_MODE stubs)
      0c — dependency graph construction
      0d — deterministic risk scoring

    Stores serialized results in project.layer0_rules and project.layer0_graph
    for the REST API. Emits layer0_complete WebSocket event.
    Always returns a Layer0Result — partial on failure.
    """
    # ------------------------------------------------------------------ 0a
    parsed_files: list[ParsedFile] = []
    chunk_by_id: dict[str, CodeChunk] = {}
    chunk_by_name: dict[str, CodeChunk] = {}  # name.upper() → chunk

    try:
        for uf in project.files:
            pf = parse_file(uf.filename, uf.content)
            parsed_files.append(pf)
            for chunk in pf.chunks:
                chunk_by_id[chunk.id] = chunk
                chunk_by_name[chunk.name.upper()] = chunk

        total_chunks = sum(len(pf.chunks) for pf in parsed_files)
        logger.info(
            "Layer0 0a: parsed %d files, %d chunks total",
            len(parsed_files),
            total_chunks,
        )
    except Exception as exc:
        logger.error("Layer0 0a failed: %s", exc, exc_info=True)

    all_chunks: list[CodeChunk] = [
        chunk for pf in parsed_files for chunk in pf.chunks
    ]

    # ------------------------------------------------------------------ 0b
    business_rules: list[BusinessRule] = []

    try:
        llm_client = LLMClient()

        if llm_client.demo_mode:
            business_rules = [_demo_rule(chunk) for chunk in all_chunks]
        elif not llm_client.is_configured():
            # Fail fast and honestly instead of firing N doomed LLM calls
            # (each of which would raise and get caught below anyway).
            logger.error(
                "Layer0 0b: LLM not configured — skipping business rule "
                "extraction for %d chunk(s)",
                len(all_chunks),
            )
            business_rules = [
                BusinessRule(
                    id=f"rule_{chunk.id}",
                    chunk_id=chunk.id,
                    rule="Business rule extraction unavailable — LLM is not configured",
                    confidence=0.0,
                    owner="Unknown",
                    owner_reasoning="",
                    needs_review=True,
                    extraction_error="LLM not configured",
                )
                for chunk in all_chunks
            ]
        else:
            sem = asyncio.Semaphore(5)
            tasks = [
                _extract_rule(llm_client, sem, chunk)
                for chunk in all_chunks
            ]
            business_rules = list(await asyncio.gather(*tasks))

        needs_review_count = sum(1 for r in business_rules if r.needs_review)
        logger.info(
            "Layer0 0b: %d rules extracted, %d flagged for review",
            len(business_rules),
            needs_review_count,
        )
    except Exception as exc:
        logger.error("Layer0 0b failed: %s", exc, exc_info=True)
        business_rules = [
            BusinessRule(
                id=f"rule_{chunk.id}",
                chunk_id=chunk.id,
                rule="Extraction failed — manual review required",
                confidence=0.0,
                owner="Unknown",
                owner_reasoning="",
                needs_review=True,
                extraction_error=str(exc),
            )
            for chunk in all_chunks
        ]

    rule_by_chunk_id: dict[str, BusinessRule] = {
        r.chunk_id: r for r in business_rules
    }

    # ------------------------------------------------------------------ 0c
    dependency_graph = DependencyGraph()

    try:
        # Build SQL table lookup: TABLE_NAME.upper() → (chunk_id, filename)
        sql_table_by_name: dict[str, tuple[str, str]] = {}
        for pf in parsed_files:
            if pf.language == "sql":
                for chunk in pf.chunks:
                    sql_table_by_name[chunk.name.upper()] = (chunk.id, pf.filename)

        # NODES — one per CodeChunk
        node_ids: set[str] = set()
        # Map chunk_id → node index for later mutation (risk scoring)
        node_index: dict[str, int] = {}

        for pf in parsed_files:
            for chunk in pf.chunks:
                idx = len(dependency_graph.nodes)
                dependency_graph.nodes.append(GraphNode(
                    id=chunk.id,
                    label=chunk.name,
                    filename=pf.filename,
                    language=chunk.language,
                ))
                node_ids.add(chunk.id)
                node_index[chunk.id] = idx

        # EDGES — deduplicated by (source, target)
        seen_edges: set[tuple[str, str]] = set()

        def _add_edge(source_id: str, callee_name: str, etype: str = "call") -> None:
            resolved = chunk_by_name.get(callee_name.upper())
            target = resolved.id if resolved else callee_name
            final_type = etype if resolved else "unknown"
            key = (source_id, target)
            if key not in seen_edges:
                seen_edges.add(key)
                dependency_graph.edges.append(GraphEdge(
                    source=source_id,
                    target=target,
                    edge_type=final_type,
                ))

        # Source 1: parser call edges (caller_id, callee_name)
        for pf in parsed_files:
            for caller_id, callee_name in pf.dependencies:
                _add_edge(caller_id, callee_name, "call")

        # Source 2: LLM depends_on names
        for rule in business_rules:
            for dep_name in rule.depends_on:
                _add_edge(rule.chunk_id, dep_name, "call")

        # Source 3: SQL data edges from COBOL/Java chunk sources
        sql_nodes_seen: set[str] = set()
        for pf in parsed_files:
            for chunk in pf.chunks:
                for src_id, tgt_id, etype in _sql_data_edges(chunk, sql_table_by_name):
                    key = (src_id, tgt_id)
                    if key not in seen_edges:
                        seen_edges.add(key)
                        dependency_graph.edges.append(GraphEdge(
                            source=src_id,
                            target=tgt_id,
                            edge_type=etype,
                        ))

                    # Add synthetic SQL node if the table isn't already a node
                    if tgt_id not in node_ids and tgt_id not in sql_nodes_seen:
                        # Find which SQL file this table came from
                        sql_filename = ""
                        for name_upper, (nid, fn) in sql_table_by_name.items():
                            if nid == tgt_id:
                                sql_filename = fn
                                break
                        table_label = tgt_id.split("__table_")[-1].upper() \
                            if "__table_" in tgt_id else tgt_id.upper()
                        idx = len(dependency_graph.nodes)
                        dependency_graph.nodes.append(GraphNode(
                            id=tgt_id,
                            label=table_label,
                            filename=sql_filename,
                            language="sql",
                        ))
                        node_ids.add(tgt_id)
                        node_index[tgt_id] = idx
                        sql_nodes_seen.add(tgt_id)

        logger.info(
            "Layer0 0c: %d nodes, %d edges",
            len(dependency_graph.nodes),
            len(dependency_graph.edges),
        )
    except Exception as exc:
        logger.error("Layer0 0c failed: %s", exc, exc_info=True)

    # ------------------------------------------------------------------ 0d
    chunks: list[MigrationChunk] = []
    risk_summary: dict[str, int] = {"Low": 0, "Medium": 0, "High": 0, "Critical": 0}

    try:
        # Compute fan-out and fan-in from the edge list
        fan_out: dict[str, int] = {n.id: 0 for n in dependency_graph.nodes}
        fan_in:  dict[str, int] = {n.id: 0 for n in dependency_graph.nodes}
        for edge in dependency_graph.edges:
            fan_out[edge.source] = fan_out.get(edge.source, 0) + 1
            fan_in[edge.target]  = fan_in.get(edge.target, 0) + 1

        # Chunks that have at least one outgoing data edge to a SQL node
        sql_node_ids = {n.id for n in dependency_graph.nodes if n.language == "sql"}
        chunks_with_data_edges = {
            e.source
            for e in dependency_graph.edges
            if e.target in sql_node_ids
            and e.edge_type in ("data_read", "data_write")
        }

        for pf in parsed_files:
            for chunk in pf.chunks:
                rule = rule_by_chunk_id.get(chunk.id)
                score = 0

                if fan_out.get(chunk.id, 0) >= 5:
                    score += 2
                if fan_in.get(chunk.id, 0) >= 5:
                    score += 2

                name_upper = chunk.name.upper()
                if any(kw in name_upper for kw in _HIGH_VALUE_KEYWORDS):
                    score += 3

                if chunk.id in chunks_with_data_edges:
                    score += 1

                if len(chunk.source.splitlines()) > 200:
                    score += 1

                if rule:
                    if rule.confidence < 0.6:
                        score += 2
                    if rule.needs_review:
                        score += 1

                if score <= 1:
                    risk_level = "Low"
                elif score <= 3:
                    risk_level = "Medium"
                elif score <= 5:
                    risk_level = "High"
                else:
                    risk_level = "Critical"

                risk_summary[risk_level] = risk_summary.get(risk_level, 0) + 1

                # Back-fill GraphNode risk fields
                nidx = node_index.get(chunk.id)
                if nidx is not None:
                    dependency_graph.nodes[nidx].risk_level = risk_level
                    dependency_graph.nodes[nidx].risk_score = score

                chunks.append(MigrationChunk(
                    id=chunk.id,
                    name=chunk.name,
                    filename=pf.filename,
                    language=chunk.language,
                    source=chunk.source,
                    start_line=chunk.start_line,
                    end_line=chunk.end_line,
                    business_rule=rule,
                    risk_level=risk_level,
                    risk_score=score,
                ))

        # Persist per-file aggregated risk scores on the project
        file_risk: dict[str, float] = {}
        for pf in parsed_files:
            file_chunks = [c for c in chunks if c.filename == pf.filename]
            if file_chunks:
                max_score = max(c.risk_score for c in file_chunks)
                file_risk[pf.filename] = round(min(max_score / 10.0, 1.0), 3)
        project.risk_scores = file_risk

        logger.info("Layer0 0d: risk summary %s", risk_summary)
    except Exception as exc:
        logger.error("Layer0 0d failed: %s", exc, exc_info=True)

    # ------------------------------------------------------------------
    # Persist results on project for REST API
    # ------------------------------------------------------------------
    try:
        project.layer0_rules = [dataclasses.asdict(r) for r in business_rules]
        project.layer0_graph = {
            "nodes": [dataclasses.asdict(n) for n in dependency_graph.nodes],
            "edges": [dataclasses.asdict(e) for e in dependency_graph.edges],
        }
    except Exception as exc:
        logger.error("Layer0 result persistence failed: %s", exc)

    # ------------------------------------------------------------------
    # Persist durable overlay records
    # ------------------------------------------------------------------
    try:
        from db.repositories import persist_layer0_analysis  # noqa: PLC0415
        from db.session import get_session, init_db  # noqa: PLC0415

        await init_db()
        async with get_session() as session:
            summary = await persist_layer0_analysis(
                session,
                project,
                chunks,
                business_rules,
            )
        logger.info(
            "Layer0 DB persistence: repo=%s commit=%s chunks=%d criteria=%d",
            summary.repository_id,
            summary.commit_sha,
            summary.chunk_count,
            summary.criterion_count,
        )
    except Exception as exc:
        logger.error("Layer0 DB persistence failed: %s", exc, exc_info=True)

    # ------------------------------------------------------------------
    # WebSocket event
    # ------------------------------------------------------------------
    try:
        from api.websocket_manager import manager as ws_manager  # noqa: PLC0415
        needs_review_count = sum(1 for r in business_rules if r.needs_review)
        await ws_manager.emit(
            project.id,
            "layer0_complete",
            project_id=project.id,
            chunk_count=len(chunks),
            rules_extracted=len(business_rules),
            needs_review_count=needs_review_count,
            risk_summary=risk_summary,
        )
    except Exception as exc:
        logger.error("Layer0 WebSocket emit failed: %s", exc)

    return Layer0Result(
        parsed_files=parsed_files,
        business_rules=business_rules,
        dependency_graph=dependency_graph,
        chunks=chunks,
    )
