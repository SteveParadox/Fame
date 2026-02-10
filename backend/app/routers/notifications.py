"""Notifications API.

Persists notifications (read/unread) and allows clients to fetch and mark them.
"""

from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import SessionLocal
from ..auth import get_current_active_user
from .. import models, schemas

router = APIRouter(prefix="/notifications", tags=["notifications"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@router.get("", response_model=list[schemas.Notification])
def list_notifications(
    unread_only: bool = False,
    status: str = "all",  # all|unread|read
    notif_type: str | None = None,
    search: str | None = None,
    since: datetime | None = None,
    until: datetime | None = None,
    skip: int = 0,
    limit: int = 20,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    limit = min(max(limit, 1), 100)
    q = db.query(models.Notification).filter(models.Notification.user_id == current_user.id)

    # Backwards-compatible unread_only, plus status param.
    status_norm = (status or "all").lower()
    if unread_only or status_norm == "unread":
        q = q.filter(models.Notification.is_read == False)  # noqa: E712
    elif status_norm == "read":
        q = q.filter(models.Notification.is_read == True)  # noqa: E712

    if notif_type:
        q = q.filter(models.Notification.type == notif_type)
    if search:
        q = q.filter(models.Notification.message.ilike(f"%{search}%"))
    if since:
        q = q.filter(models.Notification.created_at >= since)
    if until:
        q = q.filter(models.Notification.created_at <= until)
    return q.order_by(models.Notification.created_at.desc()).offset(skip).limit(limit).all()


@router.get("/unread_count")
def unread_count(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    c = (
        db.query(models.Notification)
        .filter(models.Notification.user_id == current_user.id, models.Notification.is_read == False)  # noqa: E712
        .count()
    )
    return {"unread_count": int(c)}


@router.post("/{notification_id}/read")
def mark_read(
    notification_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    n = (
        db.query(models.Notification)
        .filter(models.Notification.id == notification_id, models.Notification.user_id == current_user.id)
        .first()
    )
    if not n:
        raise HTTPException(status_code=404, detail="Notification not found")
    if not n.is_read:
        n.is_read = True
        n.read_at = datetime.utcnow()
        db.add(n)
        db.commit()
    return {"ok": True}


@router.post("/read_all")
def mark_all_read(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    now = datetime.utcnow()
    (
        db.query(models.Notification)
        .filter(models.Notification.user_id == current_user.id, models.Notification.is_read == False)  # noqa: E712
        .update({models.Notification.is_read: True, models.Notification.read_at: now})
    )
    db.commit()
    return {"ok": True}
