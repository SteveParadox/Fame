"""
Authentication utilities for the FameForge API.

This module defines helper functions to authenticate users, generate JWT
access tokens and retrieve the current user from a request.  It uses
`python-jose` to encode and decode JWTs.  The `SECRET_KEY` should be set
via environment variable in production.
"""

import os
from datetime import datetime, timedelta
from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from . import crud, models
from .database import SessionLocal
from fastapi import Request
from collections import defaultdict
import time

# Configuration for JWT
SECRET_KEY = os.getenv("SECRET_KEY", "change-me")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30

# OAuth2 scheme that expects a bearer token from the `/token` endpoint
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")


def get_db():
    """Provide a database session via dependency injection."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def authenticate_user(db: Session, email: str, password: str) -> Optional[models.User]:
    """Authenticate a user by email and password.

    Returns the user if credentials are valid, otherwise returns `None`.
    """
    user = crud.get_user_by_email(db, email=email)
    if not user:
        return None
    if not crud.verify_password(password, user.hashed_password):
        return None
    return user


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Generate a JWT access token containing the provided data."""
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> models.User:
    """Retrieve the current authenticated user from a JWT token."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str | None = payload.get("sub")
        if email is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    user = crud.get_user_by_email(db, email=email)
    if user is None:
        raise credentials_exception
    return user


def get_current_active_user(current_user: models.User = Depends(get_current_user)) -> models.User:
    """Ensure the current user is active."""
    if not current_user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")
    return current_user


# -----------------------------------------------------------------------------
# Rate limiting
#

RATE_LIMIT_PER_MINUTE = 60  # maximum requests per minute per user
_request_timestamps: defaultdict[int, list[float]] = defaultdict(list)


async def rate_limit(
    request: Request,
    current_user: models.User = Depends(get_current_user),
) -> None:
    """A simple in-memory rate limiter.

    Tracks the timestamps of a user's requests within the last minute and
    raises a 429 error if the number exceeds `RATE_LIMIT_PER_MINUTE`.  This
    should be replaced with a robust Redis-based limiter in production.
    """
    now = time.time()
    user_id = current_user.id
    timestamps = _request_timestamps[user_id]
    # Keep only timestamps within the last minute
    _request_timestamps[user_id] = [t for t in timestamps if now - t < 60]
    if len(_request_timestamps[user_id]) >= RATE_LIMIT_PER_MINUTE:
        raise HTTPException(status_code=429, detail="Rate limit exceeded")
    _request_timestamps[user_id].append(now)