# LegacyLift

**Turning decades-old business software into modern, trustworthy code — with a human in the loop at every step.**

Banks, insurers, and governments still run on software written in languages like COBOL that few engineers alive today can read. Rewriting it by hand is slow and risky; letting AI rewrite it blindly is worse. LegacyLift takes the middle path: it uses AI to do the heavy lifting, but never ships a single line of new code until a human expert has reviewed and approved it.

## What it does

LegacyLift is a workbench that guides a team through modernizing legacy code, one reviewable piece at a time:

1. **Upload** the old source files (COBOL, Java, VB6, SQL, and related formats).
2. **Understand** — LegacyLift reads the code, explains the business rules hidden inside it in plain English, maps how everything connects, and flags the riskiest parts.
3. **Assign & confirm** — a domain expert confirms who owns each business rule before anything is touched, so institutional knowledge is captured, not lost.
4. **Migrate & check** — the AI rewrites each approved piece into modern Python, then automatically runs quality checks, an AI "second opinion" review, and generated tests.
5. **Approve** — a human gives the final sign-off on each piece. Nothing is accepted automatically.

The result is a modernization process that is **auditable, resumable, and safe** — every decision, review, and test result is recorded.

## Why it stands out

- **Human approval gates, not blind translation** — AI accelerates the work; people stay in control of what's accepted.
- **Explains the "why," not just the "what"** — it surfaces the business rules buried in old code so nothing is lost in translation.
- **Built-in quality safety net** — static analysis, an adversarial AI review, and auto-generated tests run on every migrated piece.
- **Meets reviewers where they already work** — a companion GitHub browser extension shows ownership and approval decisions directly inside GitHub pull requests.
- **Production-ready** — deployed and running live across managed cloud services.

## How it's built (at a glance)

| Part | Technology |
|------|------------|
| Web workbench | Next.js 14 + React (hosted on Vercel) |
| Backend & AI pipeline | Python / FastAPI (hosted on Render) |
| Database | PostgreSQL (Neon) |
| AI model | Venice AI — `openai-gpt-52-codex` ("Codex 52") |
| Sign-in | Clerk |
| GitHub overlay | Chromium (Manifest V3) browser extension |

```text
legacylift/
├── client/      # Next.js workbench (the UI reviewers use)
├── server/      # FastAPI backend, AI migration pipeline, APIs
├── extension/   # Chromium extension for GitHub pull-request overlays
└── plans/       # Design specs and implementation handoffs
```

## Try it locally (quickstart)

Requires Python 3.12 and Node.js 20+. This runs in **demo mode** — no API keys or external accounts needed.

```bash
# 1. Backend
cd legacylift/server
python -m venv .venv && . .venv/bin/activate      # Windows: .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m uvicorn api.main:app --reload --port 8000

# 2. Frontend (in a second terminal)
cd legacylift/client
npm install
npm run dev        # open http://localhost:3000
```

> By design, the local setup defaults to a self-contained **demo mode** and does not connect to external AI or database services. The live production deployment runs fully connected across Vercel, Render, and Neon.

## Documentation & deep dives

This README is the high-level tour. For the technical detail, see:

| Document | What's inside |
|----------|---------------|
| [`PIPELINE_DOCUMENTATION.md`](./PIPELINE_DOCUMENTATION.md) | Full operational reference — architecture, data flow, every API route, all environment variables, deployment topology, and operational notes. |
| [`RENDER_DEPLOY.md`](./RENDER_DEPLOY.md) | Deployment guide for hosting the backend. |
| [`server/.env.example`](./server/.env.example) | Every backend configuration variable, documented inline. |
| [`client/.env.local.example`](./client/.env.local.example) | Frontend configuration variables. |
| [`plans/`](./plans/) | Design specs and implementation handoffs for the GitHub Decision Overlay. |

Component setup guides (backend, frontend, browser extension, GitHub App, database/Neon) and the full environment reference live in [`PIPELINE_DOCUMENTATION.md`](./PIPELINE_DOCUMENTATION.md).
