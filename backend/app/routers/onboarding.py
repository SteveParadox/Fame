"""Onboarding routes.

This module provides a guided onboarding flow:
- Save user preferences (niche/style)
- Suggest influencers to follow
- Track whether onboarding is completed

The frontend can use these endpoints to run a 2–3 step wizard.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import SessionLocal
from ..auth import get_current_active_user
from .. import schemas, crud, models


router = APIRouter(prefix="/onboarding", tags=["onboarding"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@router.get("/me", response_model=schemas.OnboardingStatus)
def get_onboarding_status(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.OnboardingStatus:
    return crud.get_onboarding_status(db, user_id=current_user.id)


@router.post("/preferences", response_model=schemas.OnboardingStatus)
def update_preferences(
    payload: schemas.OnboardingPreferencesUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.OnboardingStatus:
    crud.update_user_preferences(
        db,
        user_id=current_user.id,
        preferred_niches=payload.preferred_niches,
        preferred_styles=payload.preferred_styles,
    )
    return crud.get_onboarding_status(db, user_id=current_user.id)


@router.get("/suggestions", response_model=list[schemas.Influencer])
def suggestions(
    limit: int = 20,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> list[schemas.Influencer]:
    limit = min(limit, 50)
    return crud.onboarding_suggestions(db, user_id=current_user.id, limit=limit)


@router.post("/complete", response_model=schemas.OnboardingStatus)
def complete_onboarding(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.OnboardingStatus:
    crud.set_onboarding_completed(db, user_id=current_user.id, completed=True)
    return crud.get_onboarding_status(db, user_id=current_user.id)
