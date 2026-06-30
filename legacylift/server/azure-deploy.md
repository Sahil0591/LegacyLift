# LegacyLift — Azure App Service Deployment Guide

Deploy the LegacyLift FastAPI server as a Docker container on Azure App Service using Azure Container Registry (ACR).

---

## Prerequisites

- [Azure CLI](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli) installed and logged in (`az login`)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) running locally
- An active Azure subscription

---

## Step 1 — Create a Resource Group

```bash
RESOURCE_GROUP=legacylift-rg
LOCATION=australiaeast   # Change to your preferred region

az group create --name $RESOURCE_GROUP --location $LOCATION
```

---

## Step 2 — Create an Azure Container Registry (ACR)

ACR names must be globally unique and contain only lowercase alphanumerics.

```bash
ACR_NAME=legacyliftacr   # Change to your unique name

az acr create \
  --resource-group $RESOURCE_GROUP \
  --name $ACR_NAME \
  --sku Basic \
  --admin-enabled true
```

Note the `loginServer` value in the output (e.g. `legacyliftacr.azurecr.io`). You'll need it below.

---

## Step 3 — Build and Push the Docker Image

From the `server/` directory:

```bash
# Log Docker into ACR
az acr login --name $ACR_NAME

# Build the image
docker build -t $ACR_NAME.azurecr.io/legacylift:latest .

# Push to ACR
docker push $ACR_NAME.azurecr.io/legacylift:latest
```

---

## Step 4 — Create an App Service Plan

```bash
PLAN_NAME=legacylift-plan

az appservice plan create \
  --name $PLAN_NAME \
  --resource-group $RESOURCE_GROUP \
  --is-linux \
  --sku B1
```

`B1` is the smallest paid Linux tier that supports custom containers. Upgrade to `P2v3` for production load.

---

## Step 5 — Create the Web App (App Service)

```bash
APP_NAME=legacylift   # Must be globally unique — becomes <APP_NAME>.azurewebsites.net

az webapp create \
  --resource-group $RESOURCE_GROUP \
  --plan $PLAN_NAME \
  --name $APP_NAME \
  --deployment-container-image-name $ACR_NAME.azurecr.io/legacylift:latest
```

---

## Step 6 — Grant the App Service Access to ACR

```bash
# Get the managed identity principal ID of the App Service
PRINCIPAL_ID=$(az webapp show \
  --resource-group $RESOURCE_GROUP \
  --name $APP_NAME \
  --query identity.principalId \
  --output tsv)

# Get the ACR resource ID
ACR_ID=$(az acr show \
  --name $ACR_NAME \
  --resource-group $RESOURCE_GROUP \
  --query id \
  --output tsv)

# Assign AcrPull role
az role assignment create \
  --assignee $PRINCIPAL_ID \
  --scope $ACR_ID \
  --role AcrPull
```

Alternatively, use ACR admin credentials instead of managed identity:

```bash
ACR_PASSWORD=$(az acr credential show --name $ACR_NAME --query passwords[0].value --output tsv)

az webapp config container set \
  --name $APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --docker-custom-image-name $ACR_NAME.azurecr.io/legacylift:latest \
  --docker-registry-server-url https://$ACR_NAME.azurecr.io \
  --docker-registry-server-user $ACR_NAME \
  --docker-registry-server-password $ACR_PASSWORD
```

---

## Step 7 — Set Environment Variables

Azure App Service passes these as environment variables inside the container.

```bash
az webapp config appsettings set \
  --resource-group $RESOURCE_GROUP \
  --name $APP_NAME \
  --settings \
    DEMO_MODE=false \
    AUTO_APPROVE=false \
    OPENAI_MODEL=gpt-4o \
    LLM_PROVIDER=openai \
    LLM_MAX_RETRIES=3 \
    LLM_RETRY_DELAY=2 \
    WS_PING_INTERVAL=30 \
    WEBSITES_PORT=8000
```

Set secrets separately so they don't appear in shell history:

```bash
az webapp config appsettings set \
  --resource-group $RESOURCE_GROUP \
  --name $APP_NAME \
  --settings \
    OPENAI_API_KEY="sk-your-key-here"
```

`WEBSITES_PORT=8000` tells Azure which port your container exposes. Azure injects its own `PORT` env var too; the Dockerfile CMD reads `${PORT:-8000}` to handle both.

---

## Step 8 — Enable WebSocket Support

Azure App Service disables WebSockets by default.

```bash
az webapp config set \
  --resource-group $RESOURCE_GROUP \
  --name $APP_NAME \
  --web-sockets-enabled true
```

---

## Step 9 — Configure the Health Check

```bash
az webapp config set \
  --resource-group $RESOURCE_GROUP \
  --name $APP_NAME \
  --generic-configurations '{"healthCheckPath": "/health"}'
```

---

## Step 10 — Deploy and Get the URL

Restart the app to pull the latest image:

```bash
az webapp restart --resource-group $RESOURCE_GROUP --name $APP_NAME
```

Your app is now live at:

```
https://<APP_NAME>.azurewebsites.net
```

Verify:

```bash
curl https://$APP_NAME.azurewebsites.net/health
```

---

## Subsequent Deploys

Rebuild, push, then restart (or use `deploy.sh` to automate all three):

```bash
docker build -t $ACR_NAME.azurecr.io/legacylift:latest .
docker push $ACR_NAME.azurecr.io/legacylift:latest
az webapp restart --resource-group $RESOURCE_GROUP --name $APP_NAME
```

---

## Viewing Logs

```bash
# Stream live logs
az webapp log tail --resource-group $RESOURCE_GROUP --name $APP_NAME

# Download a log snapshot
az webapp log download --resource-group $RESOURCE_GROUP --name $APP_NAME
```

---

## Scaling Up

```bash
# Scale to a higher tier (e.g. P2v3 — 2 vCPU, 8 GB RAM)
az appservice plan update \
  --name $PLAN_NAME \
  --resource-group $RESOURCE_GROUP \
  --sku P2v3
```

---

## Frontend Configuration

After deployment, update the Vercel / Next.js environment variables to point at the Azure backend:

```
NEXT_PUBLIC_API_URL=https://<APP_NAME>.azurewebsites.net
NEXT_PUBLIC_WEBSOCKET_URL=wss://<APP_NAME>.azurewebsites.net
```

Update `client/vercel.json` and redeploy the frontend.
