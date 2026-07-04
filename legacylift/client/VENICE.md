# Code-generation + review ("Regenerate" flow)

> **Architecture note:** Venice AI is **not** integrated in the frontend anymore.
> The browser never holds a Venice key, prompt, or SDK. The Next.js app calls the
> **Python backend**, which owns the only Venice client in the system
> (`server/utils/llm_client.py`). This keeps a strict client/server separation:
> all external API traffic is proxied through our own backend.

The backend exposes three endpoints that perform a single Venice call each for
one code unit:

| Backend route | Method | Purpose |
|---|---|---|
| `/llm/migrate` | POST | Generate the migrated unit (e.g. COBOL → Python) |
| `/llm/review`  | POST | AI semantic-equivalence review of a migrated unit |
| `/llm/tests`   | POST | Generate pytest tests for a migrated unit |

Frontend code: [`lib/migration.ts`](lib/migration.ts) issues authenticated
`fetch` requests to the backend (via [`lib/api.ts`](lib/api.ts) `apiPost`). The
workbench's **"Regenerate"** button on each chunk runs generate → review → tests
and updates the diff + checks. Prompts and the Venice client live in the backend
(`server/utils/migration_prompts.py`, `server/utils/llm_client.py`).

## Setup

No Venice variables go in `client/.env.local`. Configure the backend instead -
see [`server/.env.example`](../server/.env.example):

```bash
VENICE_API_KEY=your-venice-api-key     # server-only; never reaches the browser
VENICE_MODEL=openai-gpt-52-codex       # optional - any valid Venice model id
# VENICE_BASE_URL=https://api.venice.ai/api/v1   # optional override
```

The frontend only needs `NEXT_PUBLIC_API_URL` (or `NEXT_PUBLIC_API_HOST`) so it
knows where the backend lives.

Without `VENICE_API_KEY` on the server the endpoints return a clear `501`, and
the workbench surfaces the sanitized message - everything else still works on the
seeded demo data. Upstream Venice errors and rate limits are handled server-side
and returned as standardized, sanitized responses (no raw Venice status codes or
stack traces leak to the client).

## Request shapes

`POST /llm/migrate`
```json
{ "name": "INTEREST-CALC", "source_code": "…COBOL…",
  "source_lang": "COBOL", "target_lang": "Python",
  "business_rules": [{ "title": "…", "description": "…", "hardcoded_values": ["365"] }],
  "target_profile": { "language": "Python", "version": "3.12", "test_framework": "pytest", "notes": "…" } }
```
→ `{ "migrated_code": "…python…", "model": "…" }`

`POST /llm/review`
```json
{ "name": "INTEREST-CALC", "source_code": "…COBOL…", "migrated_code": "…python…" }
```
→ `{ "equivalent": true, "confidence": "High", "issues_found": 0,
     "critical_issues": [], "warnings": [], "suggestions": [], "ai_confidence": "High" }`

`POST /llm/tests`
```json
{ "name": "INTEREST-CALC", "migrated_code": "…python…", "target_lang": "Python" }
```
→ `{ "tests": [{ "name": "test_…", "purpose": "…" }], "code": "…pytest module…" }`
