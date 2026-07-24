# LegacyLift Conduct-Track Presentation And Demo Script

This script frames LegacyLift for a Conduct-track demo: practical AI assistance, credible technical depth, visible human judgment, and claims scoped to what the deployed app and repo actually prove today.

<!-- conduct-demo:autogen:start -->

## Repo Snapshot (auto-generated)

_Last synced: 2026-06-30 14:29 UTC · branch `docs/layer0-demo-contract` · commit `0195bd4`_

### Deployed demo

- **Production (Vercel):** [https://legacy-lift-six.vercel.app/](https://legacy-lift-six.vercel.app/)
- **Fastest live path:** open deploy URL → **Map my codebase** → `/project/demo-loan-engine` (seeded COBOL loan-engine workbench, no backend required)
- **Interactive path:** [https://legacy-lift-six.vercel.app/demo](https://legacy-lift-six.vercel.app/demo) → paste a public GitHub repo or upload COBOL/SQL files → `/api/analyze` → workbench review

### Demo surfaces in this repo

**Client (Vercel primary)**

- `/demo`
- `/`
- `/project/{id}`

**Client API routes (Next.js)**

- `POST /api/analyze`
- `POST /api/migrate`
- `POST /api/review`
- `POST /api/tests`

**Server demo fixtures (COBOL/SQL banking)**

- `account_master.cbl`
- `end_of_day_batch.cbl`
- `interest_calc.cbl`
- `legacy_bank.sql`

**Default public repo on `/demo`**

- `github.com/aws-samples/aws-mainframe-modernization-carddemo`

**Auditable client risk rules (`client/lib/analyze.ts`)**

- Rule 1: touches money.
- Rule 2: packed-decimal precision.
- Rule 3: non-trivial financial arithmetic.
- Rule 4: blast radius from inbound calls.
- Rule 5: magic numbers.
- Rule 6: commented-out / dead code.
- Rule 7: external I/O / DB.
- Rule 8: size.

**Backend Layer 0 spine (optional local proof)**

- Base URL: `http://localhost:8000`
- Flow: `POST /project` → upload demo files → `POST /project/{{id}}/start` → `GET /project/{{id}}/rules` + `/graph`
- Contract details: `legacylift/docs/layer0_api_contract.md`

Re-run `python legacylift/scripts/sync_conduct_demo_script.py` after pulls, or rely on the GitHub Action on pushes to `main`.

<!-- conduct-demo:autogen:end -->

## One-Line Pitch

LegacyLift is an AI-assisted legacy migration workbench that maps COBOL banking code into business rules, dependencies, and risk scores — then migrates chunk by chunk with a human approving every step.

## Problem

Banks still run critical workflows on legacy COBOL systems backed by old relational schemas. The risk in migration is not just syntax translation. Teams need a shared map of what the code means, what data it touches, which rules are business-critical, how risky each chunk is, and who should approve changes.

Manual archaeology — reading paragraphs, tracing SQL, interviewing owners, building spreadsheets — is slow, expensive, and hard to audit. Jumping straight to AI code generation can produce confident rewrites of misunderstood policy.

## Core Insight

Safe migration starts with accountability before generation.

The first question is not "Can AI rewrite this COBOL?" It is "Can the team explain what the legacy system does, why each rule matters, what it depends on, how risky it is, and who must sign off?" LegacyLift uses AI inside a human-in-the-loop workbench: deterministic mapping first, AI-assisted migration second, human approval always.

## Product Workflow

The live product story on [legacy-lift-six.vercel.app](https://legacy-lift-six.vercel.app/) follows six gates:

1. **Connect** — paste a public GitHub repo or upload legacy source files.
2. **Map** — extract candidate business rules in plain English.
3. **Dependencies** — trace calls and data relationships in a graph.
4. **Risk** — score every node with explicit, auditable rules.
5. **Migrate** — generate target code and tests per chunk (Venice-backed when configured).
6. **Approve** — hard-stop for human approve, edit, or reject on every chunk.

Banking demo fixtures in-repo: `interest_calc.cbl`, `account_master.cbl`, `end_of_day_batch.cbl`, and `legacy_bank.sql`.

## 90-Second Pitch

"LegacyLift helps banks migrate legacy COBOL without losing the why.

Most demos jump straight to rewriting code. In regulated systems, the first problem is discovery: what business rules are buried in the code, what tables they touch, what depends on what, and who should approve a change.

We built an AI-assisted migration workbench. Paste a repo or upload COBOL files. LegacyLift maps business rules, builds a dependency graph, and scores risk with explicit rules — money keywords, call fan-in, hardcoded values, external I/O — not a black-box score.

Then migration happens chunk by chunk. AI proposes the rewrite and tests. A human approves, edits, or rejects every chunk before anything merges.

The deployed demo is live at legacy-lift-six.vercel.app. The core insight: AI can accelerate legacy migration only when it stays explainable, accountable, and human-in-the-loop."

## 3-Minute Demo Script

_Use the deployed app first: [https://legacy-lift-six.vercel.app/](https://legacy-lift-six.vercel.app/)_

1. **Landing + problem, 20 seconds**
   Open the site. Read the headline: "Migrate legacy code without losing the why." Say: "This is not a translator. It is a system of record for why legacy code behaves the way it does."

2. **Fast seeded path, 25 seconds**
   Click **Map my codebase** → `/project/demo-loan-engine`. Say: "This is a COBOL loan-engine workload with rules, graph, and risk already mapped — good when Wi-Fi or APIs are flaky."

3. **Overview: rules + ownership, 40 seconds**
   Stay on Overview. Pick one business rule (e.g. daily interest accrual or late-fee cap). Point to ownership signals (Finance, Compliance, Product). Say: "These are reviewable candidate rules with likely approval functions — not authoritative ownership."

4. **Overview: dependency graph + risk, 35 seconds**
   Show the graph and risk panel. Explain auditable scoring: money keywords, fan-in, hardcoded values, external I/O. Highlight one high-risk chunk and say: "This tells the team what to review first."

5. **Review: migrate + approve, 45 seconds**
   Switch to Review. Select a chunk, show generate → static check → AI review → tests → **Approve / Edit / Reject**. Say: "Nothing merges without a human. The pipeline hard-stops at every chunk."

6. **Live analyze path (optional), 30 seconds**
   Go to `/demo`. Paste a public GitHub COBOL repo or upload the banking demo files. Show `/api/analyze` populating a fresh workbench. Say: "Mapping is deterministic and auditable; AI is used for migration and review, not for the initial risk score."

7. **Honest close, 15 seconds**
   "Today we prove the full judge journey on the deployed workbench. The Python backend also exposes a Layer 0 archaeology API for local smoke tests — but the Conduct demo should lead with the live URL."

## Slide Outline

1. **Title** — LegacyLift: AI-assisted legacy migration workbench (Conduct AI · Imperial)
2. **Problem** — Legacy COBOL hides business policy; migration fails when teams skip discovery
3. **Core insight** — Accountability before generation
4. **Live demo** — [legacy-lift-six.vercel.app](https://legacy-lift-six.vercel.app/)
5. **Workflow** — Connect → Map → Dependencies → Risk → Migrate → Approve
6. **Banking demo** — COBOL batch + SQL schema fixtures
7. **Layer 0 archaeology** — Parse, extract rules, graph, score, suggest owners
8. **Human-in-the-loop** — Approve / edit / reject on every chunk
9. **What we prove today** — Deployed workbench + auditable mapping + gated migration
10. **Next** — Deeper backend pipeline layers, persistence, commit lineage

## Mapping To Conduct Judging Criteria

### Real-World Impact

- Targets a painful, high-stakes problem: regulated banking systems still on COBOL.
- Value is concrete: shorten discovery, reduce migration uncertainty, create a review trail before transformation.
- Claim speed-up for archaeology, triage, and gated migration — not overnight full-system replacement.

### Technical Execution

- Lead with the deployed demo: landing → seeded workbench or `/demo` analyze → review flow.
- Show concrete artifacts: business rules, dependency nodes/edges, risk levels, chunk diffs, test output, approval state.
- Mention deterministic `/api/analyze` (explicit risk rules in `client/lib/analyze.ts`) plus Venice routes for `/api/migrate`, `/api/review`, `/api/tests`.
- Optional proof path: backend Layer 0 at `http://localhost:8000` per `layer0_api_contract.md`.

### AI Usefulness

- AI assists migration generation, semantic review, and test synthesis — not the initial risk map.
- Emphasize reviewable evidence: rules, graph, diffs, reviewer comments, regeneration limits.
- Pair AI with deterministic parsing/scoring so the product is not a thin prompt wrapper.

### Product Thinking

- Matches how regulated teams work: engineers need dependency/risk context; business owners need plain-English rules and approval queues.
- Six-step workflow mirrors real migration governance: map before migrate, approve before merge.
- Seeded demo plus live analyze covers both stable judging and interactive credibility.

### Human-In-The-Loop And Trust

- Every chunk requires explicit human approval.
- Use honest language: "candidate rule," "likely owner," "review priority."
- Reject/regenerate paths and regen caps show the human stays in control.

### Demo Quality

- Prefer one strong path: seeded demo-loan-engine → one rule → one graph moment → one approve action.
- Keep the deployed URL visible on every slide after the title.
- If Venice keys fail, still demo mapping + static checks + seeded migration state.

## Fallback Demo Plan

**If Venice / migrate APIs fail**

- Stay on `/project/demo-loan-engine` and walk Overview + pre-seeded chunk state.
- Explain mapping and approval UX; skip live regeneration.

**If `/api/analyze` or GitHub fetch fails**

- Use the seeded demo project from the landing page CTA.
- Or upload local demo files from `server/demo/sample_cobol/` and `server/demo/sample_schema/`.

**If the deployed site fails**

- Run the client locally: `cd legacylift/client && npm run dev`.
- Fall back to backend smoke at `http://localhost:8000`: create project, upload four demo files, start pipeline, fetch rules/graph JSON.

**If everything fails**

- Deliver slides only: problem → six-step workflow → example rule → graph → risk formula → human approval loop.
- Say: "The repo and deployed URL document the intended Conduct path; today I am walking the architecture."

## Overclaims To Avoid

- Do not say commit/PR lineage is live for every analyzed repo — that depth is in the seeded loan-engine demo, not generic `/api/analyze` output.
- Do not say the client analyze step uses GPT-4o — mapping uses deterministic rules; Venice is for migrate/review/tests.
- Do not say risk scores are compliance-grade — they are auditable triage signals.
- Do not say ownership labels are authoritative — say "likely owner" or "approval function signal."
- Do not say LegacyLift completes unattended end-to-end production migration.
- Do not imply the backend Layer 0 path is what the Vercel deployment executes — the deployed demo is primarily the Next.js workbench.
- Do not claim full tree-sitter parsing in the client analyze path — COBOL units are split with paragraph/section heuristics.
- Do not claim persistence or enterprise auth unless shown separately.

## Speaker Notes

When challenged on scope:

"LegacyLift is not claiming to migrate a bank in three minutes. The Conduct demo proves a governed workflow: map legacy COBOL into reviewable rules and dependencies, score risk with explicit rules, migrate chunk by chunk with AI assistance, and keep a human as the final gate on every merge. The live demo is at legacy-lift-six.vercel.app."

To refresh this doc after repo changes:

```bash
python legacylift/scripts/sync_conduct_demo_script.py
```

Automation options:

- **Local:** run `legacylift/scripts/install_git_hooks.bat` (or `.sh`) once — `post-merge` and `post-checkout` hooks refresh the snapshot after pulls and branch switches.
- **CI:** pushes to `main` run `.github/workflows/sync-conduct-demo-script.yml`, which updates the auto-generated **Repo Snapshot** section and commits if needed.
