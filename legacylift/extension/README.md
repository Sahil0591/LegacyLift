# LegacyLift GitHub Overlay Extension

Chromium MV3 extension for rendering LegacyLift ownership and approval guidance inside GitHub PR diffs and blob views.

The detail panel shows the current owner, original inferred owner, review state, approval state, recommended approval path, suggested tests, stakeholder message, and recent audit trail entries returned by the shared LegacyLift overlay API.

## Local Loading

1. Start the LegacyLift backend on `http://localhost:8000`.
2. Open Chromium extension developer mode.
3. Choose **Load unpacked** and select `legacylift/extension`.
4. Open the extension settings and confirm:
   - Overlay API base URL: `http://localhost:8000`
   - LegacyLift app URL: `http://localhost:3000`
   - Reviewer identity: your GitHub handle or email
   - Dev auth token: the server `OVERLAY_DEV_AUTH_TOKEN` value, if configured
5. Open a supported GitHub page:
   - `https://github.com/*/*/pull/*/files*`
   - `https://github.com/*/*/pull/*/changes*`
   - `https://github.com/*/*/blob/*`

The extension sends `X-LegacyLift-User` on overlay reads and mutations. When the server has `OVERLAY_DEV_AUTH_TOKEN` configured, the same value must be saved in extension settings so reads and review actions include `Authorization: Bearer <token>`.

If Chrome reports a fetch failure against `localhost`, use `http://127.0.0.1:8000` for the API URL and `http://127.0.0.1:3000` for the app URL.

## Failure States

The overlay renders a non-blocking banner when it cannot draw badges:

- Backend unavailable
- Repository not indexed
- Pull request not synced yet
- User unauthorized
- Unsupported file type
- Empty annotation result

## Verification

```bash
npm run type-check
npm test
```
