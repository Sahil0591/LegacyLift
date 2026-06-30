"""
smoke_test.py — Standalone end-to-end smoke test for the LegacyLift API.

Runs against a live server (default http://localhost:8000) and exercises the
full demo pipeline: create project, upload demo COBOL/SQL files, start the
pipeline, watch WebSocket events, poll status, validate rules and graph, and
approve a chunk.

Requires DEMO_MODE=true on the server so Layer 0 returns the hardcoded
business-rule stubs instead of calling a real LLM.

Usage:
    python smoke_test.py

Exit code 0 on success, 1 on any failure.
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

import aiohttp
import websockets

if sys.stdout.encoding is None or sys.stdout.encoding.lower() != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")

BASE_URL = "http://localhost:8000"
WS_URL = "ws://localhost:8000"
DEMO_DIR = Path(__file__).parent / "demo"
DEMO_FILENAMES = [
    "interest_calc.cbl",
    "account_master.cbl",
    "end_of_day_batch.cbl",
    "legacy_bank.sql",
]
WS_TIMEOUT_SECONDS = 30
VALID_OWNERS = {"Finance", "Compliance", "Ops", "Risk", "Engineering", "Product", "Unknown"}
VALID_RISK_LEVELS = {"Low", "Medium", "High", "Critical"}


def fail(step: int, description: str, actual) -> None:
    print(f"\n✗ FAILED at step {step}: {description}")
    print(f"  Actual response: {actual}")
    sys.exit(1)


def find_demo_file(filename: str) -> Path:
    matches = list(DEMO_DIR.rglob(filename))
    if not matches:
        fail(3, f"locate demo file {filename} under {DEMO_DIR}", "file not found")
    return matches[0]


async def ws_listener(project_id: str, events: list[dict], stop_event: asyncio.Event) -> None:
    """Connect to /ws/{project_id} and collect events until analysis_complete or timeout."""
    uri = f"{WS_URL}/ws/{project_id}"
    async with websockets.connect(uri) as ws:
        try:
            while True:
                raw = await asyncio.wait_for(ws.recv(), timeout=WS_TIMEOUT_SECONDS)
                event = json.loads(raw)
                events.append(event)
                if event.get("event") in ("analysis_complete", "pipeline_failed"):
                    break
        finally:
            stop_event.set()


async def main() -> None:
    async with aiohttp.ClientSession() as session:

        # --- Step 1: Health check ---
        print("[1/10] Health check...")
        async with session.get(f"{BASE_URL}/health") as resp:
            body = await resp.json()
            if resp.status != 200 or body.get("status") != "ok":
                fail(1, "GET /health should return status=ok", body)
        print(f"  OK — {body}")

        # --- Step 2: Create project ---
        print("[2/10] Create project...")
        async with session.post(f"{BASE_URL}/project", json={"name": "Smoke Test"}) as resp:
            body = await resp.json()
            if resp.status != 201 or "id" not in body:
                fail(2, "POST /project should return 201 with an id", body)
            project_id = body["id"]
        print(f"  OK — project_id={project_id}")

        # --- Step 3: Upload 4 demo files ---
        print("[3/10] Upload demo files...")
        form = aiohttp.FormData()
        for filename in DEMO_FILENAMES:
            path = find_demo_file(filename)
            form.add_field("files", path.read_bytes(), filename=filename, content_type="text/plain")
        async with session.post(f"{BASE_URL}/project/{project_id}/upload", data=form) as resp:
            body = await resp.json()
            if resp.status != 200 or body.get("file_count") != 4:
                fail(3, "POST /upload should return 200 with file_count=4", body)
        print(f"  OK — {body}")

        # --- Step 4-6: Connect WebSocket, start pipeline, wait for events ---
        print("[4/10] Connect WebSocket before starting pipeline...")
        events: list[dict] = []
        stop_event = asyncio.Event()
        listener_task = asyncio.create_task(ws_listener(project_id, events, stop_event))
        await asyncio.sleep(1.0)  # let the WS connection establish

        print("[5/10] Start pipeline...")
        async with session.post(f"{BASE_URL}/project/{project_id}/start") as resp:
            body = await resp.json()
            if resp.status != 202 or body.get("status") != "accepted":
                fail(5, "POST /start should return 202 with status=accepted", body)
        print(f"  OK — {body}")

        print("[6/10] Wait for WebSocket events...")
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=WS_TIMEOUT_SECONDS)
        except asyncio.TimeoutError:
            fail(6, f"WebSocket events not received within {WS_TIMEOUT_SECONDS}s", events)
        listener_task.cancel()

        event_names = [e.get("event") for e in events]
        for required in ("pipeline_started", "layer0_complete", "analysis_complete"):
            if required not in event_names:
                fail(6, f"expected WS event '{required}' to be emitted", event_names)

        idx_started = event_names.index("pipeline_started")
        idx_layer0 = event_names.index("layer0_complete")
        idx_complete = event_names.index("analysis_complete")
        if not (idx_started < idx_layer0 < idx_complete):
            fail(6, "WS events out of order (expected pipeline_started < layer0_complete < analysis_complete)", event_names)

        layer0_event = events[idx_layer0]
        if layer0_event.get("chunk_count", 0) < 10:
            fail(6, "layer0_complete.chunk_count should be >= 10", layer0_event)

        complete_event = events[idx_complete]
        if complete_event.get("status") != "ready":
            fail(6, "analysis_complete.status should be 'ready'", complete_event)
        print(f"  OK — received {len(events)} events in order: {event_names}")

        # --- Step 7: Poll status ---
        print("[7/10] Poll status...")
        async with session.get(f"{BASE_URL}/project/{project_id}/status") as resp:
            status_body = await resp.json()
            if resp.status != 200 or status_body.get("status") != "ready":
                fail(7, "GET /status should return status=ready", status_body)
            if status_body.get("chunk_count", 0) < 10:
                fail(7, "status.chunk_count should be >= 10", status_body)
            risk_summary = status_body.get("risk_summary", {})
            for level in VALID_RISK_LEVELS:
                if level not in risk_summary:
                    fail(7, f"status.risk_summary missing key '{level}'", status_body)
        print(f"  OK — chunk_count={status_body['chunk_count']}, risk_summary={risk_summary}")

        # --- Step 8: Validate rules ---
        print("[8/10] Validate rules...")
        async with session.get(f"{BASE_URL}/project/{project_id}/rules") as resp:
            rules_body = await resp.json()
            if resp.status != 200 or rules_body.get("rule_count", 0) < 10:
                fail(8, "GET /rules should return rule_count >= 10", rules_body)
            rules = rules_body.get("rules", [])
            owners_seen = set()
            for rule in rules:
                for field in ("chunk_id", "owner", "confidence"):
                    if field not in rule:
                        fail(8, f"rule missing required field '{field}'", rule)
                if rule["owner"] not in VALID_OWNERS:
                    fail(8, f"rule has invalid owner '{rule['owner']}'", rule)
                owners_seen.add(rule["owner"])
            if "Finance" not in owners_seen or "Compliance" not in owners_seen:
                fail(8, "expected at least one Finance and one Compliance rule owner", owners_seen)
        print(f"  OK — rule_count={rules_body['rule_count']}, owners={owners_seen}")
        print("  First 3 rules:")
        for rule in rules[:3]:
            print(f"    - {rule.get('chunk_id')} ({rule.get('owner')}, confidence={rule.get('confidence')})")

        # --- Step 9: Validate graph ---
        print("[9/10] Validate graph...")
        async with session.get(f"{BASE_URL}/project/{project_id}/graph") as resp:
            graph_body = await resp.json()
            if resp.status != 200 or graph_body.get("node_count", 0) < 10:
                fail(9, "GET /graph should return node_count >= 10", graph_body)
            if graph_body.get("edge_count", 0) < 5:
                fail(9, "GET /graph should return edge_count >= 5", graph_body)
            nodes = graph_body.get("nodes", [])
            for node in nodes:
                for field in ("id", "risk_level"):
                    if field not in node:
                        fail(9, f"graph node missing required field '{field}'", node)
                if node["risk_level"] not in VALID_RISK_LEVELS:
                    fail(9, f"graph node has invalid risk_level '{node['risk_level']}'", node)

            max_score = max(n.get("risk_score", 0) for n in nodes)
            tied_nodes = [n for n in nodes if n.get("risk_score", 0) == max_score]
            target_substrings = ("RUN-EOD", "EODBATCH", "RECONCILE")
            if not any(
                any(s in n.get("label", "").upper() for s in target_substrings)
                for n in tied_nodes
            ):
                fail(
                    9,
                    "expected the highest-risk node(s) to include RUN-EOD/EODBATCH/RECONCILE",
                    tied_nodes,
                )
            highest_node = tied_nodes[0]
        print(f"  OK — node_count={graph_body['node_count']}, edge_count={graph_body['edge_count']}")
        print(f"  Highest risk node: {highest_node.get('label')} (score={max_score}, level={highest_node.get('risk_level')})")

        # --- Step 10: Approve one chunk ---
        print("[10/10] Approve one chunk...")
        chunk_id = rules[0]["chunk_id"]
        async with session.post(
            f"{BASE_URL}/project/{project_id}/approve/{chunk_id}",
            json={"comment": "smoke test approval"},
        ) as resp:
            approve_body = await resp.json()
            if resp.status != 200 or approve_body.get("decision") != "approved":
                fail(10, "POST /approve should return 200 with decision=approved", approve_body)
        print(f"  OK — {approve_body}")

    print("\n" + "=" * 60)
    print("  ALL SMOKE TESTS PASSED")
    print("=" * 60)
    sys.exit(0)


if __name__ == "__main__":
    asyncio.run(main())
