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
# Run:    docker run -p 8000:8000 --env-file .env legacylift
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
# (Override all of these via docker run --env or Fly.io secrets)
# ---------------------------------------------------------------------------
ENV DEMO_MODE=false
ENV API_HOST=0.0.0.0
ENV API_PORT=8000
ENV OPENAI_MODEL=gpt-4o
ENV LLM_PROVIDER=openai
ENV AUTO_APPROVE=false

# Fly.io health check hits /health — must return 200 within timeout
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"

EXPOSE 8000

# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------
# uvicorn[standard] is in requirements.txt and includes WebSocket support.
# --workers 1: single worker for now (no shared in-memory state in multi-worker).
# TODO (implementer): switch to multi-worker + Redis for pipeline state when
# scaling beyond a single instance.
# ---------------------------------------------------------------------------
CMD ["uvicorn", "legacylift.api.main:app", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--workers", "1", \
     "--log-level", "info"]
