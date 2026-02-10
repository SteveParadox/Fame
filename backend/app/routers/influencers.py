"""
Influencer API routes.

This module defines endpoints for creating, listing and retrieving influencers,
as well as initiating the influencer factory.  All write operations require
authentication.  Influencers are owned by a user; the authenticated user's
ID is used when creating new influencers.
"""

from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi import Body
from sqlalchemy.orm import Session

from .. import schemas, crud
from ..database import SessionLocal
from ..auth import get_current_active_user
from .. import models
from ..tasks import build_influencer as build_influencer_task
from ..providers.registry import get_llm_provider
from ..generation.pipeline import generate_influencer_spec
from ..generation.spec import InfluencerSpec
import random
from ..crud import set_influencer_reply_mode, search_influencers, recommended_influencers


router = APIRouter()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@router.post("/", response_model=schemas.Influencer, status_code=status.HTTP_201_CREATED)
def create_influencer(
    influencer: schemas.InfluencerCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.Influencer:
    """Create a new influencer for the authenticated user."""
    return crud.create_influencer(db=db, influencer=influencer, owner_id=current_user.id)


@router.get("/", response_model=List[schemas.Influencer])
def read_influencers(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)) -> List[schemas.Influencer]:
    """List influencers with optional pagination."""
    return crud.get_influencers(db=db, skip=skip, limit=limit)


@router.get("/search", response_model=List[schemas.Influencer])
def search(
    q: str | None = None,
    niche: str | None = None,
    style: str | None = None,
    sort: str = "popularity",
    skip: int = 0,
    limit: int = 20,
    db: Session = Depends(get_db),
) -> List[schemas.Influencer]:
    """Search influencers by name/bio and filter by niche/style."""
    limit = min(limit, 50)
    return search_influencers(db=db, q=q, niche=niche, style=style, sort=sort, skip=skip, limit=limit)


@router.get("/recommended", response_model=List[schemas.Influencer])
def recommended(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
    limit: int = 10,
) -> List[schemas.Influencer]:
    """Return basic recommendations for the current user."""
    limit = min(limit, 25)
    return recommended_influencers(db=db, user_id=current_user.id, limit=limit)


@router.get("/{influencer_id}", response_model=schemas.Influencer)
def read_influencer(influencer_id: int, db: Session = Depends(get_db)) -> schemas.Influencer:
    """Retrieve a specific influencer by ID."""
    influencer = crud.get_influencer(db, influencer_id=influencer_id)
    if influencer is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Influencer not found")
    return influencer


@router.get("/{influencer_id}/analytics", response_model=schemas.InfluencerAnalyticsResponse)
def get_influencer_analytics(
    influencer_id: int,
    days: int = 30,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.InfluencerAnalyticsResponse:
    """Return analytics series for a single influencer.

    For MVP, only the influencer owner can access detailed analytics.
    """
    influencer = crud.get_influencer(db, influencer_id)
    if influencer is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Influencer not found")
    if influencer.owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed")

    data = crud.get_influencer_analytics(db, influencer_id=influencer_id, days=days)
    return schemas.InfluencerAnalyticsResponse(
        influencer_id=data["influencer_id"],
        days=data["days"],
        points=[schemas.InfluencerAnalyticsPoint(**p) for p in data["points"]],
        totals=schemas.InfluencerAnalyticsTotals(**data["totals"]),
    )


@router.post("/{influencer_id}/reply_mode", response_model=schemas.Influencer)
def update_reply_mode(
    influencer_id: int,
    payload: schemas.ReplyModeUpdate = Body(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.Influencer:
    """Update the reply mode for an influencer.

    Only the owner of the influencer may modify its reply mode.  Allowed modes
    include 'wholesome', 'savage', 'educational', and 'drama'.
    """
    influencer = crud.get_influencer(db, influencer_id)
    if influencer is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Influencer not found")
    # Ensure only the owner can update reply mode
    if influencer.owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to modify this influencer")
    valid_modes = {"wholesome", "savage", "educational", "drama"}
    mode = payload.reply_mode.lower()
    if mode not in valid_modes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid reply mode")
    updated = set_influencer_reply_mode(db, influencer_id, mode)
    if updated is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Influencer not found")
    return updated


@router.post("/build", status_code=status.HTTP_202_ACCEPTED)
def build_influencer(
    request: schemas.InfluencerBuildRequest,
    current_user: models.User = Depends(get_current_active_user),
) -> dict[str, str]:
    """Enqueue a task to build a new AI influencer via the factory.

    Takes the user's niche, vibe/style, and posting frequency, and returns a
    Celery task ID.  Use `GET /tasks/{id}` to monitor the task status and
    retrieve the generated influencer details.
    """
    task = build_influencer_task.delay(
        current_user.id,
        request.niche,
        request.vibe,
        request.posting_frequency,
        request.seed,
        request.llm_provider,
        request.llm_model,
    )
    return {"task_id": task.id}


@router.post("/preview", response_model=schemas.InfluencerPreviewResponse)
def preview_influencer(
    request: schemas.InfluencerPreviewRequest,
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.InfluencerPreviewResponse:
    """Generate a preview influencer spec without persisting anything.

    Used by the onboarding wizard so users can see a preview (name, bio, lore,
    content pillars, starter posts) before committing to a full build.
    """
    seed = request.seed if request.seed is not None else random.randint(1, 2**31 - 1)
    provider = get_llm_provider(request.llm_provider, request.llm_model)
    spec = generate_influencer_spec(
        provider,
        niche=request.niche,
        vibe=request.vibe,
        seed=seed,
        posting_frequency=request.posting_frequency,
        count_posts=10,
    )
    return schemas.InfluencerPreviewResponse(seed=seed, spec=spec)

