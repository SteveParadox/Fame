"""Authentication routes (Phase A: secure auth core).

Implements:
- JWT access tokens (short-lived)
- refresh tokens stored as hashes in DB
- refresh token rotation
- basic session/device management
- Redis-backed rate limits for sensitive endpoints
"""

from datetime import datetime, timedelta
import os

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from .. import crud, models, schemas
from ..auth import authenticate_user, create_access_token, get_current_active_user, get_db
from ..ratelimit import hit_limit
from ..security_core import generate_refresh_token, hash_refresh_token, generate_email_token, hash_email_token
from ..emailer import send_verification_email, send_password_reset_email


router = APIRouter()


# Token lifetimes
ACCESS_TOKEN_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "15"))
REFRESH_TTL_DAYS = int(os.getenv("REFRESH_TOKEN_TTL_DAYS", "30"))

REQUIRE_EMAIL_VERIFICATION = os.getenv("REQUIRE_EMAIL_VERIFICATION", "true").lower() == "true"
VERIFY_EMAIL_TTL_MINUTES = int(os.getenv("VERIFY_EMAIL_TTL_MINUTES", "1440"))  # 24h
RESET_PASSWORD_TTL_MINUTES = int(os.getenv("RESET_PASSWORD_TTL_MINUTES", "30"))
LOGIN_LOCK_THRESHOLD = int(os.getenv("LOGIN_LOCK_THRESHOLD", "5"))
LOGIN_LOCK_MINUTES = int(os.getenv("LOGIN_LOCK_MINUTES", "15"))


def _client_ip(request: Request) -> str:
    # Trust X-Forwarded-For only if you control the proxy; keep it simple for now.
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _set_refresh_cookie(response: Response, refresh_token: str) -> None:
    secure = os.getenv("COOKIE_SECURE", "false").lower() == "true"
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        secure=secure,
        samesite="lax",
        max_age=REFRESH_TTL_DAYS * 24 * 3600,
        path="/",
    )


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(key="refresh_token", path="/")


@router.post("/token", response_model=dict)
async def login_for_access_token(
    request: Request,
    response: Response,
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
) -> dict:
    """Login: returns access token and sets refresh token cookie.

    Rate limits:
    - per IP: 30/min
    - per email: 10/min
    """
    ip = _client_ip(request)
    email = form_data.username.lower().strip()

    # Redis rate limits (fail-open handled in hit_limit)
    c = await hit_limit(f"rl:login:ip:{ip}", 30, 60)
    if c and c > 30:
        raise HTTPException(status_code=429, detail="Too many login attempts")
    c = await hit_limit(f"rl:login:email:{email}", 10, 60)
    if c and c > 10:
        raise HTTPException(status_code=429, detail="Too many login attempts")

    user = crud.get_user_by_email(db, email)

    # Lockout check (only if user exists, to avoid enumeration differences)
    if user and user.locked_until and user.locked_until > datetime.utcnow():
        raise HTTPException(status_code=423, detail="Account temporarily locked. Try again later.")

    # Validate credentials
    if not user or not crud.verify_password(form_data.password, user.hashed_password):
        if user:
            crud.record_failed_login(db, user, threshold=LOGIN_LOCK_THRESHOLD, lock_minutes=LOGIN_LOCK_MINUTES)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Clear failures on successful login
    crud.clear_failed_login(db, user)

    if REQUIRE_EMAIL_VERIFICATION and not user.email_verified:
        raise HTTPException(status_code=403, detail="Email not verified")

    access_token_expires = timedelta(minutes=ACCESS_TOKEN_MINUTES)
    access_token = create_access_token(data={"sub": user.email}, expires_delta=access_token_expires)

    refresh_token = generate_refresh_token()
    refresh_hash = hash_refresh_token(refresh_token)
    crud.create_auth_session(
        db,
        user_id=user.id,
        refresh_token_hash=refresh_hash,
        user_agent=request.headers.get("user-agent"),
        ip=ip,
        ttl_days=REFRESH_TTL_DAYS,
    )
    _set_refresh_cookie(response, refresh_token)

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "expires_in": ACCESS_TOKEN_MINUTES * 60,
    }


@router.post("/auth/resend_verification", status_code=204)
async def resend_verification(
    request: Request,
    payload: schemas.EmailOnly,
    db: Session = Depends(get_db),
) -> None:
    """Resend verification email (rate limited).

    Always returns 204 to reduce email enumeration.
    """
    ip = _client_ip(request)
    email = payload.email.lower().strip()

    c = await hit_limit(f"rl:resend_verify:ip:{ip}", 10, 60)
    if c and c > 10:
        raise HTTPException(status_code=429, detail="Too many requests")
    c = await hit_limit(f"rl:resend_verify:email:{email}", 3, 300)
    if c and c > 3:
        raise HTTPException(status_code=429, detail="Too many requests")

    user = crud.get_user_by_email(db, email)
    if user and not user.email_verified and user.is_active:
        raw = generate_email_token()
        crud.create_email_token(db, user.id, "verify", hash_email_token(raw), VERIFY_EMAIL_TTL_MINUTES)
        send_verification_email(user.email, raw)


@router.post("/auth/verify", status_code=204)
def verify_email(payload: schemas.VerifyEmailPayload, db: Session = Depends(get_db)) -> None:
    """Verify email with a one-time token."""
    h = hash_email_token(payload.token)
    tok = crud.get_email_token_by_hash(db, h, "verify")
    if not tok or tok.used_at is not None or tok.expires_at < datetime.utcnow():
        raise HTTPException(status_code=400, detail="Invalid or expired token")
    user = crud.get_user(db, tok.user_id)
    if not user:
        raise HTTPException(status_code=400, detail="Invalid token")
    crud.mark_email_token_used(db, tok)
    crud.verify_user_email(db, user)


@router.get("/auth/verify", status_code=204)
def verify_email_get(token: str, db: Session = Depends(get_db)) -> None:
    return verify_email(schemas.VerifyEmailPayload(token=token), db)


@router.post("/auth/password/forgot", status_code=204)
async def forgot_password(
    request: Request,
    payload: schemas.EmailOnly,
    db: Session = Depends(get_db),
) -> None:
    """Request a password reset.

    Always returns 204.
    """
    ip = _client_ip(request)
    email = payload.email.lower().strip()

    c = await hit_limit(f"rl:pw_forgot:ip:{ip}", 10, 60)
    if c and c > 10:
        raise HTTPException(status_code=429, detail="Too many requests")
    c = await hit_limit(f"rl:pw_forgot:email:{email}", 3, 300)
    if c and c > 3:
        raise HTTPException(status_code=429, detail="Too many requests")

    user = crud.get_user_by_email(db, email)
    if user and user.is_active:
        raw = generate_email_token()
        crud.create_email_token(db, user.id, "reset", hash_email_token(raw), RESET_PASSWORD_TTL_MINUTES)
        send_password_reset_email(user.email, raw)


@router.post("/auth/password/reset", status_code=204)
def reset_password(payload: schemas.ResetPasswordPayload, db: Session = Depends(get_db)) -> None:
    """Reset password using a one-time token.

    On success, all sessions for the user are revoked.
    """
    h = hash_email_token(payload.token)
    tok = crud.get_email_token_by_hash(db, h, "reset")
    if not tok or tok.used_at is not None or tok.expires_at < datetime.utcnow():
        raise HTTPException(status_code=400, detail="Invalid or expired token")
    user = crud.get_user(db, tok.user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=400, detail="Invalid token")

    user.hashed_password = crud.get_password_hash(payload.new_password)
    db.add(user)
    db.commit()
    crud.mark_email_token_used(db, tok)
    crud.revoke_all_sessions_for_user(db, user.id)


@router.post("/auth/refresh", response_model=dict)
async def refresh_access_token(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> dict:
    """Refresh: rotate refresh token and return a new access token."""
    ip = _client_ip(request)
    # Rate limit refresh per IP to reduce abuse
    c = await hit_limit(f"rl:refresh:ip:{ip}", 60, 60)
    if c and c > 60:
        raise HTTPException(status_code=429, detail="Too many refresh requests")

    raw = request.cookies.get("refresh_token")
    if not raw:
        raise HTTPException(status_code=401, detail="Missing refresh token")

    refresh_hash = hash_refresh_token(raw)
    session = crud.get_auth_session_by_refresh_hash(db, refresh_hash)
    if not session or session.is_revoked:
        raise HTTPException(status_code=401, detail="Invalid refresh token")
    if session.expires_at and session.expires_at < datetime.utcnow():
        raise HTTPException(status_code=401, detail="Refresh token expired")

    user = crud.get_user(db, session.user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User inactive")

    # Rotate refresh token
    new_refresh = generate_refresh_token()
    new_hash = hash_refresh_token(new_refresh)
    crud.rotate_auth_session(db, session, new_hash)
    _set_refresh_cookie(response, new_refresh)

    access_token_expires = timedelta(minutes=ACCESS_TOKEN_MINUTES)
    access_token = create_access_token(data={"sub": user.email}, expires_delta=access_token_expires)
    return {"access_token": access_token, "token_type": "bearer", "expires_in": ACCESS_TOKEN_MINUTES * 60}


@router.post("/auth/logout", status_code=204)
def logout(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> None:
    """Logout current device: revoke session for current refresh token."""
    raw = request.cookies.get("refresh_token")
    if raw:
        refresh_hash = hash_refresh_token(raw)
        session = crud.get_auth_session_by_refresh_hash(db, refresh_hash)
        if session:
            crud.revoke_auth_session(db, session)
    _clear_refresh_cookie(response)


@router.post("/auth/logout_all", status_code=204)
def logout_all(
    current_user: models.User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
) -> None:
    """Logout all devices for the current user."""
    crud.revoke_all_sessions_for_user(db, current_user.id)


@router.get("/auth/sessions", response_model=list)
def list_sessions(
    current_user: models.User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
) -> list:
    """List active sessions for the user."""
    sessions = crud.list_auth_sessions_for_user(db, current_user.id)
    return [
        {
            "id": s.id,
            "created_at": s.created_at,
            "last_used_at": s.last_used_at,
            "expires_at": s.expires_at,
            "user_agent": s.user_agent,
            "ip": s.ip,
            "is_revoked": s.is_revoked,
        }
        for s in sessions
    ]


@router.delete("/auth/sessions/{session_id}", status_code=204)
def revoke_session(
    session_id: str,
    current_user: models.User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
) -> None:
    """Revoke a specific session (device logout)."""
    sess = db.query(models.AuthSession).filter(models.AuthSession.id == session_id, models.AuthSession.user_id == current_user.id).first()
    if not sess:
        raise HTTPException(status_code=404, detail="Session not found")
    crud.revoke_auth_session(db, sess)


