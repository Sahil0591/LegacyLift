"""
api/websocket_manager.py — WebSocket connection registry and event broadcaster.

This module is the real-time communication backbone of LegacyLift.
Every pipeline stage emits structured JSON events through this manager, which
broadcasts them to all connected frontend clients for that project.

Architecture:
  - One WebSocketManager instance per application (singleton via FastAPI lifespan)
  - Connections are keyed by project_id so events are project-scoped
  - Events are fire-and-forget: if a client disconnects mid-stream, the manager
    removes it and the pipeline continues unaffected

Event format (all events follow this structure):
  {
    "event":      "<event_name>",    # string, see event catalogue below
    "project_id": "<proj-xxx>",      # which project this event belongs to
    "timestamp":  "<ISO 8601>",      # server time of emission
    "<payload>":  <data>             # event-specific fields (see catalogue)
  }

Event catalogue — Layer 0:
  archaeology_started        — pipeline began Layer 0
  archaeology_complete       — Layer 0 done, findings: dict
  business_rule_found        — rule: BusinessRule dict
  dependency_graph_ready     — graph: adjacency dict
  risk_scores_ready          — scores: {filename: float}

Event catalogue — Layer 0.5:
  docs_fetching              — url: str
  docs_fetched               — fetched_at: ISO timestamp
  target_profile_ready       — profile: dict

Event catalogue — Migration (Layers 1-3):
  chunk_started              — chunk_id: str, name: str
  static_analysis_complete   — passed: bool, issues: list[str]
  ai_review_complete         — issues_found: int
  tests_running              — total: int
  test_result                — name: str, passed: bool
  tests_complete             — passed: int, failed: int
  chunk_ready_for_approval   — diff: str, chunk_id: str
  chunk_approved             — chunk_id: str
  migration_complete         — report: dict

Error events:
  error                      — layer: str, message: str, recoverable: bool

Usage (from pipeline.py):
    from api.websocket_manager import manager
    await manager.emit(project_id, "business_rule_found", rule=rule.dict())
"""

from __future__ import annotations

import asyncio
import json
import os
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect
from rich.console import Console

console = Console()
DEMO_MODE = os.getenv("DEMO_MODE", "true").lower() == "true"


class WebSocketManager:
    """
    Manages all active WebSocket connections across projects.

    Thread-safety note: FastAPI runs on asyncio; all WebSocket sends are
    async.  This manager is NOT thread-safe for use with threads — if you
    add background threads, wrap emit() calls in asyncio.run_coroutine_threadsafe().
    """

    def __init__(self) -> None:
        # project_id -> list of active WebSocket connections
        self._connections: dict[str, list[WebSocket]] = defaultdict(list)
        # project_id -> chronological list of all emitted events (for replay)
        self._event_log: dict[str, list[dict]] = defaultdict(list)

    # -----------------------------------------------------------------------
    # Connection lifecycle
    # -----------------------------------------------------------------------

    async def connect(self, project_id: str, websocket: WebSocket) -> None:
        """
        Accept a new WebSocket connection and register it.

        Called by the /ws/{project_id} endpoint in main.py on each new
        client connection.

        Args:
            project_id: The project this client is subscribing to.
            websocket:  The FastAPI WebSocket object.

        TODO (implementer): add authentication check here before accepting.
        Use websocket.headers.get("Authorization") to validate a JWT.
        Reject with websocket.close(code=4001) if invalid.
        """
        await websocket.accept()
        self._connections[project_id].append(websocket)

        if DEMO_MODE:
            console.print(
                f"[green]WebSocket:[/green] client connected to project {project_id} "
                f"(total: {len(self._connections[project_id])})"
            )

        # Replay past events to newly connected client so they get full state
        for past_event in self._event_log[project_id]:
            try:
                await websocket.send_text(json.dumps(past_event))
            except Exception:
                break

    async def disconnect(self, project_id: str, websocket: WebSocket) -> None:
        """
        Remove a disconnected WebSocket from the registry.

        Called automatically in the finally block of the /ws/{project_id}
        endpoint handler in main.py.

        Args:
            project_id: Project the client was subscribed to.
            websocket:  The disconnecting WebSocket.
        """
        connections = self._connections.get(project_id, [])
        if websocket in connections:
            connections.remove(websocket)

        if DEMO_MODE:
            console.print(
                f"[yellow]WebSocket:[/yellow] client disconnected from project {project_id} "
                f"(remaining: {len(connections)})"
            )

    # -----------------------------------------------------------------------
    # Event emission
    # -----------------------------------------------------------------------

    async def emit(
        self,
        project_id: str,
        event: str,
        **payload: Any,
    ) -> None:
        """
        Broadcast a structured event to all clients subscribed to a project.

        This is the primary method called by pipeline.py and all layer modules.

        Args:
            project_id: Scope the event to this project's subscribers.
            event:      Event name string (e.g. 'business_rule_found').
            **payload:  Arbitrary key-value pairs added to the event body.
                        Values must be JSON-serialisable.

        Example:
            await manager.emit(
                project_id,
                "business_rule_found",
                rule={"id": "BR-001", "title": "..."}
            )

        TODO (implementer): add event schema validation against the catalogue
        above so malformed events fail fast during development.
        """
        message = {
            "event":      event,
            "project_id": project_id,
            "timestamp":  datetime.now(timezone.utc).isoformat(),
            **payload,
        }

        # Store in event log for replay
        self._event_log[project_id].append(message)

        # Console log in demo mode
        if DEMO_MODE:
            console.print(
                f"[bold cyan]WS EVENT[/bold cyan] [{project_id}] "
                f"[yellow]{event}[/yellow]  "
                + (f"payload keys: {list(payload.keys())}" if payload else "")
            )

        # Broadcast to all connected clients, removing dead connections
        message_text = json.dumps(message, default=str)
        dead: list[WebSocket] = []

        for ws in list(self._connections.get(project_id, [])):
            try:
                await ws.send_text(message_text)
            except Exception:
                dead.append(ws)

        for ws in dead:
            await self.disconnect(project_id, ws)

    async def emit_error(
        self,
        project_id: str,
        layer: str,
        message: str,
        recoverable: bool = True,
    ) -> None:
        """
        Broadcast a standardised error event.

        Convenience wrapper around emit() for the error event type.
        Called by pipeline.py inside every except block.

        Args:
            project_id:  Affected project.
            layer:       Which pipeline layer raised the error.
            message:     Human-readable error description.
            recoverable: True if the pipeline can continue, False if it halted.
        """
        await self.emit(
            project_id,
            "error",
            layer=layer,
            message=message,
            recoverable=recoverable,
        )

    # -----------------------------------------------------------------------
    # Introspection helpers (for testing and debugging)
    # -----------------------------------------------------------------------

    def get_connection_count(self, project_id: str) -> int:
        """Return number of active connections for a project."""
        return len(self._connections.get(project_id, []))

    def get_event_log(self, project_id: str) -> list[dict]:
        """Return the full event history for a project (useful in tests)."""
        return list(self._event_log.get(project_id, []))

    def clear_event_log(self, project_id: str) -> None:
        """
        Clear stored events for a project.

        TODO (implementer): call this when a project is deleted via
        DELETE /api/project/{id} to free memory.
        """
        self._event_log.pop(project_id, None)


# ---------------------------------------------------------------------------
# Application-level singleton
# ---------------------------------------------------------------------------

# Import this instance everywhere instead of creating new ones:
#   from api.websocket_manager import manager
manager = WebSocketManager()
