# Plan 05 Handoff: Browser Extension Overlay

Branch: `codex/05-browser-extension-overlay`

Plan 05 commit: pending at handoff write time; use `git rev-parse --short HEAD` after the local commit created by this session.

## Summary

Implemented the Plan 05 Chromium MV3 browser extension only. The extension renders LegacyLift ownership badges inside GitHub PR file views and blob pages, opens a decision detail panel, calls the Plan 04 overlay API, and sends review/approval actions back to the backend mutation endpoint.

## Changed Files

- `legacylift/README.md`
- `legacylift/extension/README.md`
- `legacylift/extension/manifest.json`
- `legacylift/extension/options.html`
- `legacylift/extension/package.json`
- `legacylift/extension/tsconfig.json`
- `legacylift/extension/src/apiClient.js`
- `legacylift/extension/src/config.js`
- `legacylift/extension/src/contentScript.js`
- `legacylift/extension/src/githubDom.js`
- `legacylift/extension/src/githubUrl.js`
- `legacylift/extension/src/globals.d.ts`
- `legacylift/extension/src/options.css`
- `legacylift/extension/src/options.js`
- `legacylift/extension/src/renderer.js`
- `legacylift/extension/src/styles.css`
- `legacylift/extension/tests/apiClient.test.js`
- `legacylift/extension/tests/contentScript.test.js`
- `legacylift/extension/tests/fakeDom.js`
- `legacylift/extension/tests/githubDom.test.js`
- `legacylift/extension/tests/githubUrl.test.js`
- `legacylift/extension/tests/renderer.test.js`
- `legacylift/plans/github-decision-overlay/05-browser-extension-overlay.handoff.md`

## Implemented

- MV3 extension manifest for GitHub PR files pages and blob pages.
- GitHub URL parser for owner/repo, PR number, blob ref, and blob file path.
- GitHub DOM parser for visible files, visible line ranges, compact `visible_lines` query strings, and matching annotation line anchors.
- Overlay API client for `GET /github/overlay` and `PATCH /github/overlay/annotation/{id}` with reviewer identity and optional dev bearer token.
- Inline owner/confidence badges such as `Finance / Pricing - High`.
- Decision detail panel with criterion, owner, evidence, risk guidance, approval path, tests, suggested message, and action buttons.
- Review actions: confirm owner, reassign, flag, request approval, mark approved, waive, copy message, and open in LegacyLift.
- Settings/auth popup for API base URL, LegacyLift app URL, reviewer identity, dev token, and extension enablement.
- GitHub SPA navigation watcher for `pushState`, `replaceState`, `popstate`, `turbo:render`, and `pjax:end`.
- Graceful states for backend unavailable, repository/ref not indexed or no annotations, unauthorized responses, disabled overlay, and missing visible file lines.
- Local loading and verification documentation.

## Verification

Run from `legacylift/extension`:

```bash
npm run type-check
npm test
```

Results:

- `npm run type-check`: passed
- `npm test`: `18` tests passed

Manual Chromium loading against a live GitHub page was not run in this session. The extension is documented for unpacked loading and the core behavior is covered with mocked GitHub DOM/unit tests.

## Known Gaps

- Full GitHub user authentication is still not wired; mutation auth continues to rely on Plan 04's temporary reviewer identity plus optional `OVERLAY_DEV_AUTH_TOKEN`.
- GitHub DOM selectors are intentionally MVP heuristics for current PR diff and blob markup; future GitHub markup changes may require selector updates.
- Blob URL parsing treats the first segment after `/blob/` as the ref, so branch names containing slashes need a later hardening pass.
- The detail panel `Open in LegacyLift` action links to the current workbench/demo entry point with query parameters; there is no dedicated annotation route yet.
- No Plan 06 review workflow state model changes were started.

## Linear

- Bundled Linear connector still cannot access `PT5-15` and returned `Issue not found`.
- Direct Linear API access with the provided key found `PT5-15` (`Build Chromium browser extension overlay for GitHub`) in `Backlog`.
- A Linear status comment should be posted after the local Plan 05 commit exists, so it can include the final commit hash.
