"""
core/migration/target_api.py — Builds the "ALREADY-MIGRATED TARGET API" block:
a compact, deterministic contract of the target code that has ALREADY been
generated for the units this chunk depends on (and its same-file siblings), so
the model calls the real generated names/signatures instead of inventing new
ones. This is the generated-side half of cross-chunk context (the source-side
half is the DIRECT DEPENDENCIES block built from related chunks' legacy source).

Server twin of client/lib/targetApi.ts. Never raises.
"""

from __future__ import annotations

from pathlib import PurePosixPath
from typing import Callable, Optional

from core.target_languages import get_target_language
from utils.symbol_index import extract_exports

# Keep the block well under the migrate request's manifest-style budget.
_MAX_CHARS = 9_000
_MAX_DEP_SOURCE_CHARS = 12_000


def render_dependency_source(
    dep_units: list[dict],
    *,
    max_chars: int = _MAX_DEP_SOURCE_CHARS,
) -> str:
    """Render the legacy SOURCE of the units this chunk calls (+ their rule) for
    the DIRECT DEPENDENCIES block. `dep_units` items: {name, source, rule}."""
    blocks: list[str] = []
    for unit in dep_units or []:
        source = (unit.get("source") or "").strip()
        if not source:
            continue
        parts = [f"--- {unit.get('name', '')} ---"]
        rule = (unit.get("rule") or "").strip()
        if rule:
            parts.append(f"rule: {rule}")
        parts.append(source)
        candidate = "\n".join(parts)
        if blocks and sum(len(b) + 2 for b in blocks) + len(candidate) > max_chars:
            break
        blocks.append(candidate)
    return "\n\n".join(blocks)


def _module_name(filename: str, language: str) -> str:
    """`interest_calc.cbl` + Python → `interest_calc.py`."""
    stem = PurePosixPath(filename or "").stem or "module"
    ext = get_target_language(language).extension
    return f"{stem}{ext}"


def build_target_api(
    project,
    chunk_id: str,
    resolve_language: Callable[[str], str],
    *,
    max_chars: int = _MAX_CHARS,
) -> str:
    """Render the already-generated target API relevant to `chunk_id`.

    Args:
        project: the live Project (reads layer0_chunks, layer0_graph,
            chunk_migrations, current_migration, chunk_approvals).
        chunk_id: the chunk about to be migrated.
        resolve_language: filename → target language name (e.g. per-file target).
    """
    layer0_chunks = getattr(project, "layer0_chunks", None) or []
    chunk_by_id: dict[str, dict] = {c.get("id"): c for c in layer0_chunks if c.get("id")}
    current = chunk_by_id.get(chunk_id)
    if current is None:
        return ""

    current_file = current.get("filename", "")

    # Generated code per chunk: approved store first, then the latest (draft) run.
    migrations: dict[str, str] = dict(getattr(project, "chunk_migrations", None) or {})
    current_migration = getattr(project, "current_migration", None) or {}
    if isinstance(current_migration, dict):
        cm_id = current_migration.get("chunk_id")
        cm_code = current_migration.get("migrated_code") or ""
        if cm_id and cm_id != chunk_id and cm_code.strip() and cm_id not in migrations:
            migrations[cm_id] = cm_code  # a generated-but-unapproved neighbour

    approvals: dict[str, str] = dict(getattr(project, "chunk_approvals", None) or {})

    # ── relevance ranking ──────────────────────────────────────────────────
    dependency_ids = _direct_dependency_ids(project, chunk_id, set(chunk_by_id))
    sibling_ids = [
        cid for cid, c in chunk_by_id.items()
        if cid != chunk_id and c.get("filename", "") == current_file
    ]

    ordered_ids: list[str] = []
    seen: set[str] = {chunk_id}
    for group in (dependency_ids, sibling_ids, list(chunk_by_id)):
        for cid in group:
            if cid not in seen and (migrations.get(cid) or "").strip():
                ordered_ids.append(cid)
                seen.add(cid)

    # ── render ─────────────────────────────────────────────────────────────
    lines: list[str] = []
    for cid in ordered_ids:
        chunk = chunk_by_id[cid]
        code = migrations.get(cid, "")
        filename = chunk.get("filename", "")
        language = resolve_language(filename) if filename else resolve_language(current_file)
        surface = extract_exports(code, language)
        if surface.is_empty():
            continue

        status = "approved" if approvals.get(cid) == "approved" else "draft"
        header = f"- {chunk.get('name', cid)}  →  {_module_name(filename, language)}  [{status}]"
        block = [header, *surface.as_lines()]
        candidate = "\n".join(block)

        if lines and sum(len(x) + 1 for x in lines) + len(candidate) > max_chars:
            break
        lines.append(candidate)

    return "\n".join(lines)


def _direct_dependency_ids(project, chunk_id: str, id_set: set[str]) -> list[str]:
    """Chunk ids this chunk directly calls (resolved graph `call` edges)."""
    graph = getattr(project, "layer0_graph", None) or {}
    out: list[str] = []
    for edge in graph.get("edges", []) or []:
        if not isinstance(edge, dict):
            continue
        if edge.get("edge_type") in ("data_read", "data_write"):
            continue
        if edge.get("source") == chunk_id:
            tgt = edge.get("target")
            if tgt in id_set and tgt != chunk_id and tgt not in out:
                out.append(tgt)
    return out
