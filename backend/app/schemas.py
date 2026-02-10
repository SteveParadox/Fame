"""
Pydantic schemas for FameForge API requests and responses.

These data classes validate and serialize data between external clients and
our internal ORM models.  We separate read and write schemas so sensitive
fields like passwords do not accidentally leak in API responses.
"""

from typing import List, Optional

from pydantic import BaseModel, EmailStr, Field, field_validator
from datetime import datetime, date


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

    # Optional deterministic seed for generation
    seed: Optional[int] = Field(None, ge=0, le=2_147_483_647, description="Seed for deterministic generation")

    # Provider options (mock, ollama, ...)
    llm_provider: Optional[str] = Field(None, description="LLM provider: mock|ollama")
    llm_model: Optional[str] = Field(None, description="Model name for the selected provider (e.g., llama3)")


class Influencer(InfluencerBase):
    """Response schema for returning influencer details."""
    id: int
    owner_id: int
    current_arc: Optional[str] = None
    posting_frequency: int
    # Represent content pillars as a list; the DB stores them as a comma-separated string.
    content_pillars: Optional[List[str]] = None
    seed: Optional[int] = None
    generation_provider: Optional[str] = None
    generation_model: Optional[str] = None
    tone_guide_json: Optional[dict] = None
    starter_arc_json: Optional[dict] = None
    image_prompts_json: Optional[List[str]] = None

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
    email_verified: bool = False
    onboarding_completed: bool = False
    influencers: List[Influencer] = []

    class Config:
        orm_mode = True


# -----------------------------------------------------------------------------
# Auth Phase B schemas (verification + password reset)


class EmailOnly(BaseModel):
    email: EmailStr


class VerifyEmailPayload(BaseModel):
    token: str


class ResetPasswordPayload(BaseModel):
    token: str
    new_password: str = Field(..., min_length=8)


# -----------------------------------------------------------------------------
# Onboarding schemas

class OnboardingPreferencesUpdate(BaseModel):
    preferred_niches: List[str] = Field(default_factory=list)
    preferred_styles: List[str] = Field(default_factory=list)


class OnboardingStatus(BaseModel):
    completed: bool
    preferred_niches: List[str] = Field(default_factory=list)
    preferred_styles: List[str] = Field(default_factory=list)
    followed_count: int
    created_influencers_count: int
    next_action: str


class InfluencerPreviewRequest(BaseModel):
    niche: str
    vibe: str
    posting_frequency: int = Field(..., ge=1, le=100)
    seed: int | None = None
    llm_provider: str | None = None
    llm_model: str | None = None


from .generation.spec import InfluencerSpec as InfluencerSpecModel


class InfluencerPreviewResponse(BaseModel):
    seed: int
    spec: InfluencerSpecModel


# -----------------------------------------------------------------------------
# Creator Studio schemas


class StudioInfluencer(BaseModel):
    id: int
    name: str
    niche: str
    style: str
    posting_frequency: int

    class Config:
        orm_mode = True


class StudioPost(BaseModel):
    id: int
    influencer_id: int
    content: str
    mode: str
    post_type: str
    status: str
    created_at: datetime
    scheduled_at: Optional[datetime] = None
    meta: Optional[dict] = None

    class Config:
        orm_mode = True


class StudioPostUpdate(BaseModel):
    content: Optional[str] = None
    mode: Optional[str] = None
    post_type: Optional[str] = None
    status: Optional[str] = None
    scheduled_at: Optional[datetime] = None


class StudioGeneratePreviewRequest(BaseModel):
    count: int = Field(5, ge=1, le=20)
    mode: str = Field("wholesome", description="wholesome|savage|educational|drama")
    seed: Optional[int] = None
    llm_provider: Optional[str] = None
    llm_model: Optional[str] = None


class StudioGeneratePreviewResponse(BaseModel):
    seed: int
    items: List[dict]


class StudioCommitGeneratedRequest(BaseModel):
    seed: int
    items: List[dict]
    # optional schedule baseline; if provided, posts will be staggered
    schedule_start: Optional[datetime] = None


class StudioCalendarItem(BaseModel):
    id: int
    scheduled_at: datetime
    content: str
    mode: str
    status: str
    post_type: str

    class Config:
        orm_mode = True


class StudioCalendarResponse(BaseModel):
    items: List[StudioCalendarItem]


# -----------------------------------------------------------------------------
# Post, Comment, Reaction, and Follow schemas
#
class Post(BaseModel):
    """Simplified schema for posts returned in the feed."""

    id: int
    influencer_id: int
    content: str
    mode: Optional[str] = None
    post_type: Optional[str] = None
    status: Optional[str] = None
    created_at: datetime
    scheduled_at: Optional[datetime] = None

    class Config:
        orm_mode = True


# -----------------------------------------------------------------------------
# Feed v2 schemas (production-friendly: denormalized, cursor-paginated)

class InfluencerMini(BaseModel):
    id: int
    name: str
    niche: str
    style: str
    avatar_url: Optional[str] = None


class FeedPostV2(BaseModel):
    id: int
    created_at: datetime
    content: str
    mode: Optional[str] = None
    post_type: Optional[str] = None
    influencer: InfluencerMini
    like_count: int
    comment_count: int
    is_liked: Optional[bool] = None
    is_following: Optional[bool] = None
    poll: Optional["PollMeta"] = None

    class Config:
        orm_mode = True


class FeedPageV2(BaseModel):
    items: List[FeedPostV2]
    next_cursor: Optional[str] = None


class PollMeta(BaseModel):
    question: str
    options: List[str]
    ends_at: Optional[datetime] = None
    counts: List[int] = Field(default_factory=list)
    total_votes: int = 0
    user_choice: Optional[int] = None


FeedPostV2.model_rebuild()


class DailyChallenge(BaseModel):
    id: int
    day: date
    kind: str
    prompt: str
    options: List[str]
    total_votes: int
    counts: List[int]
    user_choice: Optional[int] = None
    influencer: Optional[InfluencerMini] = None
    post_id: Optional[int] = None
    resolved: bool = False
    winning_option_index: Optional[int] = None


class DailyChallengeVoteRequest(BaseModel):
    option_index: int = Field(..., ge=0)


class Badge(BaseModel):
    code: str
    name: str
    description: str
    rarity: str
    icon: Optional[str] = None


class GamificationStatus(BaseModel):
    current_streak: int
    longest_streak: int
    xp: int
    level: int
    badges: List[Badge]


class CommentV2(BaseModel):
    id: int
    post_id: int
    content: str
    author_type: str
    created_at: datetime
    user_id: Optional[int] = None
    influencer_id: Optional[int] = None
    influencer: Optional[InfluencerMini] = None

    class Config:
        orm_mode = True


class CommentPageV2(BaseModel):
    items: List[CommentV2]
    next_cursor: Optional[str] = None


class CommentPageV2(BaseModel):
    items: List[CommentV2]
    next_cursor: Optional[str] = None


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


# -----------------------------------------------------------------------------
# Dashboard schemas
#

class InfluencerSummary(BaseModel):
    id: int
    name: str
    niche: str
    style: str
    posting_frequency: int

    class Config:
        orm_mode = True


class EngagementStats(BaseModel):
    posts_7d: int
    likes_7d: int
    comments_7d: int


class TokenHolding(BaseModel):
    influencer_id: int
    balance: float
    avg_buy_price: float | None = None
    last_trade_price: float | None = None
    trades_7d: int = 0


class DashboardResponse(BaseModel):
    user_id: int
    created_influencers: list[InfluencerSummary]
    followed_influencers: list[InfluencerSummary]
    engagement: EngagementStats
    token_holdings: list[TokenHolding]


# -----------------------------------------------------------------------------
# Influencer analytics schemas
#

class InfluencerAnalyticsTotals(BaseModel):
    posts: int
    likes: int
    comments: int
    followers: int
    last_price: float | None = None


class InfluencerAnalyticsPoint(BaseModel):
    date: str  # YYYY-MM-DD
    posts: int
    likes: int
    comments: int
    followers_added: int
    followers_total: int
    price: float | None = None


class InfluencerAnalyticsResponse(BaseModel):
    influencer_id: int
    days: int
    points: list[InfluencerAnalyticsPoint]
    totals: InfluencerAnalyticsTotals


# -----------------------------------------------------------------------------
# Notifications
#

class Notification(BaseModel):
    id: int
    type: str
    message: str
    data: dict | None = None
    is_read: bool
    created_at: datetime
    read_at: datetime | None = None

    class Config:
        orm_mode = True