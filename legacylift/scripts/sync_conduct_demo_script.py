#!/usr/bin/env python3
"""
Regenerate auto-synced sections of docs/conduct_demo_script.md from the repo.

Run manually after pulling or merging:
    python legacylift/scripts/sync_conduct_demo_script.py

Git hooks (see legacylift/scripts/install_git_hooks.*) run this after merge/checkout.
"""

from __future__ import annotations

import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
LEGACYLIFT_ROOT = SCRIPT_DIR.parent
REPO_ROOT = LEGACYLIFT_ROOT.parent if (LEGACYLIFT_ROOT.parent / ".git").exists() else LEGACYLIFT_ROOT
DOC_PATH = LEGACYLIFT_ROOT / "docs" / "conduct_demo_script.md"

MARKER_SNAPSHOT_START = "<!-- AUTO-GENERATED:REPO-SNAPSHOT:START -->"
MARKER_SNAPSHOT_END = "<!-- AUTO-GENERATED:REPO-SNAPSHOT:END -->"
MARKER_OVERCLAIMS_START = "<!-- AUTO-GENERATED:OVERCLAIMS:START -->"
MARKER_OVERCLAIMS_END = "<!-- AUTO-GENERATED:OVERCLAIMS:END -->"


def git_short_hash() -> str:
    try:
        out = subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=REPO_ROOT,
            stderr=subprocess.DEVNULL,
            text=True,
        )
        return out.strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return "unknown"


def read_text(path: Path) -> str:
    if not path.is_file():
        return ""
    return path.read_text(encoding="utf-8")


def find_demo_files() -> list[str]:
    demo_root = LEGACYLIFT_ROOT / "server" / "demo"
    files: list[str] = []
    if demo_root.is_dir():
        for path in sorted(demo_root.rglob("*")):
            if path.is_file():
                files.append(str(path.relative_to(LEGACYLIFT_ROOT)).replace("\\", "/"))
    return files


def find_fastapi_routes() -> list[str]:
    main_py = LEGACYLIFT_ROOT / "server" / "api" / "main.py"
    text = read_text(main_py)
    routes: list[str] = []
    for match in re.finditer(
        r'@app\.(get|post|websocket)\(\s*"([^"]+)"',
        text,
    ):
        method, path = match.group(1).upper(), match.group(2)
        if method == "WEBSOCKET":
            method = "WS"
        routes.append(f"{method} {path}")
    return routes


def find_client_api_routes() -> list[str]:
    api_root = LEGACYLIFT_ROOT / "client" / "app" / "api"
    routes: list[str] = []
    if not api_root.is_dir():
        return routes
    for route_file in sorted(api_root.rglob("route.ts")):
        rel = route_file.relative_to(api_root)
        parts = list(rel.parts[:-1])
        segment = "/".join(parts) if parts else ""
        path = f"/api/{segment}" if segment else "/api"
        routes.append(f"POST {path}")
    return routes


def find_ws_events() -> list[str]:
    events: set[str] = set()
    server_root = LEGACYLIFT_ROOT / "server"
    pattern = re.compile(r'emit\([^,]+,\s*"([a-z_0-9]+)"')
    for py_file in server_root.rglob("*.py"):
        for match in pattern.finditer(read_text(py_file)):
            events.add(match.group(1))
    smoke = LEGACYLIFT_ROOT / "server" / "smoke_test.py"
    required: list[str] = []
    for match in re.finditer(r'"([a-z_0-9]+)"', read_text(smoke)):
        name = match.group(1)
        if name in events and name not in required:
            if name in ("pipeline_started", "layer0_complete", "analysis_complete"):
                required.append(name)
    ordered = required + sorted(e for e in events if e not in required)
    return ordered


def pipeline_scope() -> str:
    pipeline_py = LEGACYLIFT_ROOT / "server" / "core" / "pipeline.py"
    text = read_text(pipeline_py)
    match = re.search(
        r"Currently implements (Layer 0 \(Code Archaeology\)[^\n]+)",
        text,
    )
    if match:
        return match.group(1).strip()
    return "Layer 0 (see core/pipeline.py)"


def client_ownership_signals() -> list[str]:
    analyze_ts = read_text(LEGACYLIFT_ROOT / "client" / "lib" / "analyze.ts")
    owners: list[str] = []
    if 'return "Finance"' in analyze_ts:
        owners.append("Finance (money-related signals)")
    if 'return "Risk"' in analyze_ts:
        owners.append("Risk (SQL/table signals)")
    if 'return "Engineering"' in analyze_ts:
        owners.append("Engineering (date/time/format signals)")
    if 'return "Unknown"' in analyze_ts:
        owners.append("Unknown (fallback)")
    return owners


def server_rule_fields() -> list[str]:
    layer0_init = read_text(LEGACYLIFT_ROOT / "server" / "core" / "layer0" / "__init__.py")
    match = re.search(
        r"class BusinessRule:.*?depends_on:.*?needs_review:",
        layer0_init,
        re.DOTALL,
    )
    if not match:
        return ["rule", "owner", "owner_reasoning", "needs_review"]
    fields = re.findall(r"^\s+(\w+):", match.group(0), re.MULTILINE)
    return fields


def replace_block(text: str, start: str, end: str, body: str) -> str:
    pattern = re.compile(re.escape(start) + r".*?" + re.escape(end), re.DOTALL)
    replacement = f"{start}\n{body.rstrip()}\n{end}"
    if not pattern.search(text):
        raise SystemExit(f"Missing markers {start} / {end} in {DOC_PATH}")
    return pattern.sub(replacement, text, count=1)


def build_snapshot_section() -> str:
    demo_files = find_demo_files()
    backend_routes = find_fastapi_routes()
    client_routes = find_client_api_routes()
    ws_events = find_ws_events()
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    commit = git_short_hash()

    demo_list = "\n".join(f"- `{path}`" for path in demo_files) or "- *(none found)*"
    backend_list = "\n".join(f"- `{route}`" for route in backend_routes) or "- *(none found)*"
    client_list = "\n".join(f"- `{route}`" for route in client_routes) or "- *(none found)*"
    ws_list = ", ".join(f"`{event}`" for event in ws_events[:12])
    if len(ws_events) > 12:
        ws_list += f", … (+{len(ws_events) - 12} more)"

    ownership = ", ".join(client_ownership_signals()) or "Unknown"
    rule_fields = ", ".join(f"`{f}`" for f in server_rule_fields())

    return f"""## Repo Snapshot (Auto-Generated)

> Synced from repo at `{commit}` on {now}. Regenerate with `python legacylift/scripts/sync_conduct_demo_script.py`.

### Demo Paths In This Repo

| Path | Role | Best for Conduct demo |
|------|------|------------------------|
| Client workbench | `client/app/demo` → `POST /api/analyze` → `client/app/project/[id]` | **Primary live demo** — upload COBOL/SQL or a public GitHub repo; deterministic Layer 0-style analysis in Next.js; Venice-backed migrate/review via `/api/migrate` and `/api/review` |
| Backend Layer 0 API | `POST /project` → upload → start → WebSocket + `/rules` + `/graph` | **Secondary proof path** — FastAPI archaeology spine; use `server/smoke_test.py` or REST/WS JSON if the client is unavailable |

### Banking Demo Fixtures

{demo_list}

### Backend Routes (`server/api/main.py`)

{backend_list}

- Default local base URL: `http://localhost:8000`
- Frontend proxy contract may expose these as `/api/project...`

### Client API Routes (`client/app/api`)

{client_list}

- Analysis is deterministic (`client/lib/analyze.ts`); migration/review/tests use Venice when `VENICE_API_KEY` is set.

### Layer 0 Backend Spine Today

- Entry point: `core.pipeline.run_pipeline(project)` → `core.layer0.run(project)`
- Scope: {pipeline_scope()}.
- Key WebSocket events: {ws_list}
- Smoke test expects: `pipeline_started` → `layer0_complete` → `analysis_complete`

### Ownership / Approval Signals

- **Client analyze path:** {ownership}
- **Backend Layer 0 rules:** fields include {rule_fields}; treat `owner` as a review-routing signal, not authority.

### Regenerate This Section

```bash
python legacylift/scripts/sync_conduct_demo_script.py
```

After `git pull` or `git merge`, hooks in `.githooks/` can run this automatically if installed via `legacylift/scripts/install_git_hooks.bat`."""


def build_overclaims_section() -> str:
    demo_mode_layer0 = "true" if 'DEMO_MODE", "false"' in read_text(
        LEGACYLIFT_ROOT / "server" / "core" / "layer0" / "__init__.py"
    ) else "check server/.env"
    demo_mode_pipeline = "true" if 'DEMO_MODE", "true"' in read_text(
        LEGACYLIFT_ROOT / "server" / "core" / "pipeline.py"
    ) else "check server/.env"

    return f"""## Overclaims To Avoid (Auto-Generated)

These guardrails are derived from the current repo layout and should stay honest in pitch and demo narration.

- Do not say LegacyLift completes a full regulated migration automatically. The backend `run_pipeline` currently stops after Layer 0 and marks the project `ready`; deeper layers exist as scaffolding in `core/pipeline.py`.
- Do not say the client `/api/analyze` path uses an LLM. It is deterministic, rule-based archaeology (`client/lib/analyze.ts`).
- Do not say Venice migration/review works without configuration. `/api/migrate`, `/api/review`, and `/api/tests` require `VENICE_API_KEY` on the Next.js server.
- Do not say ownership labels are authoritative. Client ownership is inferred from static signals; backend `owner` is a suggested approval function.
- Do not say risk scores are compliance-grade. They are migration triage signals from explicit heuristics.
- Do not say the dependency graph is complete program analysis. It reflects current parser/analyze output only.
- Do not claim production persistence or auth. Backend projects are in-memory; client `local-*` projects live in browser session storage.
- Do not say frontend and backend are fully wire-compatible without adapters. See `docs/layer0_api_contract.md` for known field, route, port, and WebSocket mismatches.
- Do not imply every uploaded SQL file is typed as SQL end-to-end on the backend upload path unless that has been fixed in `server/api/main.py`.
- Do not demo LLM accuracy when `DEMO_MODE` / deterministic stubs are doing the work. Backend layer0 default DEMO_MODE={demo_mode_layer0}; pipeline module default DEMO_MODE={demo_mode_pipeline}."""


def main() -> int:
    if not DOC_PATH.is_file():
        print(f"Missing doc: {DOC_PATH}", file=sys.stderr)
        return 1

    text = DOC_PATH.read_text(encoding="utf-8")
    text = replace_block(text, MARKER_SNAPSHOT_START, MARKER_SNAPSHOT_END, build_snapshot_section())
    text = replace_block(text, MARKER_OVERCLAIMS_START, MARKER_OVERCLAIMS_END, build_overclaims_section())
    DOC_PATH.write_text(text, encoding="utf-8")
    print(f"Updated {DOC_PATH.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
