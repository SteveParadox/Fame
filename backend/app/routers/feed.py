"""
Feed API routes.

This module defines endpoints for retrieving the public influencer feed with
infinite scroll, following/unfollowing influencers, liking/unliking posts,
and commenting on posts.  Trending posts are returned based on recent
engagement growth (likes and comments in the last 24 hours).
"""

from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from .. import schemas, crud, models
from ..database import SessionLocal
from ..auth import get_current_active_user, get_current_user, get_current_user_optional
from ..tasks import reply_to_comment
from ..realtime import publish_event_sync, set_once
from ..notifier import notify_sync

from datetime import datetime, timedelta


def _maybe_notify_trending(db: Session, post: models.Post) -> None:
    """Publish a "trending" notification for the influencer owner.

    MVP heuristic: if a post gets >=5 (likes + user comments) in the last
    10 minutes, notify the influencer owner at most once every 30 minutes
    per post.
    """
    try:
        window = datetime.utcnow() - timedelta(minutes=10)
        likes = (
            db.query(models.Reaction)
            .filter(
                models.Reaction.post_id == post.id,
                models.Reaction.type == "like",
                models.Reaction.created_at >= window,
            )
            .count()
        )
        comments = (
            db.query(models.Comment)
            .filter(
                models.Comment.post_id == post.id,
                models.Comment.author_type == "user",
                models.Comment.created_at >= window,
            )
            .count()
        )
        score = int(likes) + int(comments)
        if score < 5:
            return
        influencer = db.query(models.Influencer).filter(models.Influencer.id == post.influencer_id).first()
        if not influencer:
            return
        if set_once(f"notif:trending:post:{post.id}", ttl_seconds=1800):
            notify_sync(
                user_id=influencer.owner_id,
                notif_type="notify.trending",
                message=f"{influencer.name} is trending! ({score} interactions in 10m)",
                data={"influencer_id": influencer.id, "post_id": post.id, "score": score},
            )
    except Exception:
        return

router = APIRouter()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@router.get("/feed", response_model=List[schemas.Post])
def get_feed(
    skip: int = 0,
    limit: int = 20,
    trending: bool = False,
    db: Session = Depends(get_db),
) -> List[schemas.Post]:
    """Retrieve a list of posts for the public feed.

    Supports infinite scroll via `skip` and `limit`.  If `trending` is True,
    returns posts with the highest engagement in the last 24 hours.
    """
    limit = min(limit, 100)
    if trending:
        return crud.get_trending_posts(db=db, limit=limit)
    return crud.get_posts(db=db, skip=skip, limit=limit)


@router.get("/feed/v2", response_model=schemas.FeedPageV2)
def get_feed_v2(
    limit: int = 20,
    cursor: str | None = None,
    mode: str = "for_you",
    q: str | None = None,
    niche: str | None = None,
    style: str | None = None,
    db: Session = Depends(get_db),
    current_user: models.User | None = Depends(get_current_user_optional),
) -> schemas.FeedPageV2:
    """Production-ready feed endpoint.

    - Cursor pagination
    - Mode tabs: for_you | following | trending
    - Optional filters: q, niche, style
    - If authenticated, includes is_liked and is_following flags
    """
    mode = mode if mode in {"for_you", "following", "trending"} else "for_you"
    try:
        page = crud.get_feed_v2(
            db,
            user_id=current_user.id if current_user else None,
            limit=limit,
            cursor=cursor,
            mode=mode,
            q=q,
            niche=niche,
            style=style,
        )
        return page  # type: ignore
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid cursor")


@router.get("/posts/{post_id}/comments/v2", response_model=schemas.CommentPageV2)
def get_comments_v2(
    post_id: int,
    limit: int = 20,
    cursor: str | None = None,
    db: Session = Depends(get_db),
) -> schemas.CommentPageV2:
    # Ensure post exists
    post = db.query(models.Post).filter(models.Post.id == post_id).first()
    if not post:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Post not found")
    try:
        page = crud.get_comments_v2(db, post_id=post_id, limit=limit, cursor=cursor)
        return page  # type: ignore
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid cursor")


@router.post("/influencers/{influencer_id}/follow", response_model=schemas.Follow)
def follow_influencer(
    influencer_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.Follow:
    """Follow an influencer.  Requires authentication."""
    # Ensure influencer exists
    inf = crud.get_influencer(db, influencer_id)
    if not inf:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Influencer not found")
    return crud.follow_influencer(db=db, user_id=current_user.id, influencer_id=influencer_id)


@router.delete("/influencers/{influencer_id}/follow", status_code=status.HTTP_204_NO_CONTENT)
def unfollow_influencer(
    influencer_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> None:
    """Unfollow an influencer.  Requires authentication."""
    crud.unfollow_influencer(db=db, user_id=current_user.id, influencer_id=influencer_id)
    return None


@router.post("/posts/{post_id}/like", status_code=status.HTTP_201_CREATED)
def like_post(
    post_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.Reaction:
    """Like a post.  Requires authentication."""
    # Ensure post exists
    post = db.query(models.Post).filter(models.Post.id == post_id).first()
    if not post:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Post not found")
    reaction = crud.like_post(db=db, user_id=current_user.id, post_id=post_id)
    publish_event_sync(
        {
            "type": "reaction.like",
            "post_id": post_id,
            "user_id": current_user.id,
            "influencer_id": post.influencer_id,
        }
    )
    _maybe_notify_trending(db, post)
    return reaction


@router.delete("/posts/{post_id}/like", status_code=status.HTTP_204_NO_CONTENT)
def unlike_post(
    post_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> None:
    """Remove a like from a post.  Requires authentication."""
    crud.unlike_post(db=db, user_id=current_user.id, post_id=post_id)
    publish_event_sync({"type": "reaction.unlike", "post_id": post_id, "user_id": current_user.id})
    return None


@router.post("/posts/{post_id}/comments", response_model=schemas.Comment, status_code=status.HTTP_201_CREATED)
def comment_on_post(
    post_id: int,
    comment: schemas.CommentBase,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> schemas.Comment:
    """Add a comment to a post.  Requires authentication."""
    # Ensure post exists
    post = db.query(models.Post).filter(models.Post.id == post_id).first()
    if not post:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Post not found")
    created_comment = crud.add_comment(db=db, user_id=current_user.id, post_id=post_id, content=comment.content)
    publish_event_sync(
        {
            "type": "comment.created",
            "comment_id": created_comment.id,
            "post_id": post_id,
            "user_id": current_user.id,
            "influencer_id": post.influencer_id,
            "content": created_comment.content,
        }
    )
    _maybe_notify_trending(db, post)
    # Trigger an asynchronous reply from the influencer
    try:
        reply_to_comment.delay(created_comment.id)
    except Exception:
        # Fail silently if task cannot be queued
        pass
    return created_comment