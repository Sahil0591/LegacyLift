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
from typing import Optional

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
        client = _get_jwks_client()
        signing_key = client.get_signing_key_from_jwt(creds.credentials)
        payload = jwt.decode(
            creds.credentials,
            signing_key.key,
            algorithms=["RS256"],
        )
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
        client = _get_jwks_client()
        signing_key = client.get_signing_key_from_jwt(token)
        payload = jwt.decode(token, signing_key.key, algorithms=["RS256"])
        return payload["sub"]
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid WebSocket token",
        )
