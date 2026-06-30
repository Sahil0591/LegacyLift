# LegacyLift Conduct-Track Presentation And Demo Script

This script frames LegacyLift for a Conduct-track demo: practical AI assistance, credible technical depth, visible human judgment, and no claims beyond what this repository can show today.

**Keep in sync:** auto-generated sections below refresh from the repo via `python legacylift/scripts/sync_conduct_demo_script.py`. Install git hooks with `legacylift/scripts/install_git_hooks.bat` so pulls and branch switches update the snapshot automatically.

## One-Line Pitch

LegacyLift is an AI-assisted legacy migration workbench that turns COBOL and SQL into reviewable business rules, a dependency graph, risk scores, and approval owners before anyone rewrites production code.

## Problem

Banks still run critical workflows on legacy COBOL systems backed by old relational schemas. The risk in migration is not just syntax translation. The real risk is that nobody has a current, shared map of what the code means, what data it touches, which rules are business-critical, and who is allowed to approve a change.

Modernization teams often start with manual archaeology: reading paragraphs, tracing SQL tables, interviewing business owners, and building spreadsheets of fragile assumptions. That work is slow, expensive, and hard to audit. Worse, jumping straight to AI code generation can produce confident rewrites of misunderstood policy.

LegacyLift focuses on the first safe mile: Layer 0 code archaeology, with humans approving meaning and migration risk before deeper transformation.

## Core Insight

Legacy migration should begin with accountability, not code generation.

The key question is not "Can an AI rewrite this COBOL?" It is "Can the team explain what this legacy system does, why each rule matters, what it depends on, how risky it is, and who must approve the migration?" LegacyLift uses AI as an analyst and migration assistant inside a human-in-the-loop workbench, turning legacy source into reviewable migration evidence.

## Product Workflow

1. Start from `/demo`: upload legacy files or point at a public GitHub repo.
2. Run Layer 0-style analysis to split code into units, extract candidate business rules, build a dependency graph, and score risk.
3. Open the workbench at `/project/{id}` and review the codebase map: rules, graph, and chunk queue sorted by risk.
4. For each high-risk chunk, generate migrated code (`/api/migrate`), run static checks, AI semantic review (`/api/review`), and optional tests (`/api/tests`).
5. Approve or reject each chunk with human judgment; rejected chunks can be regenerated with reviewer instructions.
6. Download the human-approved migration bundle when review is complete.

**Banking demo fixtures** (also used by the backend smoke path): `interest_calc.cbl`, `account_master.cbl`, `end_of_day_batch.cbl`, and `legacy_bank.sql`.

**Optional backend proof path:** create a project on the FastAPI server, upload the same fixtures, start Layer 0, and inspect `/project/{id}/rules`, `/project/{id}/graph`, and WebSocket events.

<!-- AUTO-GENERATED:REPO-SNAPSHOT:START -->
## Repo Snapshot (Auto-Generated)

> Synced from repo at `713f8bb` on 2026-06-30 14:26 UTC. Regenerate with `python legacylift/scripts/sync_conduct_demo_script.py`.

### Demo Paths In This Repo

| Path | Role | Best for Conduct demo |
|------|------|------------------------|
| Client workbench | `client/app/demo` → `POST /api/analyze` → `client/app/project/[id]` | **Primary live demo** — upload COBOL/SQL or a public GitHub repo; deterministic Layer 0-style analysis in Next.js; Venice-backed migrate/review via `/api/migrate` and `/api/review` |
| Backend Layer 0 API | `POST /project` → upload → start → WebSocket + `/rules` + `/graph` | **Secondary proof path** — FastAPI archaeology spine; use `server/smoke_test.py` or REST/WS JSON if the client is unavailable |

### Banking Demo Fixtures

- `server/demo/sample_cobol/account_master.cbl`
- `server/demo/sample_cobol/end_of_day_batch.cbl`
- `server/demo/sample_cobol/interest_calc.cbl`
- `server/demo/sample_schema/legacy_bank.sql`

### Backend Routes (`server/api/main.py`)

- `GET /health`
- `POST /project`
- `POST /project/{project_id}/upload`
- `POST /project/{project_id}/start`
- `POST /project/{project_id}/approve/{chunk_id}`
- `POST /project/{project_id}/reject/{chunk_id}`
- `POST /project/{project_id}/confirm-rule/{chunk_id}`
- `POST /project/{project_id}/select-chunk/{chunk_id}`
- `GET /project/{project_id}/status`
- `GET /project/{project_id}/rules`
- `GET /project/{project_id}/graph`
- `WS /ws/{project_id}`

- Default local base URL: `http://localhost:8000`
- Frontend proxy contract may expose these as `/api/project...`

### Client API Routes (`client/app/api`)

- `POST /api/analyze`
- `POST /api/migrate`
- `POST /api/review`
- `POST /api/tests`

- Analysis is deterministic (`client/lib/analyze.ts`); migration/review/tests use Venice when `VENICE_API_KEY` is set.

### Layer 0 Backend Spine Today

- Entry point: `core.pipeline.run_pipeline(project)` → `core.layer0.run(project)`
- Scope: Layer 0 (Code Archaeology) and transitions the.
- Key WebSocket events: `analysis_complete`, `pipeline_started`, `layer0_complete`, `ai_review_complete`, `archaeology_complete`, `archaeology_started`, `business_rule_found`, `chunk_approved`, `chunk_ready_for_approval`, `chunk_selected`, `chunk_started`, `dependency_graph_ready`, … (+10 more)
- Smoke test expects: `pipeline_started` → `layer0_complete` → `analysis_complete`

### Ownership / Approval Signals

- **Client analyze path:** Finance (money-related signals), Risk (SQL/table signals), Engineering (date/time/format signals), Unknown (fallback)
- **Backend Layer 0 rules:** fields include `id`, `chunk_id`, `rule`, `confidence`, `owner`, `owner_reasoning`, `key_variables`, `depends_on`, `needs_review`; treat `owner` as a review-routing signal, not authority.

### Regenerate This Section

```bash
python legacylift/scripts/sync_conduct_demo_script.py
```

After `git pull` or `git merge`, hooks in `.githooks/` can run this automatically if installed via `legacylift/scripts/install_git_hooks.bat`.
<!-- AUTO-GENERATED:REPO-SNAPSHOT:END -->

## 90-Second Pitch

"LegacyLift is an AI-assisted migration workbench for banks with critical COBOL systems.

Most modernization demos jump straight to rewriting code. In regulated systems, that is not the first problem. Before a bank can migrate, the team needs to know what the old system actually does, which business rules are embedded in the code, which tables are touched, which parts are risky, and who has authority to sign off.

Our demo uploads a small COBOL and SQL banking workload—or points at a public legacy repo. LegacyLift runs Layer 0 code archaeology and produces three things: plain-English business rules, a dependency graph, and risk and ownership signals. Reviewers then walk the chunk queue, approve AI-generated migrations one piece at a time, and reject anything that drifts from policy.

For example, an interest-calculation paragraph becomes a reviewable business rule, connected to the account data it depends on, scored for migration risk, and routed to a likely Finance or Compliance reviewer. The system is not claiming the migration is done. It is creating the evidence layer that lets engineers and business owners make safe migration decisions together.

The core insight is simple: AI can speed up legacy migration, but only if it stays explainable, accountable, and human-in-the-loop."

## 3-Minute Demo Script

**Recommended path:** client workbench (`npm run dev` in `legacylift/client`). **Fallback:** backend smoke test or REST/WS JSON.

1. Opening problem, 20 seconds:
   "Imagine a bank wants to migrate a legacy COBOL batch system. The risky shortcut is to ask AI to rewrite everything. LegacyLift starts earlier: what does this system do, what does it touch, how risky is each part, and who should approve changes?"

2. Start migration, 25 seconds:
   Open `/demo`. Choose **Upload files** and add `interest_calc.cbl`, `account_master.cbl`, `end_of_day_batch.cbl`, and `legacy_bank.sql`. Say: "This gives the workbench both application logic and the database context behind it."

3. Layer 0 archaeology, 35 seconds:
   Submit and land on `/project/local-…`. Explain that `/api/analyze` runs deterministic archaeology: unit splitting, business-rule extraction, dependency graph construction, and risk scoring—no LLM on this step.

4. Business-rule extraction, 35 seconds:
   Open Overview or the rules panel. Pick one rule and narrate it as a business artifact, not just code. "This is the kind of policy hidden in a COBOL paragraph that Finance or Compliance must validate before migration."

5. Ownership and approval, 25 seconds:
   Point to the likely owner signal. "LegacyLift does not make this owner authoritative. It suggests Finance, Risk, Engineering, or another approval function so the right human reviews it."

6. Dependency graph and risk, 30 seconds:
   Show the graph and chunk queue sorted by risk. Highlight a higher-risk batch or money-handling unit. "This gives the team a review order—start where business impact and coupling are highest."

7. Human-in-the-loop migration, 30 seconds:
   Select a chunk, generate migration, show AI review, and approve or reject. "AI accelerates discovery and draft migration, but humans approve meaning, risk, and rollout."

8. Honest scope, 10 seconds:
   "Today we prove the archaeology and review control plane. The backend also exposes a Layer 0 API spine; full multi-layer server orchestration is scaffolded beyond Layer 0."

## Slide Outline

1. Title: "LegacyLift: AI-Assisted Legacy Migration Workbench"
2. Problem: "Banks cannot safely modernize legacy COBOL by treating it as raw text."
3. Core Insight: "Safe migration starts with accountability before generation."
4. Demo System: "COBOL banking workload plus SQL schema—interest, accounts, end-of-day batch."
5. Layer 0 Code Archaeology: "Parse source, extract rules, build graph, score risk, suggest owners."
6. Product Workflow: "Analyze → review map → migrate chunk-by-chunk → human approve/reject."
7. Human-In-The-Loop Migration: "AI proposes evidence and drafts; people approve policy and risk."
8. Conduct Fit: "Practical AI for a regulated workflow with explainability and reviewability."
9. What We Prove Today: "A working archaeology and review spine on real legacy fixtures."
10. Next Step: "Use approved Layer 0 evidence to drive deeper migration planning and transformation."

## Mapping To Conduct Judging Criteria

### Real-World Impact

- Targets a painful, high-stakes problem: modernizing banking systems where legacy code still encodes live business policy.
- Value is concrete: shorten discovery, reduce migration uncertainty, and create an audit-friendly review trail before transformation.
- Claim acceleration of archaeology and triage—not unattended production migration.

### Technical Execution

- Primary demo: `/demo` → `POST /api/analyze` → workbench with rules, graph, chunk queue, migrate/review routes.
- Secondary proof: FastAPI Layer 0 (`POST /project`, upload, start, WebSocket, `/rules`, `/graph`) or `server/smoke_test.py`.
- Point to concrete outputs: rule count, graph nodes/edges, risk tiers, ownership signals, chunk approval state.

### AI Usefulness

- Deterministic analysis handles explainable archaeology; Venice-backed routes handle migration draft, semantic review, and tests when configured.
- Emphasize reviewable evidence and diff-based chunk approval—not silent autopilot rewrites.

### Product Thinking

- Matches how regulated teams work: engineers need dependency and risk context; business owners need plain-English rules and approval queues.
- Ownership signals route review to likely functions; risk scoring creates a prioritized queue.

### Human-In-The-Loop And Trust

- Approval, rejection, and regeneration with reviewer instructions stay with people.
- Use "likely owner," "candidate business rule," and "review priority" language.

### Demo Quality

- One journey: upload banking fixtures → inspect one strong rule → show graph → approve one chunk.
- If the UI fails, show `/api/analyze` JSON or backend `/rules` and `/graph` responses.

## Fallback Demo Plan

If the client fails:

- Run or describe `server/smoke_test.py` against `http://localhost:8000`.
- Walk through create project, upload four demo files, start pipeline, WebSocket events, then fetch `/project/{id}/rules` and `/project/{id}/graph`.
- Use `docs/layer0_api_contract.md` for response shapes.

If Venice / migrate fails:

- Stay on the analyze + review-map story; show deterministic rules, graph, and risk without generating migrated code.
- Say migration routes need `VENICE_API_KEY`; archaeology does not.

If the backend fails:

- Demo the client-only path: `/demo` upload → `/api/analyze` JSON → workbench with seeded local project state.
- Use checked-in demo files and this script as a static walkthrough.

If everything fails:

- Deliver the slide narrative: problem, COBOL/SQL workload, Layer 0 archaeology, example rule, graph, risk/ownership, human approval loop.

<!-- AUTO-GENERATED:OVERCLAIMS:START -->
## Overclaims To Avoid (Auto-Generated)

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
- Do not demo LLM accuracy when `DEMO_MODE` / deterministic stubs are doing the work. Backend layer0 default DEMO_MODE=true; pipeline module default DEMO_MODE=true.
<!-- AUTO-GENERATED:OVERCLAIMS:END -->

## Speaker Notes

Use this phrasing when challenged on scope:

"LegacyLift is not claiming to migrate a bank in three minutes. The Conduct demo proves the safety layer: upload legacy COBOL and SQL, extract reviewable business rules, build a dependency graph, score risk, suggest likely approval owners, migrate chunk-by-chunk with AI assistance, and keep humans in the loop before anything ships."

Manual overclaims to avoid in narration:

- Do not collapse the client analyze path and Venice migration path into one undifferentiated "AI does everything" claim.
- Do not demo GitHub repo ingestion unless network access to GitHub is confirmed.
- Do not present seeded demo project IDs (`demo`, `local-*`) as persisted enterprise project records.
