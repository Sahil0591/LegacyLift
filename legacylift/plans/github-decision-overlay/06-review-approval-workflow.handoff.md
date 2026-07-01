# Plan 06 Handoff: Review + Stakeholder Approval Workflow

Branch: `codex/06-review-approval-workflow`

Plan 06 commit: pending at handoff write time; use `git rev-parse --short HEAD` after the local commit created by this session.

## Summary

Implemented the Plan 06 review and stakeholder approval workflow only. GitHub overlay annotations and LegacyLift workbench rule reviews now share review states, approval states, current/original owner fields, reviewer metadata, timestamps, reasons, source surface, and ordered audit trail serialization.

## Changed Files

- `legacylift/README.md`
- `legacylift/client/components/layer0/BusinessRuleCard.tsx`
- `legacylift/client/components/layer0/BusinessRuleList.tsx`
- `legacylift/client/components/shared/StatusBadge.tsx`
- `legacylift/client/hooks/usePipeline.ts`
- `legacylift/client/lib/api.ts`
- `legacylift/client/types/legacylift.ts`
- `legacylift/extension/README.md`
- `legacylift/extension/src/renderer.js`
- `legacylift/server/api/main.py`
- `legacylift/server/db/models.py`
- `legacylift/server/db/repositories.py`
- `legacylift/server/integrations/github_overlay.py`
- `legacylift/server/models/project.py`
- `legacylift/server/ownership/review_workflow.py`
- `legacylift/server/tests/test_github_overlay_api.py`
- `legacylift/server/tests/test_review_approval_workflow.py`
- `legacylift/plans/github-decision-overlay/06-review-approval-workflow.handoff.md`

## Implemented

- Shared review workflow state machine with actions for confirm owner, reassign owner, flag, request approval, mark approved, and waive approval.
- Review states: `Inferred`, `Confirmed`, `Reassigned`, `Flagged`.
- Approval states: `Approval needed`, `Approval requested`, `Approved`, `Waived`.
- Waived approval requires a reason.
- Persisted ownership reviews now store reviewer identity, review timestamp, approval timestamp, reason, and source surface.
- Overlay annotations serialize current owner, original inferred owner, canonical review/approval state labels, and ordered audit trail entries.
- Workbench `confirm-rule` endpoint accepts the same workflow actions and records in-memory audit state.
- Flagged workbench rules block `select-chunk` migration until resolved.
- Confirmed `Unknown` owner blocks unless explicitly confirmed with `allow_unknown_owner: true`.
- Business rule card/types can render current owner, original inferred owner, review state, approval state, guidance, and workflow actions.
- Extension detail panel shows original/current owner state and recent audit trail entries.

## BDD/TDD Coverage

- Confirm owner stores reviewer and timestamp.
- Reassign owner changes current owner while preserving original inferred owner.
- Flagged rules block migration.
- Approval requested updates approval state.
- Approved and waived states are serialized.
- Waived approval requires a reason.
- GitHub overlay and workbench use the same state labels and audit payload shape.
- Audit trail ordering is verified.
- Confirmed `Unknown` permits migration only with explicit override.

## Verification

Run from `legacylift/server`:

```bash
.venv/bin/python -m pytest tests -q
```

Result: passed, `83` tests passed with existing Pydantic/Pytest warnings.

Run from `legacylift/client`:

```bash
npm run type-check
```

Result: passed.

Additional Plan 05 regression checks run from `legacylift/extension`:

```bash
npm run type-check
npm test
```

Results: type-check passed; `18` extension tests passed.

`git diff --check`: passed.

## Generated/Unrelated Files

- `legacylift/client/tsconfig.tsbuildinfo` was modified by client type-checking and restored before staging.
- Preserved and did not stage pre-existing untracked plan specs, `.DS_Store`, and `legacylift/server/ownership/classifier 2.py`.

## Known Gaps

- Full GitHub user authentication remains out of scope; overlay mutations still use the temporary reviewer identity plus optional `OVERLAY_DEV_AUTH_TOKEN`.
- Workbench review state is in-memory for non-persisted project sessions; persisted DB review state is implemented for GitHub overlay records.
- The reusable `BusinessRuleCard` displays Plan 06 controls, but the current project overview still uses its compact business-rule row layout.
- No Plan 07 hardening or release-readiness work was started.

## Linear

- Bundled Linear connector could not access `PT5-16` and returned `Issue not found`.
- Direct Linear API access found `PT5-16` (`Add review and stakeholder approval workflow`), posted a completion comment, and moved the issue to `Done`.
