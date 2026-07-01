from __future__ import annotations

import hashlib
import hmac
import os
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta


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
