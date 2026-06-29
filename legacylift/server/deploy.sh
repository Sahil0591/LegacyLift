#!/usr/bin/env bash
# =============================================================================
# deploy.sh — Build, push, and redeploy LegacyLift to Azure App Service
# =============================================================================
# Usage:
#   ./deploy.sh
#
# Required environment variables (set in your shell or a .env file):
#   ACR_NAME         — Azure Container Registry name (e.g. legacyliftacr)
#   RESOURCE_GROUP   — Azure Resource Group (e.g. legacylift-rg)
#   APP_NAME         — Azure App Service name (e.g. legacylift)
#
# Optional:
#   IMAGE_TAG        — Docker image tag (default: latest)
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration — override via environment variables
# ---------------------------------------------------------------------------
ACR_NAME="${ACR_NAME:?Set ACR_NAME to your Azure Container Registry name}"
RESOURCE_GROUP="${RESOURCE_GROUP:?Set RESOURCE_GROUP to your Azure Resource Group}"
APP_NAME="${APP_NAME:?Set APP_NAME to your Azure App Service name}"
IMAGE_TAG="${IMAGE_TAG:-latest}"

IMAGE="$ACR_NAME.azurecr.io/legacylift:$IMAGE_TAG"

echo "==> LegacyLift Azure Deploy"
echo "    ACR:            $ACR_NAME"
echo "    Resource Group: $RESOURCE_GROUP"
echo "    App Service:    $APP_NAME"
echo "    Image:          $IMAGE"
echo ""

# ---------------------------------------------------------------------------
# Step 1: Log Docker into ACR
# ---------------------------------------------------------------------------
echo "==> [1/4] Logging into Azure Container Registry..."
az acr login --name "$ACR_NAME"

# ---------------------------------------------------------------------------
# Step 2: Build the Docker image
# ---------------------------------------------------------------------------
echo "==> [2/4] Building Docker image..."
docker build -t "$IMAGE" .

# ---------------------------------------------------------------------------
# Step 3: Push to ACR
# ---------------------------------------------------------------------------
echo "==> [3/4] Pushing image to ACR..."
docker push "$IMAGE"

# ---------------------------------------------------------------------------
# Step 4: Restart Azure App Service to pull the new image
# ---------------------------------------------------------------------------
echo "==> [4/4] Restarting App Service to pick up new image..."
az webapp restart \
  --resource-group "$RESOURCE_GROUP" \
  --name "$APP_NAME"

echo ""
echo "==> Deploy complete."
echo "    Live at: https://$APP_NAME.azurewebsites.net"
echo "    Health:  https://$APP_NAME.azurewebsites.net/health"
