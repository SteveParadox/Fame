"""Provider interface for influencer generation."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import List

from ..generation.spec import InfluencerSpec, StarterPost


class LLMProvider(ABC):
    name: str
    model: str

    @abstractmethod
    def generate_influencer_spec(
        self,
        *,
        niche: str,
        vibe: str,
        seed: int,
        posting_frequency: int,
    ) -> InfluencerSpec:
        raise NotImplementedError

    # Optional: post generation. Providers may implement this for higher
    # quality output. The pipeline will fall back to deterministic templates.
    def generate_posts(
        self,
        *,
        influencer_name: str,
        niche: str,
        style: str,
        lore: str,
        tone_voice: str,
        content_pillars: List[str],
        current_arc: str,
        mode: str,
        seed: int,
        count: int,
    ) -> List[StarterPost]:
        raise NotImplementedError
