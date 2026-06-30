# LegacyLift — AI-Assisted Legacy Code Migration Workbench

LegacyLift is an AI-powered pipeline that migrates legacy COBOL, Java, and VB6 codebases to modern Python with human-in-the-loop review at every step.

---

## Pipeline Overview

```
Upload Files
     │
     ▼
Layer 0 — Archaeology
  ├── Archaeologist      → structural scan, chunk creation
  ├── BusinessExtractor  → LLM extracts business rules
  ├── DependencyMapper   → builds module call graph
  └── RiskScorer         → assigns 0–1 risk score per file
     │
     ▼
Layer 0.5 — Target Profile
  ├── DocFetcher         → fetches Python/Java stdlib docs
  ├── DeprecationMapper  → maps deprecated COBOL patterns to Python equivalents
  └── GotchaRegistry     → known migration pitfalls (COMP-3, date arithmetic, etc.)
     │
     ▼
Per-Chunk Migration (repeated for each chunk)
  ├── Layer 1 — StaticAnalyser    → syntax, types, float-in-finance detection
  ├── Layer 2 — AIReviewer        → semantic equivalence check
  ├── Layer 3 — TestGenerator     → LLM writes + runs pytest cases
  └── Human Approval Gate         → POST /approve or /reject
     │
     ▼
Layer 4 — SchemaValidator
  └── Verifies all legacy DB tables are handled in migrated code
     │
     ▼
Migration Complete → JSON report
```

Real-time progress is streamed to connected clients via WebSocket at `/ws/{project_id}`.

---

## Quick Start (Windows)

```bat
REM 1. Clone the repo and open the legacylift directory
cd legacylift

REM 2. Create the virtual environment (once)
python -m venv .venv

REM 3. Run setup (installs all dependencies)
setup.bat

REM 4. Copy and configure environment variables
copy .env.example .env
REM Edit .env: add your OPENAI_API_KEY

REM 5. Start the API server
.venv\Scripts\python -m uvicorn legacylift.api.main:app --reload

REM 6. Run the tests (in a second terminal)
.venv\Scripts\pytest legacylift/tests/ -v
```

The server starts at `http://localhost:8000`. Hit `/health` to confirm.

---

## Running a Demo (no OpenAI key needed)

With `DEMO_MODE=true` (the default), the pipeline uses stub data at every layer and prints all LLM prompts to the console. You can run a complete end-to-end demo without an API key.

```bat
REM Start the server with demo mode
set DEMO_MODE=true
set AUTO_APPROVE=true
.venv\Scripts\python -m uvicorn legacylift.api.main:app --reload

REM In another terminal, create a project and upload demo files
curl -X POST http://localhost:8000/api/project ^
  -H "Content-Type: application/json" ^
  -d "{\"name\": \"Bank Demo\", \"source_language\": \"COBOL\"}"

REM Note the project_id returned, then upload the demo COBOL files:
curl -X POST http://localhost:8000/api/project/{project_id}/upload ^
  -F "files=@demo/sample_cobol/interest_calc.cbl" ^
  -F "files=@demo/sample_cobol/account_master.cbl" ^
  -F "files=@demo/sample_cobol/end_of_day_batch.cbl"

REM Start the pipeline (connect to WS first to see events):
curl -X POST http://localhost:8000/api/project/{project_id}/start
```

---

## API Reference

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/project` | Create a new project |
| POST | `/api/project/{id}/upload` | Upload legacy source files |
| POST | `/api/project/{id}/start` | Start the migration pipeline |
| POST | `/api/project/{id}/approve/{chunk_id}` | Approve a migration chunk |
| POST | `/api/project/{id}/reject/{chunk_id}` | Reject and regenerate a chunk |
| POST | `/github/webhook` | GitHub App webhook ingestion for installations, pushes, and PR changes |
| GET  | `/github/overlay` | Return GitHub code overlay annotations for a repo/ref/path or PR |
| PATCH | `/github/overlay/annotation/{id}` | Confirm, reassign, flag, request, approve, or waive overlay approval state |
| GET  | `/api/project/{id}/status` | Get project status and chunk counts |
| GET  | `/api/project/{id}/rules` | Get extracted business rules |
| GET  | `/api/project/{id}/graph` | Get dependency graph and risk scores |
| GET  | `/health` | Health check (used by Azure App Service) |
| WS   | `/ws/{project_id}` | WebSocket event stream |

Interactive API docs: `http://localhost:8000/docs`

`GET /github/overlay` requires `owner`, `repo`, `path`, and either `ref` or `pull_number`; use `start`/`end` or `visible_lines` to limit annotations to the visible GitHub lines. `PATCH /github/overlay/annotation/{id}` requires `X-LegacyLift-User`; set `OVERLAY_DEV_AUTH_TOKEN` and send `Authorization: Bearer <token>` outside demo mode until full GitHub user auth is wired.

---

## Project Structure

```
legacylift/
├── api/
│   ├── main.py               ← FastAPI routes, WebSocket endpoint
│   └── websocket_manager.py  ← WebSocket connection registry + event broadcast
├── extension/                 ← Chromium MV3 GitHub ownership overlay
├── core/
│   ├── layer0/               ← Archaeology (parse legacy, extract rules)
│   ├── layer0_5/             ← Target profile (docs, deprecations, gotchas)
│   ├── layer1/               ← Static analysis (syntax, types, complexity)
│   ├── layer2/               ← AI semantic review
│   ├── layer3/               ← Test generation + execution
│   ├── layer4/               ← Schema coverage validation
│   └── pipeline.py           ← Main orchestrator
├── models/                   ← Pydantic data models
├── ownership/
│   └── classifier.py         ← Simonra's ownership classifier
├── utils/
│   ├── llm_client.py         ← OpenAI wrapper with retry + DEMO_MODE logging
│   ├── code_parser.py        ← tree-sitter facade
│   └── schema_parser.py      ← SQL DDL parser
├── demo/
│   ├── sample_cobol/         ← Three realistic COBOL files
│   └── sample_schema/        ← Legacy bank SQL schema (8 tables)
└── tests/
    └── test_pipeline.py      ← End-to-end smoke tests
```

---

## Environment Variables

Copy `.env.example` to `.env` and configure:

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_API_KEY` | *(required)* | Your OpenAI API key |
| `OPENAI_MODEL` | `gpt-4o` | Model to use (gpt-4o-mini for dev) |
| `DEMO_MODE` | `true` | Print all LLM prompts; use stub data |
| `AUTO_APPROVE` | `false` | Skip human approval (demo only) |
| `DATABASE_URL` | SQLite | Database connection string |
| `LLM_MAX_RETRIES` | `3` | Max LLM retries per chunk |
| `GITHUB_APP_ID` | *(empty)* | GitHub App ID used for installation-token flows |
| `GITHUB_PRIVATE_KEY` | *(empty)* | GitHub App private key; keep real keys out of git |
| `GITHUB_WEBHOOK_SECRET` | *(empty)* | Shared secret for `X-Hub-Signature-256` verification |
| `GITHUB_CLIENT_ID` | *(empty)* | GitHub App OAuth client ID, reserved for later setup flows |
| `GITHUB_CLIENT_SECRET` | *(empty)* | GitHub App OAuth client secret, reserved for later setup flows |
| `OVERLAY_DEV_AUTH_TOKEN` | *(empty)* | Optional temporary bearer token for overlay mutations; `X-LegacyLift-User` is always required, and non-demo mode requires this token until full GitHub auth is wired |

---

## File-by-File Handoff

Every file has a status and a clear owner. The skeleton runs end-to-end with stub data today. Real features get wired in one file at a time.

| File | What it does | Status | Next developer implements |
|------|-------------|--------|--------------------------|
| `setup.bat` | One-click Windows setup (activate venv, install deps) | ✅ Done | — |
| `requirements.txt` | All pinned dependencies | ✅ Done | Add new packages here |
| `.env.example` | All environment variables documented | ✅ Done | Copy to `.env`, add `OPENAI_API_KEY` |
| `models/project.py` | `Project` + `UploadedFile` Pydantic models | ✅ Done | — |
| `models/business_rule.py` | `BusinessRule` + `OwnershipResult` models | ✅ Done | — |
| `models/chunk.py` | `MigrationChunk`, `TestResult`, analysis result models | ✅ Done | — |
| `models/validation.py` | `ValidationResult` + `ApprovalDecision` models | ✅ Done | — |
| `utils/llm_client.py` | OpenAI wrapper with retry + DEMO_MODE logging | ✅ Done | Model-specific prompt tuning |
| `utils/code_parser.py` | tree-sitter facade + COBOL regex fallback | 🔧 Stub | Wire real COBOL/Java tree-sitter grammar |
| `utils/schema_parser.py` | SQL DDL parser (handles `DECIMAL(15,2)`, no FK) | ✅ Done | `ALTER TABLE` support for schema evolution |
| `api/websocket_manager.py` | WebSocket registry + event broadcaster with replay | ✅ Done | Add auth check on connect |
| `api/main.py` | All REST routes + WebSocket endpoint | ✅ Done | Add JWT auth, swap in-memory store for DB |
| `core/pipeline.py` | Full sequential orchestrator — all 6 layers | ✅ Done | **Add the LLM call that generates `migrated_code` before Layer 1 runs** |
| `core/layer0/archaeologist.py` | Structural scanner + chunk builder | 🔧 Stub | Replace stub section detection with real tree-sitter COBOL parsing |
| `core/layer0/business_extractor.py` | LLM business rule extractor | 🔧 Stub | Harden `_parse_llm_response()`; add parallel file processing |
| `core/layer0/dependency_mapper.py` | Module call graph builder | 🔧 Stub | Replace regex `CALL` detection with AST walk + topological sort |
| `core/layer0/risk_scorer.py` | Per-file risk scoring (0.0–1.0) | 🔧 Stub | Calibrate weights with real migration data |
| `core/layer0_5/doc_fetcher.py` | Target language documentation fetcher | 🔧 Stub | Add real aiohttp URL fetching for Python stdlib docs |
| `core/layer0_5/deprecation_mapper.py` | COBOL→Python anti-pattern list | ✅ Done | Move database to YAML for non-developer contributions |
| `core/layer0_5/gotcha_registry.py` | Known migration pitfalls (COMP-3, date math, etc.) | ✅ Done | Move to YAML; add severity field |
| `core/layer1/static_analyser.py` | Syntax check + float-in-finance detection | ✅ Done | Add `radon` for complexity, `mypy` for type checking |
| `core/layer2/ai_reviewer.py` | LLM semantic equivalence reviewer | 🔧 Stub | Wire `self.gotchas` from Layer 0.5; harden JSON parsing |
| `core/layer3/test_generator.py` | LLM test generation + in-process runner | 🔧 Stub | Replace `exec()` runner with `subprocess` + JUnit XML parsing |
| `core/layer4/schema_validator.py` | Schema table coverage checker | 🔧 Stub | Replace text search with SQLAlchemy model reflection |
| `ownership/classifier.py` | **Simonra's ownership classifier** | ✅ Done | Deterministic keyword/alias scoring with custom groups; deepen optional git/docs evidence as real inputs arrive |
| `ownership/guidance.py` | Owner-aware change guidance | ✅ Done | Tune risk summaries and suggested tests with production review data |
| `demo/sample_cobol/interest_calc.cbl` | Tiered interest rate COBOL (BR-001–003, COMP-3) | ✅ Done | Demo data |
| `demo/sample_cobol/account_master.cbl` | Account lookup/update COBOL (reads 2 tables, writes 2) | ✅ Done | Demo data |
| `demo/sample_cobol/end_of_day_batch.cbl` | EOD batch orchestrator COBOL (most complex, 170 lines) | ✅ Done | Demo data |
| `demo/sample_schema/legacy_bank.sql` | 8-table legacy schema matching the COBOL files | ✅ Done | Demo data |
| `tests/test_pipeline.py` | Pipeline smoke tests — all passing | ✅ Done | Replace remaining stub assertions with semantic ones as layers are implemented |
| `tests/test_ownership_plan02.py` | Classifier, custom group, guidance, and persistence tests | ✅ Done | Add overlay API tests when Plan 04 exposes guidance |
| `Dockerfile` | Multi-stage production build, Azure-compatible PORT env var | ✅ Done | Bump VM size for prod load |
| `deploy.sh` | Azure Container Registry build + deploy script | ✅ Done | Set ACR name before running |
| `azure-deploy.md` | Step-by-step Azure App Service deployment guide | ✅ Done | — |

**Legend:** ✅ Done = working as-is, no changes needed to unblock others. 🔧 Stub = returns realistic dummy data, pipeline runs through it, needs real implementation.

---

## Developer Guide — Who Implements What

### Core Pipeline (`core/pipeline.py`)
The orchestrator is complete as a skeleton. The main TODO is adding the actual LLM call that generates `migrated_code` from `source_code` before Layer 1 runs.

### Layer 0 — Archaeology
- **`archaeologist.py`**: Replace stub section detection with real tree-sitter COBOL parsing.
- **`business_extractor.py`**: Wire to LLM. The prompt template is ready; `_parse_llm_response()` needs robustness testing.
- **`dependency_mapper.py`**: Replace regex `CALL` detection with tree-sitter AST walk; add topological sort.
- **`risk_scorer.py`**: Replace stub weights with calibrated real signals; add min-max normalisation.

### Layer 0.5 — Target Profile
- **`doc_fetcher.py`**: Add real URL fetching for Python stdlib docs.
- **`deprecation_mapper.py`**: Expand the pattern database from code to YAML.
- **`gotcha_registry.py`**: Same — move to YAML for non-developer contributions.

### Layer 1 — Static Analysis
- Replace complexity estimate with `radon` library.
- Add `mypy` API call for type checking.

### Layer 2 — AI Review
- `_parse_response()` needs production hardening (handle all LLM edge cases).
- Wire `self.gotchas` from pipeline after Layer 0.5 completes.

### Layer 3 — Test Generation
- Replace `exec()`-based runner with `subprocess.run` + JUnit XML parsing.
- Add test isolation (each test runs in its own temp directory).

### Layer 4 — Schema Validation
- Replace text-search with SQLAlchemy model reflection for stronger coverage checking.

### Ownership Classifier (`ownership/classifier.py`) — **Simonra**
- Backend ownership is now canonical for persisted overlay records.
- The classifier scores default and custom groups by keywords and aliases, records matched signals, and falls back to `Unknown` with low confidence when evidence is weak.
- Optional LLM fallback is conservative: malformed or unrecognized responses keep ownership as `Unknown`.
- `ownership/guidance.py` generates owner-aware approval checklists, suggested reviewer messages, merge risk, and boundary tests for threshold changes.
- The local frontend analyzer remains static/offline only and marks ownership as low-confidence inference.

### GitHub Overlay Extension

The Chromium extension in `extension/` renders persisted LegacyLift ownership annotations directly in GitHub PR file diffs and blob views. It calls the backend `GET /github/overlay` endpoint for visible file ranges, injects inline owner/confidence badges, opens a detail panel with change guidance, and sends review actions through `PATCH /github/overlay/annotation/{id}`.

Local checks:

```bat
cd extension
npm run type-check
npm test
```

Then load `legacylift\extension` as an unpacked Chromium extension and configure the overlay API base URL, reviewer identity, and optional `OVERLAY_DEV_AUTH_TOKEN` in the extension settings.

---

## Running Tests

```bat
.venv\Scripts\pytest legacylift/tests/ -v

REM For async tests (all pipeline tests are async):
.venv\Scripts\pytest legacylift/tests/ -v --asyncio-mode=auto
```

All tests pass in DEMO_MODE without an OpenAI key. The server suite is currently 57 tests and runs in under 10 seconds.

---

## Deploying to Azure

See [azure-deploy.md](server/azure-deploy.md) for the full step-by-step guide.

Quick deploy using `server/deploy.sh` (requires Azure CLI and Docker):

```bash
cd server

# Set your names once
export ACR_NAME=legacyliftacr
export RESOURCE_GROUP=legacylift-rg
export APP_NAME=legacylift

# Build, push, and deploy
./deploy.sh
```

The `/health` endpoint is used as the Azure App Service health probe.

---

## WebSocket Events

Connect to `ws://host/ws/{project_id}` to receive live pipeline events.

```json
{ "event": "archaeology_started",   "project_id": "proj-abc123", "timestamp": "..." }
{ "event": "business_rule_found",   "rule": { "id": "BR-001", "title": "..." } }
{ "event": "dependency_graph_ready","graph": { "interest_calc.cbl": ["account_master.cbl"] } }
{ "event": "risk_scores_ready",     "scores": { "end_of_day_batch.cbl": 0.85 } }
{ "event": "target_profile_ready",  "profile": { "language": "Python", ... } }
{ "event": "chunk_started",         "chunk_id": "chunk-001", "name": "CALC-INTEREST" }
{ "event": "static_analysis_complete", "passed": true, "issues": [] }
{ "event": "ai_review_complete",    "issues_found": 0 }
{ "event": "tests_complete",        "passed": 3, "failed": 0 }
{ "event": "chunk_ready_for_approval", "diff": "--- ...\n+++ ..." }
{ "event": "chunk_approved",        "chunk_id": "chunk-001" }
{ "event": "migration_complete",    "report": { ... } }
{ "event": "error",                 "layer": "Layer2", "message": "...", "recoverable": true }
```

Past events are replayed to newly-connected clients so they can reconstruct state.

---

*Built for Impe Hackathon 2026*
