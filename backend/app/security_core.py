"""Security primitives for tokens and session handling.

Phase A (production auth core) uses:
- short-lived JWT access tokens
- long-lived opaque refresh tokens stored as hashes in DB

This module contains small, testable utilities: generating and hashing
refresh tokens.
"""

import hashlib
import hmac
import os
import secrets


SECRET_KEY = os.getenv("SECRET_KEY", "change-me")


def _hash_opaque(token: str) -> str:
    return hmac.new(SECRET_KEY.encode("utf-8"), token.encode("utf-8"), hashlib.sha256).hexdigest()


def generate_refresh_token() -> str:
    """Create a new opaque refresh token.

    We return a URL-safe token suitable for httpOnly cookies.
    """
    return secrets.token_urlsafe(64)


def hash_refresh_token(token: str) -> str:
    """Hash refresh token using HMAC-SHA256.

    Storing only a hash means leaked DB contents do not directly expose
    active refresh tokens.
    """
    return _hash_opaque(token)


def generate_email_token() -> str:
    """Create a one-time token for email flows (verify/reset).

    Kept shorter than refresh tokens since it will be passed as a query string.
    """
    return secrets.token_urlsafe(32)


def hash_email_token(token: str) -> str:
    """Hash an email token using the same HMAC primitive."""
    return _hash_opaque(token)