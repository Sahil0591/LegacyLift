# Plan 01 Handoff: Database + Persisted Code Chunks

Linear: PT5-10

Branch: `codex/01-database-persisted-chunks`

## Status

Completed locally.

## Changed Files

- `legacylift/server/db/__init__.py`
- `legacylift/server/db/models.py`
- `legacylift/server/db/session.py`
- `legacylift/server/db/repositories.py`
- `legacylift/server/tests/test_db_persistence.py`
- `legacylift/server/core/layer0/__init__.py`
- `legacylift/server/api/main.py`
- `legacylift/server/requirements.txt`
- `legacylift/server/.env.example`
- `legacylift/.env.example`
- `legacylift/.gitignore`
- `legacylift/server/utils/code_parser.py`

## What Changed

- Added async SQLAlchemy engine/session helpers with the default local SQLite URL `sqlite+aiosqlite:///./.data/legacylift.db`.
- Added ORM tables for repositories, commits, pull requests, code chunks, decision criteria, ownership groups, ownership classifications, ownership reviews, change guidance, and GitHub overlay annotations.
- Added idempotent repository helpers for default ownership group seeding, repo/commit/chunk/rule/classification/review upserts, and Layer 0 persistence.
- Wired Layer 0 to persist chunks and decision criteria after existing in-memory project serialization, while logging and continuing if DB writes fail.
- Initialized DB schema during FastAPI startup.
- Documented `DATABASE_URL` and ignored local SQLite artifacts under `server/.data/`.
- Added a small `CodeParser` compatibility facade required by the existing backend smoke tests.

## Verification

Run from `legacylift/server`:

```bash
.venv/bin/python -m pytest tests/test_db_persistence.py -q
.venv/bin/python -m pytest tests -q
```

Results:

- `8 passed in 0.34s`
- `49 passed, 36 warnings in 1.20s`

Warnings are pre-existing Pydantic v2 deprecation warnings and a pytest collection warning for an existing class named `TestGenerator`.

## Linear Update

Attempted to comment on `PT5-10`, but the connected Linear workspace did not contain that issue identifier. Search results only returned unrelated `RET-*` issues, so the Linear update is blocked by workspace/access mismatch.

## Known Gaps

- No migrations are generated yet; this phase uses `Base.metadata.create_all()` for local schema creation.
- Layer 0 local uploads use synthetic repository identity (`local-upload` / project id) and commit SHA (`local-{project.id}`) until GitHub ingestion supplies real repository/ref metadata in Plan 03.
- No remote push or PR was created per goal instructions.
