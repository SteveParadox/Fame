"""Dashboard API routes.

Provides endpoints that aggregate the authenticated user's activity and basic
analytics.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import crud, schemas, models
from ..database import SessionLocal
from ..auth import get_current_active_user


router = APIRouter()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@router.get("/dashboard/me", response_model=schemas.DashboardResponse)
def get_my_dashboard(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.DashboardResponse:
    created = crud.get_user_created_influencers(db, current_user.id)
    followed = crud.get_user_followed_influencers(db, current_user.id)
    engagement = crud.get_user_engagement_stats(db, current_user.id)
    holdings = crud.get_token_holdings(db, current_user.id)

    return schemas.DashboardResponse(
        user_id=current_user.id,
        created_influencers=[
            schemas.InfluencerSummary(
                id=i.id,
                name=i.name,
                niche=i.niche,
                style=i.style,
                posting_frequency=i.posting_frequency or 1,
            )
            for i in created
        ],
        followed_influencers=[
            schemas.InfluencerSummary(
                id=i.id,
                name=i.name,
                niche=i.niche,
                style=i.style,
                posting_frequency=i.posting_frequency or 1,
            )
            for i in followed
        ],
        engagement=schemas.EngagementStats(**engagement),
        token_holdings=[schemas.TokenHolding(**h) for h in holdings],
    )
