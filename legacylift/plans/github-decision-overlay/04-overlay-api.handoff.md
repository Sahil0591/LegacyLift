# Plan 04 Handoff: Overlay API

Branch: `codex/04-overlay-api`

Plan 04 commit: pending at handoff write time; use `git rev-parse --short HEAD` after the local commit created by this session.

## Summary

Implemented the Plan 04 backend overlay API only. The server now exposes extension-facing endpoints for retrieving persisted GitHub code annotations and mutating ownership review or approval state.

## Changed Files

- `legacylift/README.md`
- `legacylift/server/.env.example`
- `legacylift/server/api/main.py`
- `legacylift/server/api/github_overlay.py`
- `legacylift/server/db/models.py`
- `legacylift/server/db/repositories.py`
- `legacylift/server/integrations/github_overlay.py`
- `legacylift/server/tests/test_github_overlay_api.py`
- `legacylift/plans/github-decision-overlay/04-overlay-api.handoff.md`

## Implemented

- `GET /github/overlay` with required `owner`, `repo`, `path`, and either `ref` or `pull_number`.
- Optional `start`/`end` and `visible_lines` filtering with line-range overlap matching.
- Ref lookup by commit SHA, exact stored ref, or `refs/heads/{ref}` branch shorthand.
- PR lookup through persisted pull request changed files, hunks, and hunk-to-code-chunk matches.
- Normalized response annotations including chunk id, line range, criterion, owner, original owner, confidence, evidence, review status, approval status, change guidance, and available actions.
- `PATCH /github/overlay/annotation/{id}` mutations for confirm owner, reassign owner, flag, request approval, mark approved, and waive approval with required reason.
- Append-only `OwnershipReview` action records for overlay mutations, preserving the original inferred owner while future overlay reads use the latest owner/status.
- Temporary/dev mutation auth: `X-LegacyLift-User` is required; outside demo mode `OVERLAY_DEV_AUTH_TOKEN` must be configured and sent as `Authorization: Bearer <token>`.

## Verification

Run from `legacylift/server`:

```bash
.venv/bin/python -m pytest tests/test_github_overlay_api.py -q
.venv/bin/python -m pytest tests -q
```

Results:

- `tests/test_github_overlay_api.py`: `13 passed, 6 warnings`
- Full server suite: `79 passed, 36 warnings`

## Known Gaps

- Full GitHub user authentication is not implemented; Plan 04 uses a temporary reviewer header plus optional dev bearer token for mutations.
- Existing SQLite databases created before this plan need a schema migration or recreation for the updated `ownership_reviews` shape (`action` column and append-only review records). Fresh test databases use `create_all` and pass.
- The overlay response is generated from canonical chunk, criterion, classification, review, and guidance records; the older `github_overlay_annotations` table remains unused.
- Plan 05 browser extension, Plan 06 broader review workflow, and Plan 07 hardening were intentionally not started.

## Linear

Could not update `PT5-14` from this session. The bundled Linear connector returned `Entity not found` for `PT5-14`, and workspace search for `PT5-14 overlay API GitHub Decision Overlay` resolved unrelated `RET-*` issues in a different workspace. No Linear comment was created.
