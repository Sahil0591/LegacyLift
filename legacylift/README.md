# LegacyLift

LegacyLift is an AI-assisted migration workbench for legacy COBOL, Java, and VB6 systems. The GitHub Decision Overlay MVP adds persisted ownership annotations, review and approval state, and a Chromium extension that renders those decisions in GitHub PR diffs and blob views.

## Current Layout

```text
legacylift/
├── client/      # Next.js workbench at http://localhost:3000
├── server/      # FastAPI API at http://localhost:8000
├── extension/   # Chromium MV3 GitHub overlay
└── plans/       # GitHub Decision Overlay plan specs and handoffs
```

## Requirements

- Python 3.12
- Node.js 20+
- Chromium or Chrome for the extension
- Optional: PostgreSQL for production-like database testing
- Optional: a GitHub App installed in a test repository

## Environment

Server environment is read from `legacylift/server/.env` when present.

| Variable | Default | Purpose |
|---|---:|---|
| `DEMO_MODE` | `true` | Enables local demo defaults and stubbed LLM behavior. |
| `AUTO_APPROVE` | `false` | Skips manual approval gates for demo runs. |
| `OPENAI_API_KEY` | empty | Required only when demo mode is disabled and LLM calls are used. |
| `DATABASE_URL` | `sqlite+aiosqlite:///./.data/legacylift.db` | Async SQLAlchemy database URL — also backs workbench project/lesson/user-limit storage when `DEMO_MODE=false` (see Database Setup). Required when `DEMO_MODE=false`. |
| `GITHUB_APP_ID` | empty | GitHub App ID for installation-token flows. |
| `GITHUB_PRIVATE_KEY` | empty | GitHub App private key. Keep real keys out of git. |
| `GITHUB_WEBHOOK_SECRET` | empty | Required for `X-Hub-Signature-256` webhook verification. |
| `GITHUB_CLIENT_ID` | empty | Reserved for GitHub App OAuth setup. |
| `GITHUB_CLIENT_SECRET` | empty | Reserved for GitHub App OAuth setup. |
| `OVERLAY_DEV_AUTH_TOKEN` | empty | Temporary bearer token for overlay read and mutation auth. |
| `OVERLAY_REQUIRE_AUTH` | `false` in demo | Set to `true` to require `X-LegacyLift-User` even in demo mode. |
| `OVERLAY_ALLOWED_REPOS_BY_USER` | empty | JSON map of reviewer identities to allowed repos, for example `{"sam@example.com":["acme/checkout"]}`. |
| `OVERLAY_RATE_LIMIT_PER_MINUTE` | `120` | Per-reviewer overlay API request limit. Set `0` to disable locally. |

When `OVERLAY_DEV_AUTH_TOKEN`, `OVERLAY_ALLOWED_REPOS_BY_USER`, `OVERLAY_REQUIRE_AUTH=true`, or non-demo mode is used, overlay reads and writes require `X-LegacyLift-User`. If `OVERLAY_DEV_AUTH_TOKEN` is set, requests must also send `Authorization: Bearer <token>`.

## Database Setup

For local development, no separate database process is required. From `legacylift/server`, the default SQLite database is created automatically at:

```text
legacylift/server/.data/legacylift.db
```

To use PostgreSQL, set `DATABASE_URL` before starting the server:

```bash
export DATABASE_URL='postgresql+asyncpg://legacylift:legacylift@localhost:5432/legacylift'
```

The FastAPI lifespan creates tables on startup through SQLAlchemy metadata (no Alembic migrations directory exists yet — schema evolution is `Base.metadata.create_all` plus a SQLite-only column-repair shim). The `/health` endpoint runs a database `SELECT 1` and returns `503` if the database is unavailable.

When `DEMO_MODE=false`, this same `DATABASE_URL` also backs workbench project, uploaded-file, chunk-progress, lesson, and user-limit persistence (`db/workbench_repositories.py`, tables prefixed `workbench_*`) — one database, no separate config for "project storage" vs. "overlay storage" anymore.

### Neon Postgres (recommended for production / `DEMO_MODE=false`)

1. Sign up at [neon.tech](https://neon.tech) and create a project.
2. Copy the connection string from the Neon dashboard and set it as `DATABASE_URL`, using the `postgresql+asyncpg://` scheme:

   ```bash
   export DATABASE_URL='postgresql+asyncpg://user:password@ep-xxxxxxxx.neon.tech/dbname'
   ```

3. Prefer Neon's **direct** (non-pooled) connection string. If you only have the pooled (pgbouncer transaction-mode) connection string, `db/session.py`'s `create_engine()` automatically disables asyncpg's server-side prepared-statement cache for any `postgresql://` URL, so pooled connections work too — just with marginally lower query-plan caching.
4. Set `DEMO_MODE=false` and `CLERK_JWKS_URL` (see Environment above) — both are required alongside `DATABASE_URL` when running in non-demo mode; the server validates all of them at startup and refuses to start if any are missing or malformed.
5. To import existing local data (`legacylift_data.json`, or an old local SQLite project store) into Neon, run the migration script from `legacylift/server`:

   ```bash
   python -m scripts.migrate_to_neon --source-json legacylift_data.json --target-database-url "$DATABASE_URL" --dry-run
   # once the reported counts look right, drop --dry-run to actually import
   python -m scripts.migrate_to_neon --source-json legacylift_data.json --target-database-url "$DATABASE_URL"
   ```

   The script is idempotent (safe to re-run), never modifies or deletes the source file, and never logs the raw `DATABASE_URL` (credentials are redacted). Verify data landed with `psql "$DATABASE_URL" -c 'select count(*) from workbench_projects;'`.

**The browser never talks to Neon directly.** Only the FastAPI server holds `DATABASE_URL`; the client only ever calls FastAPI endpoints over HTTPS with a Clerk session token, and every row is scoped by `owner_id` derived from that verified JWT's `sub` claim — never from client-submitted data.

## Server Setup

```bash
cd legacylift/server
python -m venv .venv
. .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
export DEMO_MODE=true
export AUTO_APPROVE=true
python -m uvicorn api.main:app --reload --port 8000
```

Verify:

```bash
curl http://localhost:8000/health
python -m pytest tests -q
```

## Client Setup

```bash
cd legacylift/client
npm install
NEXT_PUBLIC_API_URL=http://localhost:8000 npm run dev
```

Open `http://localhost:3000`.

Verify:

```bash
npm run type-check
```

## GitHub App Setup

Create a GitHub App for a test organization or personal account.

Recommended local settings:

- Webhook URL: use a tunnel such as `https://<tunnel>/github/webhook` pointing to `http://localhost:8000`.
- Webhook secret: set the same value in GitHub and `GITHUB_WEBHOOK_SECRET`.
- Subscribe to `installation`, `push`, and `pull_request` events.
- Repository permissions: read access to contents and pull requests is enough for the MVP ingestion flow.
- Install the app only on test repositories that are safe to index.

Webhook requests without a valid `X-Hub-Signature-256` are rejected. Replayed `X-GitHub-Delivery` IDs are rejected at the route and the ingestion layer remains idempotent.

## Overlay API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/github/overlay` | Returns annotations for a repo/ref/path or PR/path. |
| `PATCH` | `/github/overlay/annotation/{id}` | Confirms, reassigns, flags, requests approval, marks approved, or waives approval. |
| `POST` | `/github/webhook` | Receives GitHub App installation, push, and pull request webhooks. |
| `GET` | `/health` | Checks API and database readiness. |

`GET /github/overlay` requires `owner`, `repo`, `path`, and either `ref` or `pull_number`. Use `start`/`end` or `visible_lines` to scope results to visible GitHub lines.

Overlay responses include a `state` field: `ready`, `repo_not_indexed`, `pr_not_synced`, `unsupported_file_type`, or `empty`. Unauthorized responses do not include private criteria, evidence, or snippets.

## Extension Setup

```bash
cd legacylift/extension
npm test
npm run type-check
```

Load the extension in Chromium:

1. Open `chrome://extensions`.
2. Enable developer mode.
3. Choose **Load unpacked**.
4. Select `legacylift/extension`.
5. Open extension settings and configure:
   - Overlay API base URL: `http://localhost:8000`
   - LegacyLift app URL: `http://localhost:3000`
   - Reviewer identity: your GitHub handle or email
   - Dev auth token: `OVERLAY_DEV_AUTH_TOKEN`, when configured

The extension supports GitHub PR file views and blob views. Failure banners cover backend unavailable, repo not indexed, PR not synced yet, unauthorized, unsupported file type, and empty annotation results without blocking GitHub page interactions.

## End-To-End Local Demo

1. Start the server from `legacylift/server`.
2. Start the client from `legacylift/client`.
3. Confirm `curl http://localhost:8000/health` returns database status `ok`.
4. Install the GitHub App into a test repo.
5. Open or update a pull request to trigger `pull_request` ingestion.
6. Confirm webhook logs include event type, delivery ID, repository, and outcome.
7. Load the Chromium extension and configure the API URL, reviewer identity, and optional dev token.
8. Open the PR files page.
9. Confirm LegacyLift badges or a clear failure banner appear.
10. Open a badge detail panel and confirm or reassign the owner.
11. Refresh the page and verify the review state persists.

## Verification

Server:

```bash
cd legacylift/server
python -m pytest tests -q
```

Client:

```bash
cd legacylift/client
npm run type-check
```

Extension:

```bash
cd legacylift/extension
npm run type-check
npm test
```

Repository:

```bash
git status --short
```
