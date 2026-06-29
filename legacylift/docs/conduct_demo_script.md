# Conduct Demo Script

This script frames the current LegacyLift Layer 0 demo for Conduct-style judging: clear problem, credible technical spine, visible human judgment, and no claims beyond the current repo.

## One-Line Pitch

LegacyLift turns legacy COBOL and SQL into an explainable migration map: business rules, dependency graph, risk scores, and ownership signals before anyone rewrites code.

## Problem Statement

Banks and regulated teams cannot safely modernize legacy systems by treating COBOL files as raw text. The hard part is not only translating syntax. Teams first need to know which paragraphs encode business policy, which data tables they touch, which chunks are risky, and which human owner should review the result.

LegacyLift's current demo focuses on that first mile: Layer 0 code archaeology.

## Target User

The primary user is a modernization lead, platform engineer, or engineering manager responsible for planning a migration of legacy banking software. Secondary users are business owners in Finance, Compliance, Risk, Ops, and Product who need to validate extracted rules before migration work proceeds.

## 90-Second Demo Script

1. Open with the legacy risk: "This is not a code translation problem first. It is a discovery and accountability problem."
2. Create a project and upload the demo COBOL files plus `legacy_bank.sql`.
3. Start the pipeline and point out that the current live backend route runs the lightweight Layer 0 path: parse files, extract business rules, build dependency graph, score risk.
4. Show the real-time events or final state: `layer0_complete`, rules extracted, chunk count, risk summary.
5. Show business rules grouped with owner signals such as Finance or Compliance.
6. Show the dependency graph and highlight that code chunks connect to other chunks and SQL data structures.
7. Close with the human-in-the-loop point: "The system does not claim migration is done. It tells the team what to review first and who should review it."

## 3-Minute Extended Demo Script

1. Problem setup, 20 seconds:
   "A bank wants to migrate a legacy COBOL batch system. The dangerous shortcut is to ask an LLM to rewrite everything. LegacyLift starts by building a reviewable map of the old system."

2. Upload flow, 25 seconds:
   Create a project, upload `interest_calc.cbl`, `account_master.cbl`, `end_of_day_batch.cbl`, and `legacy_bank.sql`. Explain that these are the shared demo fixtures in the repo.

3. Layer 0 run, 45 seconds:
   Start the pipeline. The backend route calls the lightweight `core.pipeline.run_pipeline`, then `core.layer0.run`. Layer 0 runs structural parsing, rule extraction, graph construction, and deterministic risk scoring.

4. Rule review, 45 seconds:
   Open the rule view. Explain that the current backend returns rule text, confidence, owner, owner reasoning, key variables, dependencies, and review flags. Pick one rule and describe why a Finance or Compliance reviewer would care.

5. Dependency and risk view, 35 seconds:
   Open the graph. Show that chunks become nodes with `filename`, `language`, `risk_level`, and `risk_score`; edges show calls or data relationships. Highlight the highest-risk batch or reconciliation chunk if present.

6. Human-in-the-loop close, 30 seconds:
   "LegacyLift is deliberately not an autopilot. It creates a shared contract between engineers and business owners, then queues risky chunks for human approval before deeper migration."

7. Honest status, 20 seconds:
   State that the current live `/start` spine is Layer 0. Layers 0.5 through 4 are scaffolded or present in the older pipeline class path, and frontend/backend field adapters are still needed for full wire compatibility.

## Judging Criteria Map

### Technical Execution

- Demonstrate a real backend route sequence: project creation, upload, start, Layer 0 run, WebSocket completion, rules, and graph.
- Point to concrete outputs: `rule_count`, `node_count`, `edge_count`, `risk_summary`, and owner labels.
- Be explicit that the current server routes are unprefixed (`/project`) unless a proxy adds `/api`.
- Use the smoke-test evidence trail if challenged: it expects `pipeline_started`, `layer0_complete`, and `analysis_complete` in order.

### Speed-Up Factor

- Claim speed-up for discovery and triage, not full migration.
- Suggested phrasing: "In minutes, the team gets an initial map of rules, dependencies, and review priorities that would usually require manual reading across multiple files."
- Avoid claiming production-grade automated translation.

### Human-In-The-Loop Design

- Emphasize `needs_review`, owner labels, owner reasoning, approval/rejection routes, and risk scoring.
- Explain that business owners review policy meaning while engineers review implementation risk.
- Position the tool as a decision-support workbench, not a system of record.

### Demo/Presentation

- Keep the narrative concrete: upload demo files, run Layer 0, inspect rules, inspect graph, explain ownership.
- Show one high-value example rather than scrolling through every output.
- If the frontend is not wire-compatible, use the backend smoke test or API JSON responses as the proof path.

### Originality/Insight

- The insight is that migration readiness starts with accountability: what the code means, what it touches, how risky it is, and who can sign off.
- LegacyLift combines parser output, business-rule extraction, dependency graphing, and ownership classification into one review spine.
- The pitch should focus on reducing uncertainty before code generation.

## Fallback Demo If Backend, LLM, Or Client Fails

If the client fails:

- Use the backend smoke path directly against `http://localhost:8000`.
- Run or describe the existing server smoke test flow: health check, create project, upload four demo files, start pipeline, wait for WebSocket events, fetch rules, fetch graph.
- Show JSON responses for `/project/{id}/rules` and `/project/{id}/graph`.
- Say explicitly that the UI contract still needs an adapter for route prefixes, project IDs, rule fields, graph node fields, and WebSocket event names.

If the LLM path fails:

- Set or explain `DEMO_MODE=true`.
- State that the demo uses deterministic/hardcoded business-rule stubs for known COBOL paragraph names.
- Keep the claim to pipeline shape and review UX, not LLM accuracy.

If the backend fails:

- Use the checked-in demo files and the docs as a static walkthrough.
- Show the intended sequence and response shapes from `layer0_api_contract.md`.
- Use frontend demo data only as a visual mock, clearly labeled as seeded demo state.

If everything fails:

- Deliver the story as a five-slide narrative: problem, uploaded legacy files, Layer 0 architecture, example rule/graph output shape, human review loop.
- Keep the claim to "current repo has a documented Layer 0 contract" rather than "the full product is live."

## Overclaims To Avoid

- Do not say LegacyLift completes end-to-end migration today. Current `run_pipeline` completes Layer 0 and marks the project `ready`.
- Do not say the frontend and backend are fully wire-compatible today. The docs list known field and route mismatches.
- Do not say the graph is a complete program dependency graph. It is the current parser and Layer 0 graph output.
- Do not say ownership is authoritative. It is a recommendation signal for review routing.
- Do not say risk scores are compliance-grade. They are deterministic demo triage signals.
- Do not say the LLM path is validated. The reliable demo path is `DEMO_MODE=true`.
- Do not say uploaded SQL is typed correctly end to end. Current upload assigns `SourceLanguage.COBOL` to every uploaded file.
- Do not claim persistence. Project state is currently in memory.
- Do not imply the older `MigrationPipeline.run()` class is what `/project/{id}/start` executes today; the route starts the lightweight `run_pipeline(project)` coroutine.

## Speaker Notes

Use this phrasing when challenged on scope:

"The current repo proves the Layer 0 demo spine: upload legacy files, parse them, extract reviewable rules, build a graph, score risk, and emit real-time completion. The honest next step is contract alignment between the backend dataclass outputs and the frontend presentation types."
