"""Growth loop routes.

Adds addictive social mechanics:
- Daily challenges (vote on arc twists / debate topics)
- Poll posts (fans steer direction)
- Gamification status (streaks, XP, badges)
- Share tracking
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import SessionLocal
from ..auth import get_current_active_user
from .. import models, schemas, crud
from ..realtime import publish_event_sync


router = APIRouter()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@router.get("/loops/status", response_model=schemas.GamificationStatus)
def get_status(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.GamificationStatus:
    return crud.get_gamification_status(db, current_user.id)


@router.get("/loops/challenges/today", response_model=schemas.DailyChallenge)
def get_today_challenge(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.DailyChallenge:
    ch = crud.get_or_create_today_challenge(db)
    return crud.daily_challenge_to_schema(db, ch, user_id=current_user.id)


@router.post("/loops/challenges/{challenge_id}/vote", response_model=schemas.DailyChallenge)
def vote_today_challenge(
    challenge_id: int,
    body: schemas.DailyChallengeVoteRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.DailyChallenge:
    try:
        updated = crud.vote_daily_challenge(db, challenge_id=challenge_id, user_id=current_user.id, option_index=body.option_index)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    publish_event_sync({"type": "challenge.voted", "challenge_id": challenge_id, "user_id": current_user.id})
    return updated


@router.post("/posts/{post_id}/poll/vote", response_model=schemas.PollMeta)
def vote_poll(
    post_id: int,
    body: schemas.DailyChallengeVoteRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.PollMeta:
    try:
        meta = crud.vote_poll(db, post_id=post_id, user_id=current_user.id, option_index=body.option_index)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    publish_event_sync({"type": "poll.voted", "post_id": post_id, "user_id": current_user.id})
    return meta


@router.post("/posts/{post_id}/share", status_code=status.HTTP_204_NO_CONTENT)
def share_post(
    post_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> None:
    try:
        crud.record_share(db, user_id=current_user.id, post_id=post_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    publish_event_sync({"type": "post.shared", "post_id": post_id, "user_id": current_user.id})
    return None