"""Pydantic models for structured influencer generation.

The goal is to keep generation deterministic and UI-safe. Providers (mock, Ollama,
etc.) should output JSON compatible with these models.
"""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


class ToneGuide(BaseModel):
    voice: Literal["wholesome", "savage", "educational", "drama", "professional", "chaotic"] = "wholesome"
    dos: List[str] = Field(default_factory=list)
    donts: List[str] = Field(default_factory=list)


class StarterArc(BaseModel):
    title: str
    beats: List[str] = Field(default_factory=list)


class StarterPost(BaseModel):
    type: Literal["post", "thread", "poll", "story", "meme"] = "post"
    text: str
    meta: Dict[str, Any] = Field(default_factory=dict)


class InfluencerSpec(BaseModel):
    name: str
    bio: str
    lore: str
    tone_guide: ToneGuide
    content_pillars: List[str]
    starter_arc: StarterArc
    starter_posts: List[StarterPost] = Field(default_factory=list)
    image_prompts: List[str] = Field(default_factory=list)

    # Provider bookkeeping
    provider: Optional[str] = None
    model: Optional[str] = None
