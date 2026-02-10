"""
User API routes.

This module defines endpoints for managing users: creating an account and
retrieving user data.  Authentication and authorization are kept simple for
the initial MVP; later iterations should add OAuth2 with token-based
authentication.
"""

from typing import List
import os

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from .. import schemas, models, crud
from ..security_core import generate_email_token, hash_email_token
from ..emailer import send_verification_email
from ..database import SessionLocal
from ..auth import get_current_active_user, rate_limit


router = APIRouter()


def get_db():
    """Provide a database session to endpoints via dependency injection."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@router.post("/", response_model=schemas.User, status_code=status.HTTP_201_CREATED)
def create_user(user: schemas.UserCreate, db: Session = Depends(get_db)) -> schemas.User:
    """Create a new user account.

    If the email is already registered, raise a 400 error.
    """
    db_user = crud.get_user_by_email(db, email=user.email)
    if db_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered",
        )
    created = crud.create_user(db=db, user=user)

    # Phase B: email verification
    ttl_minutes = int(os.getenv("VERIFY_EMAIL_TTL_MINUTES", "1440"))  # 24h
    raw = generate_email_token()
    crud.create_email_token(db, created.id, "verify", hash_email_token(raw), ttl_minutes)
    send_verification_email(created.email, raw)

    return created


@router.get("/me", response_model=schemas.User)
def read_current_user(
    current_user: models.User = Depends(get_current_active_user),
    _: None = Depends(rate_limit),
) -> models.User:
    """Retrieve the currently authenticated user's profile.

    Applies rate limiting to prevent abuse.
    """
    return current_user


@router.get("/{user_id}", response_model=schemas.User)
def read_user(user_id: int, db: Session = Depends(get_db)) -> schemas.User:
    """Retrieve a user by ID, including their influencers."""
    db_user = crud.get_user(db, user_id=user_id)
    if db_user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return db_user