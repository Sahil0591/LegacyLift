# Deploy LegacyLift on Render

This repo is configured as a Render Blueprint in `render.yaml`.

## 1. Push the repo to GitHub

Render needs access to a GitHub or GitLab repository. Commit and push:

```bash
git add render.yaml legacylift/client/lib/api.ts legacylift/client/lib/websocket.ts legacylift/server/api/main.py legacylift/RENDER_DEPLOY.md
git commit -m "Add Render deployment config"
git push
```

## 2. Create a Blueprint

In Render:

1. Go to **New +** -> **Blueprint**.
2. Connect this repository.
3. Keep the Blueprint file path as `render.yaml`.
4. When prompted, enter `VENICE_API_KEY`.
5. Click **Apply**.

Render will create:

- `legacylift-api`: FastAPI backend, built with `legacylift/server/Dockerfile`.
- `legacylift-client`: Next.js frontend, built from `legacylift/client`.

## 3. Verify

After both services deploy:

- Open `https://legacylift-api.onrender.com/health` or the backend URL Render shows. It should return `{"status":"ok","version":"0.1.0"}`.
- Open the frontend URL Render shows and run a migration flow.

The frontend gets the backend hostname from Render's `RENDER_EXTERNAL_HOSTNAME`, so you should not need to hardcode URLs. The backend CORS config gets the frontend hostname the same way.

## Notes

- Free Render services can sleep when idle, so the first request after inactivity may be slow.
- If you want demo-only hosting without a Venice key, change `DEMO_MODE` to `"true"` in `render.yaml` and redeploy.
- If you rename either service in Render, update the matching `fromService.name` references in `render.yaml`.
