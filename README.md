# LegacyLift v1

**Turning decades-old business software into modern, trustworthy code — with a human in the loop at every step.**

Banks, insurers, and governments still run on software written in languages like COBOL that few engineers alive today can read. Rewriting it by hand is slow and risky; letting AI rewrite it blindly is worse. LegacyLift takes the middle path: it uses AI to do the heavy lifting, but never ships a single line of new code until a human expert has reviewed and approved it.

## What it does

LegacyLift is a workbench that guides a team through modernizing legacy code, one reviewable piece at a time:

1. **Upload** the old source files (COBOL, Java, VB6, SQL, and related formats).
2. **Understand** — LegacyLift reads the code, explains the business rules hidden inside it in plain English, maps how everything connects, and flags the riskiest parts.
3. **Assign & confirm** — a domain expert confirms who owns each business rule before anything is touched, so institutional knowledge is captured, not lost.
4. **Migrate & check** — the AI rewrites each approved piece into the selected target language, then runs language-aware quality checks, an AI "second opinion" review, and generated tests for manual verification.
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

## Documentation

| Document | What's inside |
|----------|---------------|
| [`legacylift/README.md`](legacylift/README.md) | Getting started — project tour and a demo-mode quickstart. |
| [`legacylift/PIPELINE_DOCUMENTATION.md`](legacylift/PIPELINE_DOCUMENTATION.md) | Full operational reference — architecture, data flow, every API route, all environment variables, deployment topology, and operational notes. |
| [`legacylift/RENDER_DEPLOY.md`](legacylift/RENDER_DEPLOY.md) | Deployment guide for hosting the backend. |
| [`legacylift/plans/`](legacylift/plans/) | Design specs and implementation handoffs. |

New here? Start with [`legacylift/README.md`](legacylift/README.md).
