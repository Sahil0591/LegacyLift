# Venice code-generation + review (Node)

The Next.js app exposes two server routes that call **Venice AI** (OpenAI-compatible)
to do the migration's code generation and semantic review:

| Route | Method | Purpose |
|---|---|---|
| `/api/migrate` | POST | Generate the migrated unit (e.g. COBOL → Python) |
| `/api/review` | POST | AI semantic-equivalence review of a migrated unit |

Code: [`lib/venice.ts`](lib/venice.ts) (client), [`lib/prompts.ts`](lib/prompts.ts)
(prompts), [`app/api/migrate/route.ts`](app/api/migrate/route.ts),
[`app/api/review/route.ts`](app/api/review/route.ts). The browser calls them via
[`lib/migration.ts`](lib/migration.ts); the workbench's **"Regenerate with Venice"**
button on each chunk runs generate → review and updates the diff + checks.

## Setup

Create `client/.env.local` with:

```bash
VENICE_API_KEY=your-venice-api-key      # required (server-only, never sent to the browser)
VENICE_MODEL=qwen-2.5-coder-32b         # optional — any valid Venice model id
# VENICE_BASE_URL=https://api.venice.ai/api/v1   # optional override
```

Get a key with API access at <https://venice.ai>, then restart `npm run dev`.

Without `VENICE_API_KEY` the routes return a clear `501` and the workbench shows
an inline "VENICE_API_KEY is not set" message — everything else still works on
the seeded demo data.

## Request shapes

`POST /api/migrate`
```json
{ "name": "INTEREST-CALC", "sourceCode": "…COBOL…",
  "sourceLang": "COBOL", "targetLang": "Python",
  "businessRules": [{ "title": "…", "description": "…", "hardcoded_values": ["365"] }],
  "targetProfile": { "language": "Python", "version": "3.12", "test_framework": "pytest", "notes": "…" } }
```
→ `{ "migrated_code": "…python…", "model": "…" }`

`POST /api/review`
```json
{ "name": "INTEREST-CALC", "sourceCode": "…COBOL…", "migratedCode": "…python…" }
```
→ `{ "equivalent": true, "confidence": "High", "issues_found": 0,
     "critical_issues": [], "warnings": [], "suggestions": [], "ai_confidence": "High" }`
