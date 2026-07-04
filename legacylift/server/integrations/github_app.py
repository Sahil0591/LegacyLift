from __future__ import annotations

import asyncio
import hashlib
import hmac
import os
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import aiohttp
import jwt

from integrations.github_client import GitHubApiClient


@dataclass(frozen=True)
class GitHubAppSettings:
    app_id: str = ""
    private_key: str = ""
    webhook_secret: str = ""
    client_id: str = ""
    client_secret: str = ""

    @classmethod
    def from_env(cls) -> GitHubAppSettings:
        return cls(
            app_id=os.getenv("GITHUB_APP_ID", ""),
            private_key=os.getenv("GITHUB_PRIVATE_KEY", ""),
            webhook_secret=os.getenv("GITHUB_WEBHOOK_SECRET", ""),
            client_id=os.getenv("GITHUB_CLIENT_ID", ""),
            client_secret=os.getenv("GITHUB_CLIENT_SECRET", ""),
        )


@dataclass(frozen=True)
class InstallationToken:
    token: str
    expires_at: datetime


def verify_webhook_signature(body: bytes, signature_header: str | None, secret: str) -> bool:
    if not secret or not signature_header or not signature_header.startswith("sha256="):
        return False

    expected = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    supplied = signature_header.removeprefix("sha256=")
    return hmac.compare_digest(expected, supplied)


def create_mock_installation_token(
    *,
    installation_id: str,
    app_id: str = "mock-app",
    now: datetime | None = None,
) -> InstallationToken:
    issued_at = now or datetime.now(UTC)
    return InstallationToken(
        token=f"mock-installation-token-{app_id}-{installation_id}",
        expires_at=issued_at + timedelta(hours=1),
    )


# ---------------------------------------------------------------------------
# Real GitHub App auth: private key → app JWT → installation access token
# ---------------------------------------------------------------------------

_GITHUB_API_BASE = "https://api.github.com"


class GitHubAppAuthError(RuntimeError):
    """Raised when an app JWT can't be minted or a token exchange fails."""


def create_app_jwt(settings: GitHubAppSettings, *, now: datetime | None = None) -> str:
    """Mint a short-lived (<10 min) RS256 JWT signed with the app private key.

    Used only to call GitHub's installation-token endpoint — it is never sent to
    our own API.
    """
    if not settings.app_id or not settings.private_key:
        raise GitHubAppAuthError(
            "GITHUB_APP_ID and GITHUB_PRIVATE_KEY must be set to mint a GitHub App JWT"
        )
    issued = now or datetime.now(UTC)
    payload = {
        "iat": int((issued - timedelta(seconds=60)).timestamp()),  # backdate for clock skew
        "exp": int((issued + timedelta(minutes=9)).timestamp()),   # GitHub caps app JWTs at 10 min
        "iss": settings.app_id,
    }
    # Env vars commonly store the PEM with escaped "\n"; normalise so PyJWT can
    # parse it. A genuine multi-line PEM is unaffected.
    private_key = settings.private_key.replace("\\n", "\n")
    return jwt.encode(payload, private_key, algorithm="RS256")


def _parse_github_timestamp(value: str) -> datetime:
    # GitHub returns ISO 8601 with a trailing Z, e.g. "2024-05-01T12:00:00Z".
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


async def fetch_installation_token(
    settings: GitHubAppSettings,
    installation_id: str,
    *,
    api_base: str = _GITHUB_API_BASE,
    now: datetime | None = None,
) -> InstallationToken:
    """Exchange the app JWT for a scoped installation access token."""
    app_jwt = create_app_jwt(settings, now=now)
    headers = {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {app_jwt}",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    url = f"{api_base.rstrip('/')}/app/installations/{installation_id}/access_tokens"
    async with aiohttp.ClientSession(headers=headers) as session:
        async with session.post(url) as response:
            if response.status != 201:
                detail = (await response.text())[:200]
                raise GitHubAppAuthError(
                    f"Installation token exchange failed (HTTP {response.status}) "
                    f"for installation {installation_id}: {detail}"
                )
            data = await response.json()
    return InstallationToken(
        token=str(data["token"]),
        expires_at=_parse_github_timestamp(str(data["expires_at"])),
    )


class GitHubAppInstallationAuth:
    """Turns the app private key into authenticated GitHubApiClients, caching
    installation tokens until they near expiry so we mint at most one token per
    installation per hour instead of one per webhook."""

    _REFRESH_SKEW = timedelta(minutes=1)

    def __init__(
        self,
        settings: GitHubAppSettings | None = None,
        *,
        api_base: str = _GITHUB_API_BASE,
    ) -> None:
        self._settings = settings or GitHubAppSettings.from_env()
        self._api_base = api_base
        self._cache: dict[str, InstallationToken] = {}
        self._lock = asyncio.Lock()

    def is_configured(self) -> bool:
        return bool(self._settings.app_id and self._settings.private_key)

    async def token_for(self, installation_id: str) -> InstallationToken:
        async with self._lock:
            cached = self._cache.get(installation_id)
            if cached and cached.expires_at - self._REFRESH_SKEW > datetime.now(UTC):
                return cached
            token = await fetch_installation_token(
                self._settings, installation_id, api_base=self._api_base
            )
            self._cache[installation_id] = token
            return token

    async def client_for(self, installation_id: str) -> GitHubApiClient:
        token = await self.token_for(installation_id)
        return GitHubApiClient(token.token, base_url=self._api_base)
