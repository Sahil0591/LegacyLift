"""
api/auth.py — FastAPI dependency for Clerk JWT verification.

Usage in route handlers:
    from api.auth import get_current_user_id

    @app.get("/example")
    async def example(user_id: str = Depends(get_current_user_id)):
        ...

Requires CLERK_JWKS_URL in environment:
    CLERK_JWKS_URL=https://<instance>.clerk.accounts.dev/.well-known/jwks.json
"""

from __future__ import annotations

import os
from typing import Any, Optional

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient

_bearer = HTTPBearer(auto_error=False)

# Lazily initialised singleton — fetches and caches the JWKS on first use.
_jwks_client: Optional[PyJWKClient] = None


def _get_jwks_client() -> PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        jwks_url = os.environ.get("CLERK_JWKS_URL")
        if not jwks_url:
            raise RuntimeError(
                "CLERK_JWKS_URL is not set. "
                "Add it to your .env file — see server/.env.example."
            )
        _jwks_client = PyJWKClient(jwks_url, cache_keys=True)
    return _jwks_client


def _authorized_parties() -> set[str]:
    """Allowed `azp` (authorized party) values from CLERK_AUTHORIZED_PARTIES
    (comma-separated). Empty set means `azp` is not enforced."""
    raw = os.environ.get("CLERK_AUTHORIZED_PARTIES", "")
    return {p.strip() for p in raw.split(",") if p.strip()}


def _decode_clerk_jwt(token: str) -> dict[str, Any]:
    """Verify a Clerk JWT's signature *and* its issuer / audience / authorized
    party — not just the signature.

    - `exp` and `sub` are always required.
    - Issuer is enforced only when CLERK_ISSUER is set.
    - Audience is enforced only when CLERK_AUDIENCE is set; Clerk omits `aud` by
      default, so absent that config we must not hard-fail on a missing `aud`.
    - `azp` is checked against CLERK_AUTHORIZED_PARTIES when configured.

    Raises the underlying `jwt` exceptions on failure so callers can distinguish
    expiry from other invalidity.
    """
    client = _get_jwks_client()
    signing_key = client.get_signing_key_from_jwt(token)

    issuer = os.environ.get("CLERK_ISSUER")
    audience = os.environ.get("CLERK_AUDIENCE")

    options: dict[str, Any] = {"require": ["exp", "sub"]}
    decode_kwargs: dict[str, Any] = {"algorithms": ["RS256"]}
    if issuer:
        decode_kwargs["issuer"] = issuer
    if audience:
        decode_kwargs["audience"] = audience
    else:
        options["verify_aud"] = False
    decode_kwargs["options"] = options

    payload: dict[str, Any] = jwt.decode(token, signing_key.key, **decode_kwargs)

    allowed_parties = _authorized_parties()
    if allowed_parties and payload.get("azp") not in allowed_parties:
        raise jwt.InvalidTokenError(f"Unauthorized party (azp): {payload.get('azp')!r}")

    return payload


def get_current_user_id(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> str:
    """
    FastAPI dependency that extracts and verifies the Clerk JWT from the
    Authorization: Bearer <token> header, returning the Clerk user ID (sub claim).

    Raises HTTP 401 if the token is missing or invalid.
    """
    if not creds:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        payload = _decode_clerk_jwt(creds.credentials)
        user_id: str = payload["sub"]
        return user_id
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
            headers={"WWW-Authenticate": "Bearer"},
        )


def verify_ws_token(token: str) -> str:
    """
    Verify a Clerk JWT provided as a WebSocket query parameter.
    Returns the Clerk user ID on success, raises HTTPException on failure.
    """
    try:
        payload = _decode_clerk_jwt(token)
        return payload["sub"]
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid WebSocket token",
        )
