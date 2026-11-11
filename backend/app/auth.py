"""Verifies Supabase Auth access tokens. The user id ALWAYS comes from the verified token (`sub`) — never from the request body."""
import asyncio
from dataclasses import dataclass
from typing import Optional

import jwt
from fastapi import Depends, HTTPException, Request
from jwt import PyJWKClient

from .config import settings

_jwks: Optional[PyJWKClient] = None


@dataclass(frozen=True)
class User:
    id: str
    email: Optional[str]
    name: Optional[str]
    avatar: Optional[str]


def _jwk_client() -> PyJWKClient:
    global _jwks
    if _jwks is None or _jwks.uri != settings.jwks_url:
        _jwks = PyJWKClient(settings.jwks_url, cache_keys=True, lifespan=3600)
    return _jwks


def _decode(token: str) -> dict:
    alg = jwt.get_unverified_header(token).get("alg", "")
    opts = {"require": ["exp", "sub"]}
    if alg == "HS256":
        if not settings.supabase_jwt_secret:
            raise jwt.InvalidTokenError("HS256 tokens are not accepted (no SUPABASE_JWT_SECRET configured).")
        return jwt.decode(token, settings.supabase_jwt_secret, algorithms=["HS256"], audience="authenticated", options=opts)
    if alg in ("ES256", "RS256", "EdDSA"):
        if not settings.jwks_url:
            raise jwt.InvalidTokenError("No SUPABASE_URL / JWKS URL configured.")
        key = _jwk_client().get_signing_key_from_jwt(token).key
        return jwt.decode(token, key, algorithms=[alg], audience="authenticated", options=opts)
    raise jwt.InvalidTokenError("Unsupported token algorithm.")  # includes 'none'


async def _user_from_request(request: Request) -> Optional[User]:
    header = request.headers.get("authorization", "")
    if not header.lower().startswith("bearer "):
        return None
    token = header[7:].strip()
    try:
        claims = await asyncio.to_thread(_decode, token)
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Your session has expired. Please sign in again.")
    except (jwt.PyJWTError, Exception) as e:
        raise HTTPException(401, "Invalid sign-in token.") from e
    if claims.get("role") != "authenticated":
        raise HTTPException(401, "Invalid sign-in token.")
    meta = claims.get("user_metadata") or {}
    return User(id=claims["sub"], email=claims.get("email"), name=meta.get("full_name") or meta.get("name"), avatar=meta.get("avatar_url") or meta.get("picture"))


async def optional_user(request: Request) -> Optional[User]:
    return await _user_from_request(request)


async def current_user(user: Optional[User] = Depends(optional_user)) -> User:
    if user is None:
        raise HTTPException(401, "Sign in to use this feature.")
    return user