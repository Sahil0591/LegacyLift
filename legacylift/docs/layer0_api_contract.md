# LegacyLift Layer 0 API Contract

This document describes the current Layer 0 demo spine in this repository so backend, frontend, and presentation work can align without guessing.

## Current Demo Spine

The alignment contract for the pitch/demo sequence is:

1. `POST /api/project`
2. `POST /api/project/{id}/upload`
3. `POST /api/project/{id}/start`
4. `core.pipeline.run_pipeline(project)`
5. `core.layer0.run(project)`
6. `layer0_complete` WebSocket event
7. `GET /api/project/{id}/rules`
8. `GET /api/project/{id}/graph`

Current server implementation detail: `server/api/main.py` registers the FastAPI routes without an `/api` prefix. Treat `/api/...` as the frontend/proxy-facing contract and `/project...` as the current direct FastAPI route surface:

1. `POST /project`
2. `POST /project/{id}/upload`
3. `POST /project/{id}/start`
4. `GET /project/{id}/rules`
5. `GET /project/{id}/graph`
6. `WS /ws/{project_id}`

The standalone server smoke test uses the unprefixed routes on `http://localhost:8000`, plus `ws://localhost:8000/ws/{project_id}` for events.

## Request And Response Flow

### `POST /project`

Request body:

```json
{
  "name": "Migration"
}
```

Response body:

```json
{
  "id": "proj-...",
  "name": "Migration",
  "status": "created",
  "created_at": "2026-06-30T00:00:00.000000"
}
```

### `POST /project/{id}/upload`

Request body is multipart form data with one or more `files` fields. The current backend stores every upload as `SourceLanguage.COBOL`, including `legacy_bank.sql`.

Response body:

```json
{
  "project_id": "proj-...",
  "files_uploaded": ["interest_calc.cbl", "account_master.cbl"],
  "file_count": 2
}
```

### `POST /project/{id}/start`

Starts the background pipeline and returns immediately.

Response body:

```json
{
  "status": "accepted",
  "project_id": "proj-...",
  "message": "Pipeline started"
}
```

The route accepts projects in `created` or `uploading` status. Other statuses return `409`.

## Layer 0 Runtime Sequence

The live route in `server/api/main.py` starts the lightweight `run_pipeline(project)` coroutine, not the older `MigrationPipeline.run()` class path. That coroutine currently implements Layer 0 and then marks the project `ready`. Layers 0.5 through 4 are present as TODO/stub paths and are not part of the direct `/project/{id}/start` demo path.

Layer 0 steps inside `core.layer0.run(project)`:

1. Structural scan: `utils.code_parser.parse_file(filename, content)` parses COBOL, Java, and SQL.
2. Business rule extraction: demo stubs when `DEMO_MODE=true`, Venice AI path when enabled.
3. Dependency graph: parser call edges, rule `depends_on` edges, and SQL data edges.
4. Risk scoring: deterministic score per chunk, with `Low`, `Medium`, `High`, or `Critical`.
5. Persistence: serializes rules to `project.layer0_rules` and graph to `project.layer0_graph`.
6. WebSocket: emits `layer0_complete`.

## `layer0_complete` WebSocket Payload

All WebSocket messages include `event`, `project_id`, and `timestamp` from `api.websocket_manager`.

`layer0_complete` currently adds:

```json
{
  "event": "layer0_complete",
  "project_id": "proj-...",
  "timestamp": "2026-06-30T00:00:00.000000+00:00",
  "chunk_count": 12,
  "rules_extracted": 12,
  "needs_review_count": 0,
  "risk_summary": {
    "Low": 4,
    "Medium": 6,
    "High": 2,
    "Critical": 0
  }
}
```

Related Layer 0 events emitted by `run_pipeline`:

- `pipeline_started`
- `archaeology_started`
- `business_rule_found`, once per serialized rule
- `dependency_graph_ready`
- `risk_scores_ready`
- `archaeology_complete`
- `analysis_complete`, with `status: "ready"`
- `pipeline_failed`, on error

The smoke test asserts the key event ordering `pipeline_started` → `layer0_complete` → `analysis_complete`.

## Current `/rules` Response Shape

`GET /project/{id}/rules` returns:

```json
{
  "project_id": "proj-...",
  "status": "ready",
  "rule_count": 12,
  "rules": [
    {
      "id": "rule_interest_calc__calc_interest",
      "chunk_id": "interest_calc__calc_interest",
      "rule": "Plain-English business rule.",
      "confidence": 0.95,
      "owner": "Finance",
      "owner_reasoning": "Why this owner was selected.",
      "key_variables": ["WS-BALANCE"],
      "depends_on": [],
      "needs_review": false,
      "extraction_error": null
    }
  ]
}
```

Rule fields are Layer 0 dataclass fields, not the presentation-facing TypeScript shape.

## Current `/graph` Response Shape

`GET /project/{id}/graph` returns:

```json
{
  "project_id": "proj-...",
  "node_count": 12,
  "edge_count": 8,
  "nodes": [
    {
      "id": "interest_calc__calc_interest",
      "label": "CALC-INTEREST",
      "filename": "interest_calc.cbl",
      "language": "cobol",
      "risk_level": "Medium",
      "risk_score": 3
    }
  ],
  "edges": [
    {
      "source": "interest_calc__main",
      "target": "interest_calc__calc_interest",
      "edge_type": "call"
    }
  ]
}
```

Graph edge types currently include `call`, `data_read`, `data_write`, and `unknown`.

## Known Frontend/Backend Mismatches

- Route prefix: frontend API helpers call `/api/project...`; FastAPI registers `/project...`.
- REST default port: frontend code defaults to `http://localhost:8080`; server and smoke test use `http://localhost:8000`.
- WebSocket default port: frontend defaults to `ws://localhost:8765`; server exposes `ws://localhost:8000/ws/{project_id}`.
- Create project response: backend returns `id`; frontend demo flow destructures `project_id`.
- Create project request: frontend sends `source_language` and `target_language`; backend only models `name`.
- Project status: backend uses `created`, `uploading`, `analysing`, `ready`, `failed`; frontend types expect `running_layer0`, `awaiting_rule_review`, `running_layer0_5`, `complete`, `error`.
- Business rule fields: backend returns `rule`, `chunk_id`, numeric `confidence`, `owner`, `owner_reasoning`, `key_variables`, and `needs_review`; frontend expects `title`, `description`, `source_file`, `source_lines`, string confidence, review `status`, warnings, and ownership fields.
- Graph node fields: backend returns `filename`, `language`, `risk_level`, `risk_score`; frontend expects `file` and `type`.
- Graph edge fields: backend returns `edge_type`; frontend expects optional `label`.
- WebSocket event types: backend emits `pipeline_started`, `layer0_complete`, `analysis_complete`, and `pipeline_failed`; current frontend event union does not list those.
- Approve/reject bodies: backend expects `comment` for approve and required `comment` for reject; frontend sends `reviewer_comment`.
- Rule update route: frontend calls `PATCH /rules/{ruleId}`; backend does not implement it.

## Recommended Adapter Mapping

Until the contract is made canonical, adapt the backend Layer 0 shape into the frontend presentation shape at the API/WS boundary.

Project creation:

```ts
const projectId = response.project_id ?? response.id;
```

Business rule:

```ts
const adaptedRule = {
  id: rule.id,
  title: rule.title ?? rule.chunk_id ?? rule.id,
  description: rule.description ?? rule.rule ?? "",
  source_file: rule.source_file ?? inferFileFromGraph(rule.chunk_id),
  source_lines: rule.source_lines ?? [0, 0],
  confidence:
    typeof rule.confidence === "number"
      ? rule.confidence >= 0.8
        ? "High"
        : rule.confidence >= 0.6
          ? "Medium"
          : "Low"
      : rule.confidence,
  hardcoded_values: rule.hardcoded_values ?? rule.key_variables ?? [],
  warnings: rule.warnings ?? (rule.needs_review ? ["Needs review"] : []),
  status: rule.status ?? (rule.needs_review ? "Flagged" : "Pending"),
  ownership_category: rule.ownership_category ?? rule.owner ?? "Unknown",
  ownership_evidence: rule.ownership_evidence ?? rule.owner_reasoning ?? "",
  ownership_confidence: rule.ownership_confidence ?? "Low",
  ownership_detail: rule.ownership_detail ?? null,
};
```

Dependency graph:

```ts
const adaptedGraph = {
  nodes: graph.nodes.map((node) => ({
    id: node.id,
    label: node.label,
    file: node.file ?? node.filename ?? "",
    type: node.type ?? (node.language === "sql" ? "external" : "section"),
    risk_level: node.risk_level,
    risk_score: node.risk_score,
  })),
  edges: graph.edges.map((edge) => ({
    source: edge.source,
    target: edge.target,
    label: edge.label ?? edge.edge_type,
  })),
};
```

Approve/reject:

```ts
await approveChunk({ comment: "approved in demo" });
await rejectChunk({ comment: reason, feedback: reason });
```

## Demo Files Used

The server demo and smoke test use:

- `server/demo/sample_cobol/interest_calc.cbl`
- `server/demo/sample_cobol/account_master.cbl`
- `server/demo/sample_cobol/end_of_day_batch.cbl`
- `server/demo/sample_schema/legacy_bank.sql`

## Stable vs Demo-Only

Stable enough to align around for the hackathon:

- `utils.code_parser.parse_file(filename, source)` as the parser entry point.
- `core.layer0.run(project)` as the Layer 0 orchestration entry point.
- The lightweight `core.pipeline.run_pipeline(project)` path as the live `/start` demo runner.
- `project.layer0_rules` and `project.layer0_graph` as the current REST backing stores.
- `GET /project/{id}/rules` and `GET /project/{id}/graph` response wrappers.
- WebSocket envelope shape: `event`, `project_id`, `timestamp`, plus event payload.
- Demo files listed above as the shared backend/pitch fixture set.

Hackathon/demo-only or fragile:

- In-memory project storage; data is lost on server restart.
- No authentication or authorization around project routes or WebSockets.
- Upload currently assigns every file `SourceLanguage.COBOL`.
- `DEMO_MODE` defaults are inconsistent across modules.
- Layer 0.5 through Layer 4 are not part of the live `run_pipeline` path.
- Venice/LLM rule extraction is not the same reliability surface as `DEMO_MODE=true`.
- Frontend demo data can bypass the backend entirely when `NEXT_PUBLIC_DEMO_MODE=true`.
- The `/api` prefix is a deployment/proxy concern, not a route registered by `server/api/main.py`.
