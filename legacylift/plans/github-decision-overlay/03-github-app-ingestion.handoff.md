# Plan 03 Handoff: GitHub App Ingestion + PR Sync

Branch: `codex/03-github-app-ingestion`

## Summary

Implemented Plan 03 server-side GitHub App ingestion only. The server now has a signed webhook endpoint at `POST /github/webhook`, delivery-id idempotency, repository installation metadata persistence, baseline indexing job hooks, mocked installation-token/client helpers, PR changed-file and hunk persistence, and hunk-to-persisted-chunk matching by path and line overlap.

## Changed Files

- `legacylift/server/api/main.py`
- `legacylift/server/db/models.py`
- `legacylift/server/db/repositories.py`
- `legacylift/server/integrations/__init__.py`
- `legacylift/server/integrations/github_app.py`
- `legacylift/server/integrations/github_client.py`
- `legacylift/server/integrations/github_ingestion.py`
- `legacylift/server/integrations/github_patches.py`
- `legacylift/server/tests/test_github_app_ingestion.py`
- `legacylift/server/.env.example`
- `legacylift/README.md`

## Verification

Run from `legacylift/server`:

```bash
.venv/bin/python -m pytest tests/test_github_app_ingestion.py -q
.venv/bin/python -m pytest tests -q
```

Result: `66 passed, 36 warnings`.

## Notes

- No real GitHub keys were added. `.env.example` documents empty `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, `GITHUB_CLIENT_ID`, and `GITHUB_CLIENT_SECRET` variables.
- `installation.created` stores repository metadata and queues a baseline indexing job.
- `push` stores the pushed commit and queues a baseline indexing job.
- `pull_request.opened`, `pull_request.synchronize`, and `pull_request.reopened` sync PR files, parse unified diff hunks, and link matching persisted chunks.
- Duplicate webhook deliveries return `duplicate` before event-specific writes.
- Baseline indexing is implemented as an injectable helper (`index_repository_baseline`) and queue rows; no background worker was added in Plan 03.
- The production GitHub client has the required read methods, while tests use deterministic mocked token/client helpers.

## Known Gaps

- Real GitHub App JWT/private-key signing and installation-token exchange are not wired yet; Plan 03 added mocked token helpers and a real read client surface.
- The webhook endpoint currently uses the default client path, which is safe for tests and idempotency but should be connected to real installation-token generation before live deployment.
- Stale hunk cleanup for a PR whose patch shrinks is not implemented yet.
- Later overlay API, browser extension, and review workflow plans were intentionally not started.

## Linear

The bundled Linear connector initially returned `Issue not found` for `PT5-13`. After switching to the supplied Linear API token, `PT5-13` was found and commented with the Plan 03 completion summary, commit, verification commands, and scope notes.

Linear comment: `https://linear.app/pt5/issue/PT5-13/add-github-app-ingestion-and-pr-sync#comment-0a4cf5ab`
