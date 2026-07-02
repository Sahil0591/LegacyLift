# LegacyLift — Operational Documentation

> Audience: platform engineers, system administrators, and advanced application engineers who maintain, scale, deploy, and troubleshoot LegacyLift.
>
> This document was verified against the source under `legacylift/` (server, client, extension, deployment configs). Where behavior is inferred rather than read directly from code, it is labeled **(inferred)**. No secrets or local `.env` values are reproduced — only variable names, formats, defaults, and operational purpose.

---

## High-Level Overview

LegacyLift is an AI-assisted migration workbench for legacy COBOL, Java, VB6, and SQL-backed systems. A user creates a project, uploads legacy source files, and the backend decomposes them into migration chunks: it parses each file, extracts business rules, builds a dependency graph, scores migration risk, and derives a target-language (Python) profile. A human reviewer then confirms, reassigns, or flags business-rule ownership before any chunk is migrated. Confirmed chunks are migrated one at a time through a fixed sequence of automated checks — migration generation, static analysis, AI semantic review, and test generation/execution — followed by an explicit human approval gate. Final schema-coverage validation can be run against uploaded SQL schema once chunks are approved.

The system is deliberately built for **controlled legacy modernization with human approval gates, not blind code translation**. Every stage is observable, resumable, and auditable: business-rule ownership, approval state, generated code, review findings, test results, and schema-validation output are all persisted and surfaced to engineers. The pipeline is staged on purpose — `POST /project/{id}/start` performs only analysis and target profiling; actual chunk migration does not begin until a domain expert has confirmed the relevant business rule and selected the chunk.

The technical and business value concentrates in three areas: repeatable, deterministic decomposition of legacy code; mandatory human review before migrated code is accepted; and dual operational surfaces — a web workbench for the migration pipeline, and a separate **GitHub Decision Overlay** (a GitHub App plus a Chromium extension) that renders ownership and approval annotations directly inside GitHub PR and blob views. The two surfaces share persistence but are otherwise independent flows.

---

## Architecture & Flow

### Runtime Surfaces

| Surface | Location | Runtime | Responsibility |
|---|---|---|---|
| FastAPI server | `legacylift/server` | Python 3.12, Uvicorn (single worker) | Pipeline orchestration, persistence, Clerk auth, LLM proxying, GitHub ingestion, overlay API, WebSocket fanout |
| Next.js workbench | `legacylift/client` | Node.js 20+, Next.js 14 | Project creation/upload, analysis + review UI, chunk approval, WebSocket event rendering, client-driven ("cloud") migration flow |
| Chromium extension | `legacylift/extension` | Manifest V3 JavaScript | Renders ownership/approval annotations inside GitHub PR file, changes, and blob views |
| Database / storage | JSON file (demo) or one shared SQLAlchemy `DATABASE_URL` (non-demo) | File-backed JSON by default; Postgres/Neon in production | Project state, quotas, lessons, GitHub overlay state, ownership-review audit data |

There are two distinct flows. The **workbench pipeline** (upload → analyze → migrate → approve → validate) and the **GitHub overlay** (webhook ingestion → overlay query → annotation mutation). They are documented separately throughout.

### Workbench Pipeline Flow

```mermaid
flowchart TD
    A["Authenticated user (Clerk JWT)"] --> B["POST /project"]
    B --> C["POST /project/{id}/upload — validate ext/size/dupes"]
    C --> D["POST /project/{id}/start (202)"]
    D --> E["run_pipeline() background task"]
    E --> F["Layer 0: parse, rules, dependency graph, risk"]
    F --> G{Zero chunks?}
    G -->|Yes| Z["status=failed, pipeline_failed event"]
    G -->|No| H["Layer 0.5: target profile (non-fatal)"]
    H --> I["status=ready"]
    I --> J["Human: POST /confirm-rule/{chunk_id} (confirm/reassign/flag)"]
    J --> K["POST /select-chunk/{chunk_id} (202)"]
    K --> L["run_migration_generation() background task"]
    L --> M["Generate Python migration"]
    M --> N["Layer 1: static analysis"]
    N --> O["Layer 2: AI semantic review"]
    O --> P["Layer 3: generate + execute tests (subprocess)"]
    P --> Q["status=ready, chunk_ready_for_approval"]
    Q --> R{Human decision}
    R -->|POST /approve/{chunk_id}| S["Snapshot migrated code"]
    R -->|POST /reject/{chunk_id}| I
    S --> T{All chunks approved?}
    T -->|No| I
    T -->|Yes| U["status=complete, migration_complete"]
    S --> V["Optional POST /validate-schema"]
    V --> W["Layer 4 schema coverage result"]
```

Progress after `start` is delivered over the per-project WebSocket (`/ws/{project_id}`); REST responses for `start`, `select-chunk`, and the webhook are `202 Accepted` and return immediately while background tasks run.

> **Client-driven ("cloud") variant.** The Next.js "New Migration" flow can compute the whole analysis in the browser and persist it server-side via `POST /project/import` (project ids are prefixed `cloud-`). Such projects drive the LLM/approval logic from the client and save progress via `PUT /project/{id}/progress`; the server stores the verbatim analysis blob plus normalized per-chunk state. This coexists with the server-run pipeline above.

### GitHub Overlay Flow

```mermaid
flowchart TD
    A["GitHub App webhook (installation / push / pull_request)"] --> B["POST /github/webhook"]
    B --> C{Valid X-Hub-Signature-256?}
    C -->|No| D["401 invalid_signature"]
    C -->|Yes| E{Duplicate X-GitHub-Delivery?}
    E -->|Yes| F["409 duplicate"]
    E -->|No| G["process_github_webhook: persist repo/commit/PR/hunk/chunk"]
    G --> H["202 Accepted"]
    I["Chromium extension on github.com"] --> J["GET /github/overlay?owner&repo&path&ref|pull_number"]
    J --> K["auth (X-LegacyLift-User / dev token) + repo authz + rate limit"]
    K --> L["query_overlay → state: ready | repo_not_indexed | pr_not_synced | unsupported_file_type | empty"]
    L --> M["renderer.js: ownership badges + guidance panels"]
    M --> N["PATCH /github/overlay/annotation/{id} (confirm/reassign/flag/request/approve/waive)"]
    N --> O["mutate_overlay_annotation: persist review/approval transition"]
```

### Pipeline State Machine

Defined in `core/pipeline.py` (`_VALID_TRANSITIONS`).

| State | Meaning | Valid Next States |
|---|---|---|
| `created` | Project exists; files may not be uploaded | `uploading`, `analysing` |
| `uploading` | At least one file uploaded | `analysing` |
| `analysing` | Layer 0 (and Layer 0.5) running | `ready`, `failed` |
| `ready` | Analysis complete; a confirmed chunk can be selected | `migrating`, `validating` |
| `migrating` | Selected chunk being generated/reviewed/tested | `ready`, `validating`, `failed` |
| `validating` | Final validation/completion transition | `complete`, `failed` |
| `complete` | All chunks approved | — |
| `failed` | Unrecoverable analysis error (e.g. zero chunks) | — |

`_transition()` silently no-ops on an invalid transition (logged as a warning), so a rejected transition never crashes the pipeline.

### Major API Routes

All `/project*`, `/projects`, `/user/*`, and `/llm/*` routes require a valid Clerk bearer token (`Authorization: Bearer <jwt>`); the WebSocket requires `?token=`. Overlay routes use a separate `X-LegacyLift-User` / dev-token scheme.

| Method | Path | Purpose | Notable status codes |
|---|---|---|---|
| GET | `/health` | Liveness + DB `SELECT 1` | `200` ok, `503` DB unavailable |
| GET | `/health/ready` | Readiness (LLM config, storage, missing env) | `200` ready, `503` not ready |
| POST | `/project` | Create project | `201`, `429` project quota |
| POST | `/project/{id}/upload` | Upload source files | `200`, `400`/`413`/`415` validation |
| POST | `/project/{id}/start` | Start analysis pipeline | `202`, `409` already started |
| POST | `/project/{id}/confirm-rule/{chunk_id}` | Ownership review transition | `200`, `400` invalid transition, `404` |
| POST | `/project/{id}/select-chunk/{chunk_id}` | Select confirmed chunk for migration | `202`, `400`/`404`/`409` |
| POST | `/project/{id}/approve/{chunk_id}` | Approve chunk (snapshots code) | `200` |
| POST | `/project/{id}/reject/{chunk_id}` | Reject chunk (required comment) | `200` |
| POST | `/project/{id}/validate-schema` | Layer 4 schema coverage | `200`, `400` no approved chunks, `500` |
| GET | `/project/{id}/status` | Status summary | `200`, `403`/`404` |
| GET | `/project/{id}/rules` | Extracted business rules | `200` |
| GET | `/project/{id}/graph` | Dependency graph nodes/edges | `200` |
| GET | `/project/{id}/target-profile` | Layer 0.5 profile | `200`, `202` pending |
| GET | `/project/{id}/files` | Raw content of every uploaded file | `200` |
| GET | `/project/{id}/lessons` · POST · DELETE `/{lesson_id}` | Feedback-loop lessons | `200`/`201`/`404` |
| POST | `/project/import` | Persist browser-computed analysis as a `cloud-` project | `201`, `429` |
| PUT | `/project/{id}/progress` | Save client-driven per-chunk progress | `200` |
| GET | `/project/{id}/workbench` | Rehydrate stored cloud analysis + progress | `200`, `404` |
| DELETE | `/project/{id}` | Delete project, free one quota slot | `200` |
| GET | `/projects` | List caller's projects | `200` |
| GET | `/user/limits` | Quota + usage counters | `200` |
| POST | `/llm/migrate` | On-demand single-unit migration | `200`, `429`/`501`/`502` |
| POST | `/llm/review` | On-demand AI review | `200`, `429`/`501`/`502` |
| POST | `/llm/tests` | On-demand test generation | `200`, `429`/`501`/`502` |
| POST | `/llm/review-project` | Whole-project (manifest-only) review | `200`, `429`/`501`/`502` |
| GET | `/github/overlay` | Overlay annotations for repo/ref/PR + path | `200`, `401`/`403`/`429` |
| PATCH | `/github/overlay/annotation/{id}` | Mutate review/approval state | `200`, `401`/`403`/`404`/`429` |
| POST | `/github/webhook` | GitHub App ingestion | `202`, `400`/`401`/`409` |
| WS | `/ws/{project_id}` | Real-time pipeline events | close `4001`/`4003` |

### Data Persistence Modes

| Mode | Trigger | Backing store | Notes |
|---|---|---|---|
| Demo/JSON | `DEMO_MODE=true` | `STORAGE_FILE` JSON on local disk | Project state serialized to a single JSON file; overlay/ownership tables still use `DATABASE_URL` (SQLite default) |
| Non-demo/DB | `DEMO_MODE=false` | Single SQLAlchemy `DATABASE_URL` | Workbench data in `workbench_*` tables; GitHub overlay data in overlay tables; same engine, no collision. Postgres/Neon recommended |

In both modes the GitHub overlay uses `DATABASE_URL`. The distinction is where **workbench project** state lives (JSON file vs. `workbench_*` tables).

---

## Prerequisites & Dependencies

### System Requirements

| Requirement | Version / Notes |
|---|---|
| Python | 3.12 (Dockerfile uses `python:3.12-slim`) |
| Node.js | 20+ (`NODE_VERSION=20` on Render) |
| Browser | Chromium or Chrome for the MV3 extension |
| Database | SQLite for local dev; PostgreSQL (Neon recommended) via `DATABASE_URL` for `DEMO_MODE=false` |
| Network | Required for Clerk JWKS, Venice API, GitHub webhooks/API, and deploy builds |
| Docker | Optional; used for the server image and Render deployment |

### Server Python Dependencies

Declared in `legacylift/server/requirements.txt`. All Python components (LLM client, layer modules, subprocess test execution) assume **advanced** familiarity with async error handling, prompt/JSON contracts, and retry behavior.

| Category | Packages |
|---|---|
| API runtime | `fastapi` (>=0.111,<0.120), `uvicorn[standard]`, `websockets`, `python-multipart` |
| LLM client | `openai` (OpenAI SDK, Venice-compatible), `tenacity` |
| Async I/O | `aiohttp`, `aiofiles`, `aiosqlite`, `asyncpg` |
| Persistence | `sqlalchemy` (2.x), `greenlet`, `alembic` |
| Data models | `pydantic` (2.x), `pydantic-settings` |
| Auth | `PyJWT`, `cryptography` |
| Parsing | `tree-sitter` (optional COBOL/Java grammars, loaded if present), `sqlparse` |
| Testing | `pytest`, `pytest-asyncio`, `pytest-mock`, `httpx` |
| Utilities | `python-dotenv`, `rich`, `python-dateutil` |

> `tree-sitter` grammars (`tree-sitter-cobol`, `tree-sitter-java`) are optional. `utils/code_parser.py` imports them in a guarded `try/except` and falls back to regex-based parsing when they are absent, so a missing grammar degrades quality but does not break Layer 0.

### Client (Node) Dependencies

Declared in `legacylift/client/package.json`.

| Category | Packages |
|---|---|
| Framework | `next` (14), `react`, `react-dom`, `typescript` |
| Auth | `@clerk/nextjs` |
| UI | Radix UI, `lucide-react`, `framer-motion`, `tailwindcss`, `reactflow` |
| Utilities | `jszip`, `react-diff-viewer-continued`, `clsx`, `tailwind-merge` |

### Extension Dependencies

`legacylift/extension` uses a Node dev toolchain for tests and type-checking only (`npm test`, `npm run type-check`); the shipped extension is plain MV3 JavaScript with no runtime bundler.

### External Services

| Service | Required for | Notes |
|---|---|---|
| Clerk | Workbench + WebSocket auth | Server validates RS256 JWTs via `CLERK_JWKS_URL`; client uses publishable + secret keys |
| Venice AI (OpenAI-compatible) | Rule extraction, migration, review, tests | Reached through the OpenAI SDK at `VENICE_BASE_URL`; passes `venice_parameters` extras |
| GitHub App | Overlay ingestion + PR sync | Webhook signature via `GITHUB_WEBHOOK_SECRET`; subscribe to `installation`, `push`, `pull_request` |
| Postgres/Neon | Durable non-demo persistence | One `DATABASE_URL` for workbench + overlay |
| Render / Vercel / Azure / Docker | Deployment | `render.yaml` (repo root), server `Dockerfile` (Azure-oriented), client `vercel.json` |

---

## Component Breakdown

### Server

| Component | Inputs | Outputs | Responsibility |
|---|---|---|---|
| `api/main.py` | HTTP requests, WS connections, env | JSON responses, WS events | FastAPI app, all route definitions, CORS, lifespan startup/validation, upload limits, in-memory rate limiter, LLM proxy routes |
| `api/auth.py` | Clerk bearer token / WS `?token=` | Clerk `sub` user id | RS256 JWT verification via cached `PyJWKClient` (`get_current_user_id`, `verify_ws_token`) |
| `api/websocket_manager.py` | Project-scoped event payloads | WS broadcasts + replay | Per-project connection registry and event log; replays past events on connect |
| `api/github_overlay.py` | Overlay query/mutation requests | Annotation payloads, workflow updates | Overlay auth, repo authorization, per-reviewer rate limiting, `/github/overlay` routes |
| `core/pipeline.py` | Project files, selected chunk ids | Status transitions, migrations, WS events | Orchestration: `run_pipeline` (Layer 0/0.5) and `run_migration_generation` (Layers 1–3). Also holds the legacy class-based `MigrationPipeline` (see below) |
| `core/storage.py` | `Project`, `UserLimit` objects | JSON file (demo) or `workbench_*` rows (non-demo) | Workbench persistence, quotas, per-user project lists |
| `db/session.py` | `DATABASE_URL` | Async engine/session | Engine creation, Neon pooling handling (disables asyncpg prepared-statement cache for `postgresql://`), `init_db`, `validate_database_url`, health `SELECT 1` |
| `db/models.py` | SQLAlchemy metadata | Tables | Overlay schema (repositories, commits, PRs, chunks, criteria, ownership, reviews, guidance, annotations) + `workbench_*` (projects, files, chunk-progress, lessons, user-limits) |
| `db/repositories.py` | Parsed project/GitHub data | Upserted rows | Ingestion, layer persistence, review-audit repository functions |
| `db/workbench_repositories.py` | `Project`, `UserLimit` | Upserted `workbench_*` rows | Non-demo workbench persistence (mirrors `repositories.py` upsert pattern) |

> **Two pipeline code paths.** The **active** path is the module-level `run_pipeline()` / `run_migration_generation()` functions, wired to `POST /start` and `POST /select-chunk`. The class-based `MigrationPipeline` (with `await_approval()` and `AUTO_APPROVE`) is a **legacy/self-contained** path that runs all chunks end-to-end and is not wired to routes; `AUTO_APPROVE` only affects that class. In the active path, approval is always an explicit `POST /approve/{chunk_id}`.

### Pipeline Layers

| Component | Inputs | Outputs | Responsibility |
|---|---|---|---|
| `core/layer0/__init__.py` | Uploaded COBOL/Java/VB6/SQL files | Parsed files, business rules, dependency graph, chunks, risk metadata | Full Layer 0 archaeology (`async def run(project)`); sub-modules below are stubs not called by this path |
| `core/layer0/archaeologist.py`, `business_extractor.py`, `dependency_mapper.py`, `risk_scorer.py` | — | — | Stub sub-modules retained for the legacy class path only |
| `core/layer0_5/doc_fetcher.py` | Target language | Version + recommended libraries | Target-profile doc lookup or demo fallback |
| `core/layer0_5/deprecation_mapper.py` | Source + target language | Deprecated-pattern guidance | Migration compatibility mapping |
| `core/layer0_5/gotcha_registry.py` | Source + target language | Known pitfalls | Target-profile gotcha registry |
| `core/migration/generator.py` | Chunk, rule, related chunks, file context, manifest, lessons | Migrated Python, explanation, confidence | LLM-backed generation with demo fallback; never raises (empty result signals failure) |
| `core/layer1/static_analyser.py` | Migrated Python + original source | Issues, warnings, pass/fail | Deterministic checks: syntax, type annotations, financial `float`, branches, antipatterns |
| `core/layer2/ai_reviewer.py` | Source, migrated code, rule, static result | Semantic findings, confidence, retry flag | Adversarial LLM review of behavioral differences |
| `core/layer3/test_generator.py` | Source, migrated code, AI review | Generated tests + execution results | LLM test generation plus **isolated subprocess** execution of untrusted code |
| `core/layer4/schema_validator.py` | Approved migrated chunks + uploaded SQL | Table/column coverage report | Textual schema-completeness validation |

### Utilities

| Component | Inputs | Outputs | Responsibility |
|---|---|---|---|
| `utils/code_parser.py` | Filename + source text | `ParsedFile`, `CodeChunk`, `DataItem`, dependency hints | Language-aware parser (regex + optional tree-sitter). Never raises — returns empty `ParsedFile` on error |
| `utils/schema_parser.py` | SQL/DDL text | Parsed tables/columns | Schema extraction for Layer 4 (`sqlparse`) |
| `utils/llm_client.py` | Prompts, model/retry config | Completion text or stream chunks | Central Venice wrapper (OpenAI SDK). Response cache, tenacity retry, DEMO fallback, `is_configured()` |
| `utils/migration_prompts.py` | Chunk, rule, profile, context | Prompt strings + JSON parse helpers | Builds `/llm/*` prompts (`build_migration_prompt`, `build_review_prompt`, `build_test_prompt`, `build_project_review_prompt`, `parse_json_loose`, `strip_code_fence`) |

### Ownership Review

| Component | Inputs | Outputs | Responsibility |
|---|---|---|---|
| `ownership/classifier.py` | Rule text, ownership groups, optional LLM | Ownership classification | Rule-to-owner classification (deterministic scoring + optional LLM assist) |
| `ownership/review_workflow.py` | Current review state + requested action | Normalized transition | Confirm, reassign, flag, request-approval, approve, waive transitions; raises `ReviewWorkflowError` on invalid action |
| `ownership/guidance.py` | Classification + change text | Checklist, suggested tests, stakeholder messaging | Review guidance for overlay/workbench |

### GitHub Integration

| Component | Inputs | Outputs | Responsibility |
|---|---|---|---|
| `integrations/github_app.py` | Webhook body, signature, app settings | Signature verdict, settings, mock token | `GitHubAppSettings.from_env()`, `verify_webhook_signature` |
| `integrations/github_client.py` | Installation token, API paths | Repo contents, PR files | GitHub REST client + mock client |
| `integrations/github_ingestion.py` | Webhook payloads | Repo/commit/PR/hunk/chunk records | `process_github_webhook`; idempotent on delivery id |
| `integrations/github_patches.py` | PR patch text | Parsed hunk ranges | Diff/hunk parsing |
| `integrations/github_overlay.py` | Repo/ref/path or PR/path query | Annotation payloads | `query_overlay`, `mutate_overlay_annotation`, `repository_for_annotation`; raises `OverlayError` with status |

### Client

| Component | Inputs | Outputs | Responsibility |
|---|---|---|---|
| `client/lib/api.ts` | Client actions + Clerk token | Authenticated REST calls | Backend API wrapper, error normalization |
| `client/lib/migration.ts` | Chunk source, generated code, instructions | `/llm/migrate`, `/llm/review`, `/llm/tests` calls | Regenerate/review/test helpers through the backend |
| `client/lib/projectStore.ts` | Project data | Local/persisted project state | Project store for the workbench |
| `client/lib/projectReview.ts` | Project review data | Review state | Project-level review helpers |
| `client/hooks/usePipeline.ts` | WS events, project id | Normalized pipeline UI state | Pipeline state reducer |
| `client/hooks/useWebSocket.ts` | Project id + Clerk token | Event subscription API | WS connection management (`/ws/{id}?token=`) |
| `client/components/workbench/*` | Pipeline state, user actions | Review/compare/queue/finalize UI | Main engineering workbench |
| `client/components/pipeline/*` | Uploads, approvals, progress | Setup + layer-control UI | Project setup and pipeline controls (incl. `FileUpload.tsx` `accept` list) |

### Browser Extension

| Component | Inputs | Outputs | Responsibility |
|---|---|---|---|
| `extension/src/config.js` | `chrome.storage.sync` | Effective settings | `DEFAULT_SETTINGS`, `loadSettings`, `saveSettings` |
| `extension/src/apiClient.js` | Page context + settings | Overlay API requests | Read/mutate overlay annotations |
| `extension/src/contentScript.js` | GitHub DOM | Injected overlay root + lifecycle | Page integration; last script in the injection order |
| `extension/src/githubDom.js` | GitHub PR/blob HTML | File/path/line context | DOM extraction |
| `extension/src/githubUrl.js` | Page URL | Parsed owner/repo/ref/PR/path | URL parsing |
| `extension/src/renderer.js` | Annotation payloads | Badges, panels, banners | GitHub UI rendering, including failure banners |
| `extension/manifest.json` | — | — | MV3 manifest: permissions, host permissions, content-script matches, options page |

---

## Configuration & Environment Variables

No secrets are reproduced here. "Failure mode" describes what happens when a variable is missing or misconfigured.

### Server `.env` (`legacylift/server/.env.example`)

| Variable | Default | Required | Purpose | Failure mode |
|---|---|---:|---|---|
| `DEMO_MODE` | `true` | No | Skip real LLM calls, use demo stubs, JSON project storage | Non-demo behavior enabled unexpectedly; startup env validation activates |
| `AUTO_APPROVE` | `false` | No | Auto-approves in the **legacy class-based** pipeline only | No effect on the active route path |
| `VENICE_API_KEY` | empty | Yes when `DEMO_MODE=false` | Venice credential for all LLM calls | Startup refuses to start (non-demo); `/llm/*` return `501`; migrations produce empty code |
| `VENICE_BASE_URL` | `https://api.venice.ai/api/v1` | Yes when `DEMO_MODE=false` | OpenAI-compatible base URL | LLM calls fail / route to wrong endpoint |
| `VENICE_MODEL` | `openai-gpt-52-codex` | Yes when `DEMO_MODE=false` | Default model id | Invalid model → upstream `502` |
| `VENICE_REASONING_EFFORT` | `low` | No | Extra `reasoning_effort` in the request body | Ignored if unsupported by model |
| `LLM_MAX_RETRIES` | `3` | No | Tenacity attempts for rate-limit/connection errors | Fewer/more retries |
| `LLM_RETRY_DELAY` | `2` | No | Exponential backoff multiplier (seconds) | Slower/faster retry cadence |
| `LLM_ROUTE_RATE_LIMIT` | `20` | No | Per-user/IP `/llm/*` requests per 60s | `429` sooner/later |
| `LLM_DAILY_MIGRATION_LIMIT` | `1000` | No | Daily per-user migrate/review/tests/project-review quota | `429` "Daily migration quota exhausted" |
| `CLERK_JWKS_URL` | empty | Yes for auth routes and `DEMO_MODE=false` startup | JWKS endpoint for RS256 verification | `RuntimeError` on first auth use; startup refuses (non-demo); all authed routes `401` |
| `DATABASE_URL` | `sqlite+aiosqlite:///./.data/legacylift.db` | Yes when `DEMO_MODE=false` | Shared SQLAlchemy DB (workbench + overlay) | Startup refuses if missing/malformed (non-demo); `/health` `503` |
| `GITHUB_APP_ID` | empty | For GitHub App use | App identifier | Ingestion/API auth cannot complete |
| `GITHUB_PRIVATE_KEY` | empty | For GitHub App use | App private key | Installation-token flows fail |
| `GITHUB_WEBHOOK_SECRET` | empty | For webhook verification | HMAC secret for `X-Hub-Signature-256` | Every webhook `401 invalid_signature` |
| `GITHUB_CLIENT_ID` | empty | Optional/reserved | OAuth client id | Reserved; unused in MVP |
| `GITHUB_CLIENT_SECRET` | empty | Optional/reserved | OAuth client secret | Reserved; unused in MVP |
| `OVERLAY_DEV_AUTH_TOKEN` | empty | If set, overlay requires it | Bearer token for overlay reads/mutations | If set, requests without matching `Authorization: Bearer` get `401` |
| `OVERLAY_REQUIRE_AUTH` | `false` (demo) | No | Force `X-LegacyLift-User` even in demo | Overlay reads `401` without identity |
| `OVERLAY_ALLOWED_REPOS_BY_USER` | empty | No | JSON map reviewer → allowed repo patterns | Malformed JSON → `503`; unlisted repo → `403` |
| `OVERLAY_RATE_LIMIT_PER_MINUTE` | `120` | No | Per-reviewer overlay rate limit; `0` disables | `429` when exceeded; invalid value → `503` |
| `STORAGE_FILE` | `legacylift_data.json` | No | JSON project store path when `DEMO_MODE=true` | Wrong path → project state not found/lost |
| `MAX_UPLOAD_FILES` | `25` | No | Max files per upload | Upload `400` "Too many files" |
| `MAX_FILE_SIZE_MB` | `5` | No | Per-file size cap (MB) | Upload `413` per-file / total |
| `TEST_EXECUTION_TIMEOUT` | `5` | No | Layer 3 subprocess timeout budget | Long tests time out / hang risk |
| `FRONTEND_URL` | empty | No | Extra CORS origin | Browser CORS errors from that origin |
| `FRONTEND_HOST` | empty | No | Extra HTTPS CORS origin (Render service link) | CORS errors from Render client host |
| `PORT` | `8000` (container fallback) | Deployment | Uvicorn port in containers | Bound to wrong port |

Startup validation (`_validate_production_env` in `api/main.py`): when `DEMO_MODE=false`, the server refuses to start unless `VENICE_API_KEY`, `VENICE_MODEL`, `VENICE_BASE_URL`, `CLERK_JWKS_URL`, and a well-formed `DATABASE_URL` are all set.

CORS allow-list is hard-coded in `api/main.py` (`localhost:3000`, `127.0.0.1:3000`, `github.com`, two Vercel prod hosts, plus `*.vercel.app` via regex) and extended by `FRONTEND_URL` / `FRONTEND_HOST`.

### Client `.env.local` (`legacylift/client/.env.local.example`)

| Variable | Default | Required | Purpose |
|---|---|---:|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | placeholder | Yes | Clerk browser SDK key |
| `CLERK_SECRET_KEY` | placeholder | Yes (server-side Clerk) | Clerk server secret |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | `/sign-in` | No | Sign-in route |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | `/sign-up` | No | Sign-up route |
| `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL` | `/demo` | No | Post-sign-in redirect |
| `NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL` | `/demo` | No | Post-sign-up redirect |
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000` | No | REST base URL (used when `NEXT_PUBLIC_API_HOST` unset) |
| `NEXT_PUBLIC_API_HOST` | empty | No | Host-only API target; client builds `https://<host>` (set by Render) |
| `NEXT_PUBLIC_WEBSOCKET_URL` | `ws://localhost:8000` | No | WS base URL (`ws://` or `wss://`) |
| `NEXT_PUBLIC_DEMO_MODE` | `false` | No | Load demo COBOL fixtures instead of hitting the API |

> Venice is **never** configured in the client. All LLM work is proxied through the backend `/llm/*` routes so the key lives only on the server.

### Extension Settings (`chrome.storage.sync`, not `.env`)

Defined in `extension/src/config.js` (`DEFAULT_SETTINGS`).

| Setting | Default | Purpose |
|---|---|---|
| `apiBaseUrl` | `http://127.0.0.1:8000` | Overlay API base URL |
| `legacyLiftBaseUrl` | `http://127.0.0.1:3000` | Workbench URL linked from overlay panels |
| `reviewerIdentity` | `github-browser-extension` | Sent as `X-LegacyLift-User` |
| `devToken` | empty | Bearer token matching `OVERLAY_DEV_AUTH_TOKEN` |
| `enabled` | `true` | Overlay rendering toggle |

### Deployment Config Files

| File | Location | Purpose / key facts |
|---|---|---|
| `render.yaml` | **repo root** | Two `free`-plan web services: `legacylift-api` (Docker, `dockerContext: legacylift/server`, health `/health`, `DEMO_MODE=false`) and `legacylift-client` (Node 20, `npm ci && npm run build`, `npm run start -- -p $PORT`). Cross-links `FRONTEND_HOST`/`NEXT_PUBLIC_API_HOST` via each service's `RENDER_EXTERNAL_HOSTNAME`. `VENICE_API_KEY`, `CLERK_JWKS_URL`, `DATABASE_URL` are `sync: false` (set in dashboard) |
| `Dockerfile` | `legacylift/server/` | Multi-stage `python:3.12-slim`; venv in stage 1, lean runtime in stage 2. Defaults `DEMO_MODE=false`, `VENICE_BASE_URL`, `VENICE_MODEL`, `LLM_PROVIDER=venice`, `API_HOST/API_PORT`. `HEALTHCHECK` hits `/health`. Runs `uvicorn ... --workers 1` on `${PORT:-8000}` (Azure-oriented; single worker) |
| `vercel.json` | `legacylift/client/` | `framework: nextjs`, standard build/dev/install commands, `outputDirectory: .next`. Ships placeholder Azure URLs for `NEXT_PUBLIC_API_URL` / `NEXT_PUBLIC_WEBSOCKET_URL` (`wss://`) — **override per environment** |
| `manifest.json` | `legacylift/extension/` | MV3. `permissions: storage, clipboardWrite`. `host_permissions`: `http://localhost:*`, `http://127.0.0.1:*`, `https://github.com/*`. Content scripts on `.../pull/*/files*`, `.../pull/*/changes*`, `.../blob/*` at `document_idle` |

---

## Setup & Deployment

Windows PowerShell and POSIX commands are given where activation/paths differ.

### Deployment Topology (demo local vs. non-demo prod)

The local and production configurations are intentionally different — this is by design, not a misconfiguration:

- **Local default = demo mode.** The local `.env` ships with `DEMO_MODE=true`, so the server runs against deterministic stubs and JSON-file project storage and does **not** connect to external services (Venice, a managed DB, etc.). A local API that "doesn't connect to env/services" is the expected demo behavior, not a broken setup — flip `DEMO_MODE=false` and supply the required vars (see the startup checklist) to exercise the real integrations locally.
- **Production = fully non-demo.** All variables are set to their non-demo values and the product runs as a distributed system across hosted services:

  | Tier | Host | Config source |
  |---|---|---|
  | Frontend (Next.js client) | **Vercel** | `vercel.json` + dashboard env (`NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WEBSOCKET_URL`, Clerk keys) |
  | Backend (FastAPI server) | **Render** | `render.yaml` + dashboard secrets (`VENICE_API_KEY`, `CLERK_JWKS_URL`, `DATABASE_URL` — all `sync: false`) |
  | Database | **Neon Postgres** | `DATABASE_URL` (`postgresql+asyncpg://…`), shared by workbench `workbench_*` and GitHub overlay tables |

  In prod, hosting platforms inject environment variables directly into the process, so `.env` dotenv discovery is not involved. (Local `DEMO_MODE=false` reads env from `legacylift/server/.env` via `load_dotenv(find_dotenv(usecwd=True))`, so launch uvicorn from `legacylift/server` for that file to be found — **(inferred)** from the cwd-relative discovery call in `api/main.py`.)

### 1. Local FastAPI Server

POSIX:
```bash
cd legacylift/server
python -m venv .venv
. .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
cp .env.example .env      # keep DEMO_MODE=true for a no-key local run
python -m uvicorn api.main:app --reload --port 8000
```

Windows PowerShell:
```powershell
cd legacylift\server
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
Copy-Item .env.example .env
python -m uvicorn api.main:app --reload --port 8000
```

### 2. Local Next.js Client

```bash
cd legacylift/client
npm install
cp .env.local.example .env.local     # PowerShell: Copy-Item .env.local.example .env.local
npm run dev
```
Open `http://localhost:3000`.

### 3. Local Chromium Extension

```bash
cd legacylift/extension
npm install
npm test
npm run type-check
```
Then: `chrome://extensions` → enable Developer mode → **Load unpacked** → select `legacylift/extension`. In the options page set `apiBaseUrl` (`http://127.0.0.1:8000`), `legacyLiftBaseUrl` (`http://127.0.0.1:3000`), `reviewerIdentity`, and `devToken` (if `OVERLAY_DEV_AUTH_TOKEN` is configured).

### 4. SQLite Demo Mode

Keep `DEMO_MODE=true`. Workbench projects serialize to `STORAGE_FILE` (JSON); overlay tables use the default SQLite `DATABASE_URL` at `legacylift/server/.data/legacylift.db` (created automatically on startup). No LLM key required.

### 5. Postgres/Neon Non-Demo Mode

```bash
export DATABASE_URL='postgresql+asyncpg://user:password@ep-xxxx.neon.tech/dbname'  # prefer direct (non-pooled)
export DEMO_MODE=false
export CLERK_JWKS_URL='https://<instance>.clerk.accounts.dev/.well-known/jwks.json'
export VENICE_API_KEY=...   # plus VENICE_MODEL / VENICE_BASE_URL
```
PowerShell uses `$env:DATABASE_URL = '...'`. Tables are created on startup via `Base.metadata.create_all` (no Alembic dir yet; a SQLite-only column-repair shim exists). Import existing local data:
```bash
python -m scripts.migrate_to_neon --source-json legacylift_data.json --target-database-url "$DATABASE_URL" --dry-run
python -m scripts.migrate_to_neon --source-json legacylift_data.json --target-database-url "$DATABASE_URL"
```
The script is idempotent, never mutates the source, and redacts credentials in logs.

### 6. GitHub App Webhook Setup

Create a GitHub App on a test org/account. Webhook URL: `https://<tunnel>/github/webhook` (tunnel to `localhost:8000`). Set the same secret in GitHub and `GITHUB_WEBHOOK_SECRET`. Subscribe to `installation`, `push`, `pull_request`. Grant read on contents + pull requests. Install only on safe test repos. Invalid `X-Hub-Signature-256` → `401`; replayed `X-GitHub-Delivery` → `409` (ingestion stays idempotent).

### 7. Docker Server Build/Run

```bash
cd legacylift/server
docker build -t legacylift-api .
docker run --env-file .env -e PORT=8000 -p 8000:8000 legacylift-api
```
The image runs **one** Uvicorn worker — required because active-pipeline and WebSocket state are in-memory.

### 8. Render Deployment

`render.yaml` (repo root) provisions `legacylift-api` (Docker) and `legacylift-client` (Node). Set the `sync: false` secrets (`VENICE_API_KEY`, `CLERK_JWKS_URL`, `DATABASE_URL`) in the dashboard. The `free` plan has no attached disk, so a SQLite `DATABASE_URL` is wiped on redeploy — point it at Neon.

### 9. Vercel Client Deployment

Deploy `legacylift/client` with `vercel.json`. Override `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_WEBSOCKET_URL` (use `wss://`) to your real backend, plus Clerk client keys. Two Vercel hosts are pre-allowed in server CORS; others match `*.vercel.app`.

### Verification Commands

```bash
curl http://localhost:8000/health         # {"status":"ok","database":{"status":"ok"}}
curl http://localhost:8000/health/ready    # ready/demo_mode/llm_configured/storage_mode/missing_env
cd legacylift/server && python -m pytest tests -q
cd legacylift/client && npm run type-check
cd legacylift/extension && npm test && npm run type-check
git status --short
```

### Production Configuration Checklist

1. `DEMO_MODE=false`.
2. `VENICE_API_KEY`, `VENICE_BASE_URL`, `VENICE_MODEL` set.
3. `CLERK_JWKS_URL` set on the server; Clerk client keys set in Next.js.
4. `DATABASE_URL` → durable Postgres/Neon.
5. CORS via `FRONTEND_URL` / `FRONTEND_HOST`.
6. GitHub App secrets configured if using the overlay.
7. Overlay auth policy (`OVERLAY_DEV_AUTH_TOKEN`, `OVERLAY_REQUIRE_AUTH`, `OVERLAY_ALLOWED_REPOS_BY_USER`) as needed.
8. Confirm `/health/ready` returns `ready: true` **with `DEMO_MODE=false`** before promoting.
9. Run server tests, client type-check, extension tests.

---

## Operational Notes

- **In-memory state.** `active_pipelines`, `_project_locks`, `_rl_hits` (`api/main.py`) and the WebSocket connection registry/event log (`api/websocket_manager.py`) are per-process. Run a single worker unless this state is externalized.
- **Unified non-demo persistence.** With `DEMO_MODE=false`, workbench (`workbench_*`) and overlay tables share one `DATABASE_URL`/engine, so backup/restore is a single Postgres concern. `DEMO_MODE=true`'s JSON file is a separate backup concern.
- **Demo mode masks config errors.** It avoids real LLM/DB dependency but can hide production misconfiguration — always validate `/health/ready` with `DEMO_MODE=false` before release.
- **Untrusted code execution.** Layer 3 runs generated Python in a subprocess with temporary files. Treat generated code as untrusted and keep that isolation boundary intact.
- **Graceful degradation.** The pipeline catches most layer exceptions and emits recoverable `error` events. A visible UI error does not necessarily mean the process crashed — inspect `/status` and the WebSocket event log before restarting.
