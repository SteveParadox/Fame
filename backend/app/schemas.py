"""
Pydantic schemas for FameForge API requests and responses.

These data classes validate and serialize data between external clients and
our internal ORM models.  We separate read and write schemas so sensitive
fields like passwords do not accidentally leak in API responses.
"""

from typing import List, Optional

from pydantic import BaseModel, EmailStr, Field, field_validator
from datetime import datetime


class InfluencerBase(BaseModel):
    """Base fields shared by all influencer schemas."""

    name: str
    bio: str
    niche: str
    style: str
    face_url: Optional[str] = None
    lore: Optional[str] = None

    # The reply mode dictates how the influencer responds to comments.  It
    # defaults to 'wholesome' and may be one of: 'wholesome', 'savage',
    # 'educational', or 'drama'.
    reply_mode: Optional[str] = None


class InfluencerCreate(InfluencerBase):
    """Schema for creating an influencer."""
    pass


class InfluencerBuildRequest(BaseModel):
    """Input payload for building a new AI influencer via the factory."""
    niche: str
    vibe: str
    posting_frequency: int = Field(..., ge=1, le=100, description="Number of posts per day/week to generate")


class Influencer(InfluencerBase):
    """Response schema for returning influencer details."""
    id: int
    owner_id: int
    current_arc: Optional[str] = None
    posting_frequency: int
    # Represent content pillars as a list; the DB stores them as a comma-separated string.
    content_pillars: Optional[List[str]] = None

    @field_validator("content_pillars", mode="before")
    def split_content_pillars(cls, v):
        # Convert comma-separated string to a list
        if isinstance(v, str):
            return [p.strip() for p in v.split(",") if p.strip()]
        return v

    class Config:
        orm_mode = True


class UserBase(BaseModel):
    """Base fields for user schemas."""

    email: EmailStr


class UserCreate(UserBase):
    """Schema for creating a new user."""

    password: str = Field(..., min_length=8, description="Plaintext password (will be hashed)")


class User(UserBase):
    """Response schema for user details."""

    id: int
    is_active: bool
    influencers: List[Influencer] = []

    class Config:
        orm_mode = True


# -----------------------------------------------------------------------------
# Post, Comment, Reaction, and Follow schemas
#
class Post(BaseModel):
    """Simplified schema for posts returned in the feed."""

    id: int
    influencer_id: int
    content: str
    created_at: datetime
    scheduled_at: Optional[datetime] = None

    class Config:
        orm_mode = True


class CommentBase(BaseModel):
    content: str


class ReplyModeUpdate(BaseModel):
    """Schema for updating an influencer's reply mode.

    The reply mode controls the tone of automatic replies.  Allowed values
    are 'wholesome', 'savage', 'educational', and 'drama'.
    """
    reply_mode: str = Field(..., description="One of: wholesome, savage, educational, drama")


class Comment(CommentBase):
    id: int
    post_id: int
    user_id: Optional[int] = None
    influencer_id: Optional[int] = None
    author_type: str
    created_at: datetime

    class Config:
        orm_mode = True


class Reaction(BaseModel):
    id: int
    post_id: int
    user_id: int
    type: str
    created_at: datetime

    class Config:
        orm_mode = True


class Follow(BaseModel):
    id: int
    user_id: int
    influencer_id: int
    created_at: datetime

    class Config:
        orm_mode = True