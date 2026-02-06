"""
CRUD helper functions for the FameForge backend.

These functions abstract direct database interactions, making it easier to
write unit tests and reuse logic across different parts of the application.
"""

from typing import List, Optional

from sqlalchemy.orm import Session
from passlib.context import CryptContext

from . import models, schemas

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def get_password_hash(password: str) -> str:
    """Hash a plaintext password using bcrypt."""
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a plaintext password against its hash."""
    return pwd_context.verify(plain_password, hashed_password)


def get_user(db: Session, user_id: int) -> Optional[models.User]:
    return db.query(models.User).filter(models.User.id == user_id).first()


def get_user_by_email(db: Session, email: str) -> Optional[models.User]:
    return db.query(models.User).filter(models.User.email == email).first()


def create_user(db: Session, user: schemas.UserCreate) -> models.User:
    hashed_password = get_password_hash(user.password)
    db_user = models.User(email=user.email, hashed_password=hashed_password)
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user


def create_influencer(db: Session, influencer: schemas.InfluencerCreate, owner_id: int) -> models.Influencer:
    db_influencer = models.Influencer(**influencer.dict(), owner_id=owner_id)
    db.add(db_influencer)
    db.commit()
    db.refresh(db_influencer)
    return db_influencer


def get_influencers(db: Session, skip: int = 0, limit: int = 100) -> List[models.Influencer]:
    return db.query(models.Influencer).offset(skip).limit(limit).all()


def get_influencer(db: Session, influencer_id: int) -> Optional[models.Influencer]:
    return db.query(models.Influencer).filter(models.Influencer.id == influencer_id).first()


# -----------------------------------------------------------------------------
# Feed, follow, like, and comment helpers
#
from datetime import datetime, timedelta


def follow_influencer(db: Session, user_id: int, influencer_id: int) -> models.Follow:
    """Follow an influencer.  If already following, return existing record."""
    follow = (
        db.query(models.Follow)
        .filter(models.Follow.user_id == user_id, models.Follow.influencer_id == influencer_id)
        .first()
    )
    if follow:
        return follow
    follow = models.Follow(user_id=user_id, influencer_id=influencer_id)
    db.add(follow)
    db.commit()
    db.refresh(follow)
    return follow


def unfollow_influencer(db: Session, user_id: int, influencer_id: int) -> None:
    """Unfollow an influencer.  Does nothing if not following."""
    follow = (
        db.query(models.Follow)
        .filter(models.Follow.user_id == user_id, models.Follow.influencer_id == influencer_id)
        .first()
    )
    if follow:
        db.delete(follow)
        db.commit()


def like_post(db: Session, user_id: int, post_id: int) -> models.Reaction:
    """Like a post.  If already liked, return existing reaction."""
    reaction = (
        db.query(models.Reaction)
        .filter(
            models.Reaction.user_id == user_id,
            models.Reaction.post_id == post_id,
            models.Reaction.type == "like",
        )
        .first()
    )
    if reaction:
        return reaction
    reaction = models.Reaction(post_id=post_id, user_id=user_id, type="like")
    db.add(reaction)
    db.commit()
    db.refresh(reaction)
    return reaction


def unlike_post(db: Session, user_id: int, post_id: int) -> None:
    """Remove a like reaction from a post."""
    reaction = (
        db.query(models.Reaction)
        .filter(
            models.Reaction.user_id == user_id,
            models.Reaction.post_id == post_id,
            models.Reaction.type == "like",
        )
        .first()
    )
    if reaction:
        db.delete(reaction)
        db.commit()


def add_comment(db: Session, user_id: int, post_id: int, content: str) -> models.Comment:
    """Add a user comment to a post.

    This helper creates a comment authored by a user.  For influencer
    replies, use `add_influencer_reply` instead.
    """
    comment = models.Comment(
        post_id=post_id,
        user_id=user_id,
        influencer_id=None,
        content=content,
        author_type="user",
    )
    db.add(comment)
    db.commit()
    db.refresh(comment)
    return comment


def add_influencer_reply(
    db: Session,
    post_id: int,
    influencer: models.Influencer,
    content: str,
) -> models.Comment:
    """Create an in‑character reply from an influencer to a post.

    The reply is stored as a comment with `author_type='influencer'` and
    references the influencer via `influencer_id`.  The user_id is left
    null since the comment is authored by an AI, not a specific user.
    """
    comment = models.Comment(
        post_id=post_id,
        user_id=None,
        influencer_id=influencer.id,
        content=content,
        author_type="influencer",
    )
    db.add(comment)
    db.commit()
    db.refresh(comment)
    return comment


def set_influencer_reply_mode(db: Session, influencer_id: int, reply_mode: str) -> models.Influencer:
    """Update an influencer's reply mode.

    Validates that the influencer exists and then sets the reply_mode
    attribute.  Returns the updated influencer.
    """
    influencer = db.query(models.Influencer).filter(models.Influencer.id == influencer_id).first()
    if influencer:
        influencer.reply_mode = reply_mode
        db.commit()
        db.refresh(influencer)
    return influencer


def get_posts(db: Session, skip: int = 0, limit: int = 20) -> List[models.Post]:
    """Retrieve posts sorted by creation date descending (infinite scroll)."""
    return (
        db.query(models.Post)
        .order_by(models.Post.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )


def get_trending_posts(db: Session, limit: int = 20) -> List[models.Post]:
    """Retrieve trending posts based on reactions and comments in the last 24 hours."""
    since = datetime.utcnow() - timedelta(hours=24)
    posts = db.query(models.Post).filter(models.Post.created_at >= since).all()
    def trending_score(post: models.Post) -> int:
        likes = sum(1 for r in post.reactions if r.type == "like")
        shares = sum(1 for r in post.reactions if r.type != "like")
        comments = len(post.comments)
        return likes + shares + comments
    posts.sort(key=trending_score, reverse=True)
    return posts[:limit]