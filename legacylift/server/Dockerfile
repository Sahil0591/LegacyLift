# =============================================================================
# LegacyLift — Dockerfile
# =============================================================================
# Multi-stage build:
#   Stage 1 (builder): install Python deps into a venv
#   Stage 2 (runtime): copy only the venv and source, no build tools
#
# The result is a lean ~300MB image vs ~600MB single-stage.
#
# Build:  docker build -t legacylift .
# Run:    docker run -p 8000:8000 -e PORT=8000 --env-file .env legacylift
# =============================================================================

# ---------------------------------------------------------------------------
# Stage 1: Builder
# ---------------------------------------------------------------------------
FROM python:3.12-slim AS builder

WORKDIR /build

# Install build dependencies (needed for some C-extension packages)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    git \
    && rm -rf /var/lib/apt/lists/*

# Copy only requirements first to leverage Docker layer caching.
# If requirements.txt doesn't change, this layer won't be rebuilt.
COPY requirements.txt .

# Create a virtual environment and install all dependencies
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
RUN pip install --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt


# ---------------------------------------------------------------------------
# Stage 2: Runtime
# ---------------------------------------------------------------------------
FROM python:3.12-slim AS runtime

WORKDIR /app

# Copy the virtual environment from builder
COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Copy application source
COPY . .

# ---------------------------------------------------------------------------
# Environment defaults
# (Override all of these via docker run --env or Azure App Service settings)
# ---------------------------------------------------------------------------
ENV DEMO_MODE=false
ENV API_HOST=0.0.0.0
ENV API_PORT=8000
ENV OPENAI_MODEL=gpt-4o
ENV LLM_PROVIDER=openai
ENV AUTO_APPROVE=false

# Health check — Azure App Service also probes /health
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD python -c "import urllib.request, os; urllib.request.urlopen('http://localhost:' + os.environ.get('PORT','8000') + '/health')"

# Azure App Service dynamically assigns PORT; default 8000 for local dev.
EXPOSE 8000

# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------
# uvicorn[standard] is in requirements.txt and includes WebSocket support.
# --workers 1: single worker for now (no shared in-memory state in multi-worker).
# Azure App Service sets PORT at runtime; ${PORT:-8000} falls back to 8000
# for local docker run without the env var.
# ---------------------------------------------------------------------------
CMD uvicorn api.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1 --log-level info
