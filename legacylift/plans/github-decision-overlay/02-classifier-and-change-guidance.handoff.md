# Plan 02 Handoff: Classifier + Change Guidance

## Status

Completed locally on branch `codex/02-classifier-change-guidance`.

Plan 03 was not started in this session.

## Implemented

- Replaced the ownership classifier stub with deterministic backend classification:
  - Default groups: Finance, Compliance, Product, Risk, Ops, Engineering, Unknown.
  - Custom group support for `name`, `description`, `aliases`, `color`, and `is_default`.
  - Alias scoring and custom-group precedence.
  - Matched signal capture, `review_status`, and conservative `Unknown` fallback.
  - Optional LLM fallback for weak evidence only; malformed responses stay `Unknown`.
- Added owner-aware change guidance:
  - Risk summary.
  - Primary and secondary approval groups.
  - Approval checklist.
  - Threshold boundary test suggestions.
  - Suggested reviewer message.
  - Merge-risk calculation.
- Persisted classifier and guidance output into Plan 01 database tables:
  - `ownership_classifications` now uses backend classifier output.
  - `change_guidance` is upserted once per decision criterion.
  - `decision_criteria.evidence_json` records original Layer 0 owner hints and classifier evidence.
- Updated backend models and client types to accept custom owner strings.
- Kept the local frontend analyzer static/offline and explicitly low-confidence.
- Updated `legacylift/README.md` to reflect the classifier/guidance behavior.

## Changed Files

- `legacylift/server/ownership/classifier.py`
- `legacylift/server/ownership/guidance.py`
- `legacylift/server/models/business_rule.py`
- `legacylift/server/db/repositories.py`
- `legacylift/server/tests/test_ownership_plan02.py`
- `legacylift/client/types/legacylift.ts`
- `legacylift/client/lib/analyze.ts`
- `legacylift/README.md`

## Verification

From `legacylift/server`:

```bash
.venv/bin/python -m pytest tests -q
```

Result: `57 passed`.

From `legacylift/client`:

```bash
npm run type-check
```

Result: passed after running `npm ci` because `node_modules` was not present. `npm ci` reported 2 audit findings (1 moderate, 1 high); dependency versions were not changed.

## Linear

The bundled Linear connector was still pointed at the wrong workspace and returned unrelated `RET-*` issues. Using the provided Linear API key directly against Linear GraphQL, both mapped issues were found and commented:

- `PT5-11`: [Implement functional ownership classifier and custom groups](https://linear.app/pt5/issue/PT5-11/implement-functional-ownership-classifier-and-custom-groups#comment-f24e7903)
- `PT5-12`: [Generate owner-aware change guidance for risky code changes](https://linear.app/pt5/issue/PT5-12/generate-owner-aware-change-guidance-for-risky-code-changes#comment-37d3df25)

## Known Gaps

- Git evidence still extracts the most recent author from provided git log text; it does not yet inspect hunks around exact line ranges.
- Docs search is only acknowledged as corroborating context when provided; there is no external docs connector/search wired yet.
- Change-guidance text is deterministic and should be tuned as real reviewer feedback accumulates.
- No overlay API or GitHub App ingestion work was started; those belong to later plans.
