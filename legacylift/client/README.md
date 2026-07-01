# LegacyLift Frontend

> AI-assisted legacy code migration workbench — Next.js 14 frontend.
> Built for the **Conduct AI Hackathon 2026**.

---

## Quick Start

```bash
cd legacylift/client
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Environment variables

| Variable | Description | Default |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | Backend REST API base URL | `http://localhost:8000` |
| `NEXT_PUBLIC_WEBSOCKET_URL` | Backend WebSocket URL | `ws://localhost:8000` |
| `NEXT_PUBLIC_DEMO_MODE` | Load sample COBOL fixtures | `true` |

---

## Pages

| Route | File | Purpose |
|---|---|---|
| `/` | `app/page.tsx` | Landing page |
| `/demo` | `app/demo/page.tsx` | File upload + project creation |
| `/project/[id]` | `app/project/[id]/page.tsx` | Main workbench (3-column layout) |

---

## Architecture

```
hooks/usePipeline.ts   ← single source of truth for pipeline state
hooks/useWebSocket.ts  ← wraps lib/websocket.ts for React
lib/websocket.ts       ← WebSocket client with exponential backoff reconnect
lib/api.ts             ← REST API client for all backend endpoints
types/legacylift.ts    ← TypeScript interfaces mirroring backend Pydantic models
```

All state flows from `usePipeline` → props → components. No global state library is needed yet.

---

## WebSocket events handled

| Event | Layer | Component updated |
|---|---|---|
| `archaeology_started` | 0 | `ProgressSidebar` |
| `business_rule_found` | 0 | `BusinessRuleList` |
| `dependency_graph_ready` | 0 | `DependencyGraph` |
| `risk_scores_ready` | 0 | `RiskScorePanel` |
| `target_profile_ready` | 0.5 | `TargetProfile` |
| `chunk_started` | 1 | `ChunkDiffViewer` |
| `static_analysis_complete` | 1 | `AIReviewPanel` |
| `ai_review_complete` | 2 | `AIReviewPanel` |
| `test_result` | 3 | `TestResults` |
| `chunk_ready_for_approval` | 3 | `ApprovalControls` |
| `migration_complete` | 4 | `MigrationComplete` |
| `error` | any | error banner |

---

## What's a skeleton vs. what's real

**Already works:**
- All pages render without errors with placeholder/dummy data
- WebSocket client connects, reconnects with exponential backoff, and routes events
- `usePipeline` hook wires all WS events to component state
- All TypeScript types match backend Pydantic models exactly
- REST API client covers all endpoints (will error if backend is not running)
- Design system: dark theme, risk colours, ownership colours, status badges

**Needs real implementation:**
- `DependencyGraph`: layout uses a naive grid — replace with `dagre` for proper DAG layout
- `DeprecationMap` + `GotchaRegistry`: data is hardcoded — wire to `target_profile_ready` payload
- Demo COBOL file: create `public/assets/demo/PAYROLL.cbl` with a real sample file
- `MigrationComplete` download button: wire to `GET /api/projects/{id}/export`
- Business rule inline edit form (status → Edited with corrected description)
- Auth: JWT header injection in `lib/websocket.ts` and `lib/api.ts`

---

## Tech stack

- **Next.js 14** (App Router, server + client components)
- **TypeScript** (strict, no `any`)
- **Tailwind CSS** (dark design system)
- **Framer Motion** (page animations, viewport triggers)
- **ReactFlow** (dependency graph)
- **react-diff-viewer-continued** (side-by-side code diff)
- **Radix UI** (accessible primitives)
- **Lucide React** (icons)

---

## Deploy to Vercel

```bash
vercel deploy
```

`vercel.json` is pre-configured. Set environment variables in the Vercel dashboard.

---

## For hackathon judges

The frontend runs **fully in demo mode** without the backend:

1. Landing page (`/`) — full animation, all sections render
2. Demo page (`/demo`) — file upload UI works; submitting will show an API error since no backend is running, which is expected
3. Project page (`/project/anything`) — all panels render with placeholder data

To see the live pipeline, run the backend:
```bash
cd legacylift/server
python -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
python -m uvicorn api.main:app --port 8000
```

Then re-run the demo flow.
