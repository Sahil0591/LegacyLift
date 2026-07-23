"""
core/migration/ordering.py — Dependency-ordered chunk migration.

Legacy programs are graphs of units that PERFORM/CALL one another. Migrating a
caller before its callees means the caller has to *guess* the callee's target
name/signature — the root cause of cross-unit naming drift. This module derives
a migration order in which callees come BEFORE callers, so by the time a caller
is migrated its callees already exist and can be shown to the model as the
ALREADY-MIGRATED TARGET API.

Order is a stable DFS post-order over the "call" dependency edges of
`project.layer0_graph`. It is the server twin of client/lib/migrationOrder.ts.
Never raises — returns a best-effort order, falling back to source order.
"""

from __future__ import annotations

# Edge types that represent data access, not a call dependency. These do not
# constrain migration order (a reader need not be migrated after the table).
_NON_CALL_EDGE_TYPES = frozenset({"data_read", "data_write"})


def compute_migration_order(
    layer0_chunks: list[dict],
    layer0_graph: dict | None,
) -> list[str]:
    """Return chunk ids in dependency order — callees before callers.

    Cycles (recursive/mutual PERFORM) are broken deterministically by visitation
    order; unresolved/external edge targets and data edges are ignored.
    """
    chunk_ids = [c.get("id") for c in layer0_chunks if c.get("id")]
    id_set = set(chunk_ids)
    if not chunk_ids:
        return []

    # Stable sort key: original source position, then id.
    start_by_id: dict[str, int] = {}
    for c in layer0_chunks:
        cid = c.get("id")
        if cid:
            start_by_id[cid] = int(c.get("start_line", 0) or 0)

    def sort_key(cid: str) -> tuple[int, str]:
        return (start_by_id.get(cid, 0), cid)

    # deps[node] = the chunk ids this node depends on (its callees).
    deps: dict[str, set[str]] = {cid: set() for cid in chunk_ids}
    graph = layer0_graph or {}
    for edge in graph.get("edges", []) or []:
        if not isinstance(edge, dict):
            continue
        if edge.get("edge_type") in _NON_CALL_EDGE_TYPES:
            continue
        src = edge.get("source")
        tgt = edge.get("target")
        # Only real chunk→chunk call edges constrain order; skip self-loops and
        # edges to unresolved names / synthetic (e.g. SQL table) nodes.
        if src in id_set and tgt in id_set and src != tgt:
            deps[src].add(tgt)

    order: list[str] = []
    visited: set[str] = set()

    def visit(node: str) -> None:
        if node in visited:
            return
        visited.add(node)
        for dep in sorted(deps.get(node, ()), key=sort_key):
            visit(dep)
        order.append(node)

    for node in sorted(chunk_ids, key=sort_key):
        visit(node)

    return order
