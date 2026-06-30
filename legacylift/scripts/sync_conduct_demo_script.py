#!/usr/bin/env python3
"""Refresh the auto-generated repo snapshot in conduct_demo_script.md.

Run after pulling main or changing demo surfaces:

    python legacylift/scripts/sync_conduct_demo_script.py

Optional env overrides:
    LEGACYLIFT_DEPLOY_URL  — production demo URL
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

MARKER_START = "<!-- conduct-demo:autogen:start -->"
MARKER_END = "<!-- conduct-demo:autogen:end -->"


def repo_root() -> Path:
    here = Path(__file__).resolve().parent
    return here.parent.parent


def load_config(legacylift_root: Path) -> dict:
    config_path = legacylift_root / "docs" / "conduct_demo_script.config.json"
    config: dict = {}
    if config_path.exists():
        config = json.loads(config_path.read_text(encoding="utf-8"))
    deploy_url = __import__("os").environ.get("LEGACYLIFT_DEPLOY_URL")
    if deploy_url:
        config["deploy_url"] = deploy_url.rstrip("/") + "/"
    return config


def git_value(args: list[str], default: str = "unknown") -> str:
    try:
        out = subprocess.check_output(
            ["git", *args],
            stderr=subprocess.DEVNULL,
            text=True,
        ).strip()
        return out or default
    except (subprocess.CalledProcessError, FileNotFoundError):
        return default


def rel_glob(root: Path, pattern: str) -> list[str]:
    return sorted(str(p.relative_to(root)).replace("\\", "/") for p in root.glob(pattern))


def read_api_routes(client_root: Path) -> list[str]:
    routes: list[str] = []
    for route_file in sorted((client_root / "app" / "api").rglob("route.ts")):
        rel = route_file.relative_to(client_root / "app")
        path = "/" + str(rel.parent).replace("\\", "/")
        method = "POST"
        text = route_file.read_text(encoding="utf-8", errors="ignore")
        if "export async function GET" in text:
            method = "GET/POST"
        routes.append(f"{method} {path}")
    return routes


def read_client_pages(client_root: Path) -> list[str]:
    pages: list[str] = []
    for page in sorted((client_root / "app").rglob("page.tsx")):
        rel = page.relative_to(client_root / "app")
        parts = list(rel.parts[:-1])
        route = "/" + "/".join(parts) if parts else "/"
        if route.endswith("[id]") or "[id]" in route:
            route = route.replace("[id]", "{id}")
        pages.append(route)
    return pages


def risk_rules_summary(analyze_path: Path) -> list[str]:
    if not analyze_path.exists():
        return []
    text = analyze_path.read_text(encoding="utf-8", errors="ignore")
    rules: list[str] = []
    for match in re.finditer(r"// Rule (\d+) — (.+)", text):
        rules.append(f"Rule {match.group(1)}: {match.group(2)}")
    return rules


def build_snapshot(legacylift_root: Path, config: dict) -> str:
    client_root = legacylift_root / "client"
    server_root = legacylift_root / "server"
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    commit = git_value(["rev-parse", "--short", "HEAD"])
    branch = git_value(["branch", "--show-current"])

    deploy_url = config.get("deploy_url", "(not configured)")
    deploy_label = config.get("deploy_label", "Deploy")
    sample_repo = config.get(
        "sample_repo_url",
        "github.com/aws-samples/aws-mainframe-modernization-carddemo",
    )
    seeded_path = config.get("seeded_demo_project_path", "/project/demo-loan-engine")
    backend_url = config.get("backend_local_url", "http://localhost:8000")

    demo_cobol = rel_glob(server_root / "demo" / "sample_cobol", "*.cbl")
    demo_sql = rel_glob(server_root / "demo" / "sample_schema", "*.sql")
    api_routes = read_api_routes(client_root)
    pages = read_client_pages(client_root)
    risk_rules = risk_rules_summary(client_root / "lib" / "analyze.ts")

    lines = [
        MARKER_START,
        "",
        "## Repo Snapshot (auto-generated)",
        "",
        f"_Last synced: {now} · branch `{branch}` · commit `{commit}`_",
        "",
        "### Deployed demo",
        "",
        f"- **{deploy_label}:** [{deploy_url}]({deploy_url})",
        f"- **Fastest live path:** open deploy URL → **Map my codebase** → `{seeded_path}` (seeded COBOL loan-engine workbench, no backend required)",
        f"- **Interactive path:** [{deploy_url}demo]({deploy_url}demo) → paste a public GitHub repo or upload COBOL/SQL files → `/api/analyze` → workbench review",
        "",
        "### Demo surfaces in this repo",
        "",
        "**Client (Vercel primary)**",
        "",
    ]

    for page in pages:
        lines.append(f"- `{page}`")
    lines.append("")
    lines.append("**Client API routes (Next.js)**")
    lines.append("")
    for route in api_routes:
        lines.append(f"- `{route}`")
    lines.append("")
    lines.append("**Server demo fixtures (COBOL/SQL banking)**")
    lines.append("")
    for path in demo_cobol + demo_sql:
        lines.append(f"- `{path}`")
    lines.append("")
    lines.append("**Default public repo on `/demo`**")
    lines.append("")
    lines.append(f"- `{sample_repo}`")
    lines.append("")
    lines.append("**Auditable client risk rules (`client/lib/analyze.ts`)**")
    lines.append("")
    if risk_rules:
        for rule in risk_rules:
            lines.append(f"- {rule}")
    else:
        lines.append("- (could not parse risk rules — check analyze.ts)")
    lines.append("")
    lines.append("**Backend Layer 0 spine (optional local proof)**")
    lines.append("")
    lines.append(f"- Base URL: `{backend_url}`")
    lines.append("- Flow: `POST /project` → upload demo files → `POST /project/{{id}}/start` → `GET /project/{{id}}/rules` + `/graph`")
    lines.append("- Contract details: `legacylift/docs/layer0_api_contract.md`")
    lines.append("")
    lines.append(
        "Re-run `python legacylift/scripts/sync_conduct_demo_script.py` after pulls, "
        "or rely on the GitHub Action on pushes to `main`."
    )
    lines.append("")
    lines.append(MARKER_END)
    return "\n".join(lines)


def replace_autogen_block(doc: str, snapshot: str) -> str:
    pattern = re.compile(
        re.escape(MARKER_START) + r".*?" + re.escape(MARKER_END),
        re.DOTALL,
    )
    if pattern.search(doc):
        return pattern.sub(snapshot, doc, count=1)

    anchor = "## One-Line Pitch"
    if anchor in doc:
        return doc.replace(anchor, snapshot + "\n\n" + anchor, 1)

    return snapshot + "\n\n" + doc


def main() -> int:
    root = repo_root()
    legacylift = root / "legacylift"
    doc_path = legacylift / "docs" / "conduct_demo_script.md"
    if not doc_path.exists():
        print(f"Missing {doc_path}", file=sys.stderr)
        return 1

    config = load_config(legacylift)
    snapshot = build_snapshot(legacylift, config)
    original = doc_path.read_text(encoding="utf-8")
    updated = replace_autogen_block(original, snapshot)

    if updated == original:
        print("conduct_demo_script.md already up to date")
        return 0

    doc_path.write_text(updated, encoding="utf-8", newline="\n")
    print(f"Updated {doc_path.relative_to(root)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
