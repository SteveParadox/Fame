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
from ..auth import get_current_active_user, get_current_user
from ..tasks import reply_to_comment

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
    return crud.like_post(db=db, user_id=current_user.id, post_id=post_id)


@router.delete("/posts/{post_id}/like", status_code=status.HTTP_204_NO_CONTENT)
def unlike_post(
    post_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> None:
    """Remove a like from a post.  Requires authentication."""
    crud.unlike_post(db=db, user_id=current_user.id, post_id=post_id)
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
    # Trigger an asynchronous reply from the influencer
    try:
        reply_to_comment.delay(created_comment.id)
    except Exception:
        # Fail silently if task cannot be queued
        pass
    return created_comment