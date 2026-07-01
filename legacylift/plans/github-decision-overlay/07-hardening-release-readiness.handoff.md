# Plan 07 Handoff: Hardening + Release Readiness

Branch: `codex/07-hardening-release-readiness`

Plan 07 commit: pending at handoff write time; use `git rev-parse --short HEAD` after the local commit created by this session.

## Summary

Implemented Plan 07 hardening and release-readiness scope only. The GitHub Decision Overlay now has authenticated overlay reads and mutations when hardening is enabled, repo permission map enforcement, per-reviewer rate limiting, private-snippet-safe unauthorized responses, explicit overlay failure states, DB-backed health checks, webhook replay rejection at the route, and current setup docs.

## Changed Files

- `README.md`
- `legacylift/README.md`
- `legacylift/client/README.md`
- `legacylift/extension/README.md`
- `legacylift/extension/src/apiClient.js`
- `legacylift/extension/src/contentScript.js`
- `legacylift/extension/tests/apiClient.test.js`
- `legacylift/extension/tests/contentScript.test.js`
- `legacylift/extension/tests/renderer.test.js`
- `legacylift/server/api/github_overlay.py`
- `legacylift/server/api/main.py`
- `legacylift/server/integrations/github_overlay.py`
- `legacylift/server/tests/test_github_overlay_api.py`
- `legacylift/server/tests/test_plan07_release_hardening.py`
- `legacylift/plans/github-decision-overlay/07-hardening-release-readiness.handoff.md`

## Implemented

- Overlay reads and mutations enforce `X-LegacyLift-User` when `OVERLAY_DEV_AUTH_TOKEN`, `OVERLAY_ALLOWED_REPOS_BY_USER`, `OVERLAY_REQUIRE_AUTH=true`, or non-demo mode is active.
- Overlay mutations always require reviewer identity, preserving the Plan 06 audit requirement.
- `OVERLAY_DEV_AUTH_TOKEN` gates reads and mutations with `Authorization: Bearer <token>` when configured.
- `OVERLAY_ALLOWED_REPOS_BY_USER` supports per-reviewer repo authorization and blocks reads/mutations for repos the reviewer cannot access.
- Unauthorized/forbidden overlay responses do not include annotation criteria, evidence, or source snippets.
- Per-reviewer overlay rate limiting is configurable through `OVERLAY_RATE_LIMIT_PER_MINUTE`.
- Overlay responses now include non-private `state` values: `ready`, `repo_not_indexed`, `pr_not_synced`, `unsupported_file_type`, and `empty`.
- Mutation authorization resolves the annotation back to its repository before applying review workflow changes.
- `/health` now checks database connectivity with `SELECT 1` and returns `503` when the DB is unavailable.
- Webhook route logs event type, delivery ID, repository, and outcome.
- Invalid webhook signatures are rejected before delivery persistence.
- Replayed `X-GitHub-Delivery` IDs are rejected with `409`; ingestion remains idempotent underneath.
- Extension overlay reads now send reviewer identity and optional dev token.
- Extension preserves backend overlay states and renders clear non-blocking banners for backend unavailable, repo not indexed, PR not synced, unauthorized, unsupported file type, and empty annotation result.
- Root, app, client, and extension docs were refreshed for current `client/`, `server/`, and `extension/` layout, local SQLite path, production Postgres `DATABASE_URL`, GitHub App setup, webhook secret setup, Chromium developer-mode extension install, and end-to-end demo.

## BDD/TDD Coverage

- Unauthorized overlay read returns `401` without private annotation text.
- Repo permission map blocks reads and mutations without leaking snippets.
- Overlay read rate limit returns `429`.
- Overlay reports repo-not-indexed, PR-not-synced, unsupported-file-type, and empty states.
- Health check includes database connectivity.
- Webhook bad signatures are rejected before recording delivery IDs.
- Webhook replayed delivery IDs return `409` and log outcome.
- Docs include release-readiness setup commands and security settings.
- Extension sends read auth headers, preserves backend empty states, prioritizes failure states, and renders all required failure banners.

## Verification

Run from `legacylift/server`:

```bash
.venv/bin/python -m pytest tests -q
```

Result: passed, `92` tests passed with existing Pydantic/Pytest warnings.

Run from `legacylift/client`:

```bash
npm run type-check
```

Result: passed.

Run from `legacylift/extension`:

```bash
npm run type-check
npm test
```

Results: type-check passed; `20` extension tests passed.

Run from repo root:

```bash
git diff --check
```

Result: passed.

## Manual Demo Status

Full manual GitHub App plus Chromium extension demo was not run in this session because no live test GitHub App/browser flow was provided. The documented local demo path is now current, and automated coverage verifies the release-hardening behavior behind the API and extension states.

## Known Gaps

- Full GitHub user OAuth remains out of scope. The hardened MVP uses temporary dev bearer token plus reviewer identity and optional repo permission map.
- Repo permission checks are configuration-based (`OVERLAY_ALLOWED_REPOS_BY_USER`), not live GitHub membership checks.
- Rate limiting is in-process and resets on server restart; production deployment should replace it with shared storage if multiple workers are used.
- Baseline indexing is still queued/persisted by webhook ingestion, but no worker orchestration was added in Plan 07.
- Full manual end-to-end demo still needs a live GitHub App install, test repository, tunnel, and Chromium run.

## Linear

- Bundled Linear connector could not fetch `PT5-17` and returned `Issue not found`.
- Direct Linear API access found `PT5-17` (`Harden permissions, webhooks, errors, and release docs`) in `Backlog`.
- Direct Linear API completion comment succeeded: comment ID `e5161245-5367-4193-83b9-abf3c1b82112`.
- Direct Linear API status move did not complete: the workflow-state query returned HTTP 400 before exposing a completed/Done state. No token was persisted.

## Generated/Unrelated Files

- `legacylift/client/tsconfig.tsbuildinfo` was modified by client type-checking and restored before staging.
- Preserved and did not stage pre-existing untracked numbered plan specs, `.DS_Store`, and `legacylift/server/ownership/classifier 2.py`.
