"""
SQLAlchemy models for FameForge.

These models define the core database schema: users and influencers.  Each
influencer belongs to a user (the creator).  Additional tables such as
posts, comments, and tokens can be added as the project grows.
"""

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import relationship
from datetime import datetime

from .database import Base


class User(Base):
    """Database model representing an authenticated user of the platform."""

    __tablename__ = "users"

    id: int = Column(Integer, primary_key=True, index=True)
    email: str = Column(String, unique=True, index=True, nullable=False)
    hashed_password: str = Column(String, nullable=False)
    is_active: bool = Column(Boolean, default=True)

    # A user may own zero or more influencers.
    influencers = relationship("Influencer", back_populates="owner")

    # A user may follow many influencers
    follows = relationship("Follow", back_populates="user", cascade="all, delete-orphan")

    # A user may comment on posts
    comments = relationship("Comment", back_populates="user", cascade="all, delete-orphan")

    # A user may react to posts
    reactions = relationship("Reaction", back_populates="user", cascade="all, delete-orphan")

    # Ledger entries recording token balances and trades
    wallet_entries = relationship("WalletLedger", back_populates="user", cascade="all, delete-orphan")
    trades = relationship("Trade", back_populates="user", cascade="all, delete-orphan")


class Influencer(Base):
    """Database model representing an AI influencer owned by a user."""

    __tablename__ = "influencers"

    id: int = Column(Integer, primary_key=True, index=True)
    name: str = Column(String, index=True, nullable=False)
    bio: str = Column(Text, nullable=False)
    niche: str = Column(String, nullable=False)
    style: str = Column(String, nullable=False)
    face_url: str = Column(String, nullable=True)
    lore: str = Column(Text, nullable=True)
    current_arc: str = Column(String, nullable=True)
    owner_id: int = Column(Integer, ForeignKey("users.id"), nullable=False)

    # How frequently the influencer should post (number of posts per day)
    posting_frequency: int = Column(Integer, default=1)
    # Comma-separated list of content pillars/topics for the influencer
    content_pillars: str = Column(Text, nullable=True)

    owner = relationship("User", back_populates="influencers")

    # An influencer can have many assets (images, banners, etc.)
    assets = relationship("InfluencerAsset", back_populates="influencer", cascade="all, delete-orphan")

    # Posts created by this influencer
    posts = relationship("Post", back_populates="influencer", cascade="all, delete-orphan")

    # Followers
    followers = relationship("Follow", back_populates="influencer", cascade="all, delete-orphan")

    # Ledger entries and trades referencing this influencer
    ledger_entries = relationship("WalletLedger", back_populates="influencer", cascade="all, delete-orphan")
    trades = relationship("Trade", back_populates="influencer", cascade="all, delete-orphan")

    # Reply mode determines the tone of automatic responses to comments.
    # Supported values include 'wholesome', 'savage', 'educational', and 'drama'.
    reply_mode: str = Column(String, default="wholesome")

    # Comments authored by this influencer (in‑character replies)
    comments = relationship("Comment", back_populates="influencer", cascade="all, delete-orphan")


class InfluencerAsset(Base):
    """Assets associated with an influencer, such as images or banners."""

    __tablename__ = "influencer_assets"

    id: int = Column(Integer, primary_key=True, index=True)
    influencer_id: int = Column(Integer, ForeignKey("influencers.id"), nullable=False)
    url: str = Column(String, nullable=False)
    asset_type: str = Column(String, nullable=False)  # e.g., 'image', 'banner'

    influencer = relationship("Influencer", back_populates="assets")


class Post(Base):
    """Posts created by influencers."""

    __tablename__ = "posts"

    id: int = Column(Integer, primary_key=True, index=True)
    influencer_id: int = Column(Integer, ForeignKey("influencers.id"), nullable=False)
    content: str = Column(Text, nullable=False)
    created_at: datetime = Column(DateTime, default=datetime.utcnow)
    scheduled_at: datetime = Column(DateTime, nullable=True)

    influencer = relationship("Influencer", back_populates="posts")
    comments = relationship("Comment", back_populates="post", cascade="all, delete-orphan")
    reactions = relationship("Reaction", back_populates="post", cascade="all, delete-orphan")


class Follow(Base):
    """Association table representing a user following an influencer."""

    __tablename__ = "follows"

    id: int = Column(Integer, primary_key=True, index=True)
    user_id: int = Column(Integer, ForeignKey("users.id"), nullable=False)
    influencer_id: int = Column(Integer, ForeignKey("influencers.id"), nullable=False)
    created_at: datetime = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="follows")
    influencer = relationship("Influencer", back_populates="followers")


class Comment(Base):
    """Comments made by users on posts."""

    __tablename__ = "comments"

    id: int = Column(Integer, primary_key=True, index=True)
    post_id: int = Column(Integer, ForeignKey("posts.id"), nullable=False)
    # If a comment is made by a user, user_id references the author's user id.
    # For comments authored by an influencer (in-character), user_id may be null and
    # influencer_id will reference the influencer.
    user_id: int = Column(Integer, ForeignKey("users.id"), nullable=True)
    influencer_id: int = Column(Integer, ForeignKey("influencers.id"), nullable=True)
    content: str = Column(Text, nullable=False)
    created_at: datetime = Column(DateTime, default=datetime.utcnow)
    # Identifies whether the comment was authored by a 'user' or 'influencer'.
    author_type: str = Column(String, default="user")

    user = relationship("User", back_populates="comments")
    influencer = relationship("Influencer", back_populates="comments")
    post = relationship("Post", back_populates="comments")


class Reaction(Base):
    """Reactions from users on posts (like, share, etc.)."""

    __tablename__ = "reactions"

    id: int = Column(Integer, primary_key=True, index=True)
    post_id: int = Column(Integer, ForeignKey("posts.id"), nullable=False)
    user_id: int = Column(Integer, ForeignKey("users.id"), nullable=False)
    type: str = Column(String, nullable=False)  # 'like', 'share', etc.
    created_at: datetime = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="reactions")
    post = relationship("Post", back_populates="reactions")


class Job(Base):
    """Scheduled generation tasks for influencers (e.g., content generation jobs)."""

    __tablename__ = "jobs"

    id: int = Column(Integer, primary_key=True, index=True)
    influencer_id: int = Column(Integer, ForeignKey("influencers.id"), nullable=False)
    status: str = Column(String, default="pending")
    result: str = Column(Text, nullable=True)
    scheduled_at: datetime = Column(DateTime, nullable=True)
    created_at: datetime = Column(DateTime, default=datetime.utcnow)

    influencer = relationship("Influencer")


class WalletLedger(Base):
    """Records off-chain token balances and transactions for users."""

    __tablename__ = "wallet_ledger"

    id: int = Column(Integer, primary_key=True, index=True)
    user_id: int = Column(Integer, ForeignKey("users.id"), nullable=False)
    influencer_id: int = Column(Integer, ForeignKey("influencers.id"), nullable=False)
    amount = Column(Numeric(precision=18, scale=8), nullable=False)
    timestamp: datetime = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="wallet_entries")
    influencer = relationship("Influencer", back_populates="ledger_entries")


class Trade(Base):
    """History of buy/sell actions for influencer tokens."""

    __tablename__ = "trades"

    id: int = Column(Integer, primary_key=True, index=True)
    user_id: int = Column(Integer, ForeignKey("users.id"), nullable=False)
    influencer_id: int = Column(Integer, ForeignKey("influencers.id"), nullable=False)
    amount = Column(Numeric(precision=18, scale=8), nullable=False)
    price = Column(Numeric(precision=18, scale=8), nullable=False)
    trade_type: str = Column(String, nullable=False)  # 'buy' or 'sell'
    timestamp: datetime = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="trades")
    influencer = relationship("Influencer", back_populates="trades")