"""Creator Studio routes.

These endpoints let influencer creators manage drafts, schedule posts, and
generate additional content with preview.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..auth import get_current_user
from .. import models, schemas
from ..providers.registry import get_llm_provider
from ..generation.posts import generate_posts_batch
from ..tasks import regenerate_post


router = APIRouter(prefix="/studio", tags=["studio"])


def _get_owned_influencer(db: Session, *, influencer_id: int, user_id: int) -> models.Influencer:
    inf = db.query(models.Influencer).filter(models.Influencer.id == influencer_id).first()
    if not inf:
        raise HTTPException(status_code=404, detail="Influencer not found")
    if inf.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Not allowed")
    return inf


@router.get("/influencers", response_model=List[schemas.StudioInfluencer])
def list_my_influencers(db: Session = Depends(get_db), user=Depends(get_current_user)):
    items = db.query(models.Influencer).filter(models.Influencer.owner_id == user.id).order_by(models.Influencer.id.desc()).all()
    return items


@router.get("/influencers/{influencer_id}/drafts", response_model=List[schemas.StudioPost])
def list_drafts(
    influencer_id: int,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    _get_owned_influencer(db, influencer_id=influencer_id, user_id=user.id)
    posts = (
        db.query(models.Post)
        .filter(models.Post.influencer_id == influencer_id)
        .filter(models.Post.status == "draft")
        .order_by(models.Post.scheduled_at.asc().nulls_last(), models.Post.created_at.desc())
        .all()
    )
    return posts


@router.get("/influencers/{influencer_id}/calendar", response_model=List[schemas.StudioPost])
def calendar(
    influencer_id: int,
    start: datetime = Query(..., description="ISO start datetime"),
    end: datetime = Query(..., description="ISO end datetime"),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    _get_owned_influencer(db, influencer_id=influencer_id, user_id=user.id)
    posts = (
        db.query(models.Post)
        .filter(models.Post.influencer_id == influencer_id)
        .filter(models.Post.status == "draft")
        .filter(models.Post.scheduled_at.isnot(None))
        .filter(models.Post.scheduled_at >= start)
        .filter(models.Post.scheduled_at < end)
        .order_by(models.Post.scheduled_at.asc())
        .all()
    )
    return posts


@router.patch("/posts/{post_id}", response_model=schemas.StudioPost)
def update_post(
    post_id: int,
    payload: schemas.StudioPostUpdate,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    post = db.query(models.Post).filter(models.Post.id == post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    inf = _get_owned_influencer(db, influencer_id=post.influencer_id, user_id=user.id)

    if payload.content is not None:
        post.content = payload.content
    if payload.mode is not None:
        post.mode = payload.mode
        meta = dict(post.meta or {})
        meta["mode"] = payload.mode
        post.meta = meta
    if payload.post_type is not None:
        post.post_type = payload.post_type
    if payload.status is not None:
        post.status = payload.status
    if payload.scheduled_at is not None:
        post.scheduled_at = payload.scheduled_at

    db.add(post)
    db.commit()
    db.refresh(post)
    return post


@router.delete("/posts/{post_id}")
def delete_post(
    post_id: int,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    post = db.query(models.Post).filter(models.Post.id == post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    _get_owned_influencer(db, influencer_id=post.influencer_id, user_id=user.id)
    db.delete(post)
    db.commit()
    return {"ok": True}


@router.post("/posts/{post_id}/regenerate")
def regenerate_post_draft(
    post_id: int,
    llm_provider: Optional[str] = None,
    llm_model: Optional[str] = None,
    seed: Optional[int] = None,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    post = db.query(models.Post).filter(models.Post.id == post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    _get_owned_influencer(db, influencer_id=post.influencer_id, user_id=user.id)

    # enqueue regeneration
    async_res = regenerate_post.delay(user.id, post_id, llm_provider, llm_model, seed)
    return {"task_id": async_res.id}


@router.post("/influencers/{influencer_id}/generate_preview", response_model=schemas.StudioGeneratePreviewResponse)
def generate_preview(
    influencer_id: int,
    payload: schemas.StudioGeneratePreviewRequest,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    inf = _get_owned_influencer(db, influencer_id=influencer_id, user_id=user.id)
    seed = payload.seed or int(datetime.utcnow().timestamp())
    provider = get_llm_provider(payload.llm_provider, payload.llm_model)
    tone_voice = (inf.tone_guide_json or {}).get("voice") or inf.reply_mode or "wholesome"
    pillars = list(inf.content_pillars_json or [])
    mode = payload.mode or inf.reply_mode or "wholesome"
    batch = generate_posts_batch(
        provider,
        influencer_name=inf.name,
        niche=inf.niche,
        style=inf.style,
        lore=inf.lore or "",
        tone_voice=tone_voice,
        pillars=pillars,
        current_arc=inf.current_arc or "",
        mode=mode,
        seed=seed,
        count=payload.count,
    )
    items = [p.model_dump() for p in batch]
    return schemas.StudioGeneratePreviewResponse(seed=seed, items=items)


@router.post("/influencers/{influencer_id}/commit_generated", response_model=List[schemas.StudioPost])
def commit_generated(
    influencer_id: int,
    payload: schemas.StudioCommitGeneratedRequest,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    inf = _get_owned_influencer(db, influencer_id=influencer_id, user_id=user.id)
    schedule_start = payload.schedule_start
    created: List[models.Post] = []

    for idx, item in enumerate(payload.items):
        content = str(item.get("text") or "").strip()
        post_type = str(item.get("type") or "post")
        meta = dict(item.get("meta") or {})
        mode = str(meta.get("mode") or "wholesome")
        scheduled_at = None
        if schedule_start is not None:
            scheduled_at = schedule_start + timedelta(hours=24 * idx)
        p = models.Post(
            influencer_id=inf.id,
            content=content,
            mode=mode,
            post_type=post_type,
            status="draft",
            meta=meta,
            scheduled_at=scheduled_at,
        )
        db.add(p)
        db.flush()
        created.append(p)
    db.commit()
    for p in created:
        db.refresh(p)
    return created
