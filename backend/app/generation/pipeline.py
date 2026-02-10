"""Generation pipeline orchestration.

Providers return an `InfluencerSpec`. We validate, moderate, and (if needed)
fill missing pieces (like starter posts) deterministically based on a seed.
"""

from __future__ import annotations

import random
from datetime import datetime
from typing import Optional

from .spec import InfluencerSpec, StarterPost
from .moderation import assert_safe_list, assert_safe_text, sanitize
from ..providers.base import LLMProvider


def _fill_starter_posts(spec: InfluencerSpec, seed: int, count: int = 10) -> None:
    """Create varied starter posts if provider didn't supply them."""
    rng = random.Random(seed)
    formats = ["post", "thread", "poll", "story", "meme"]

    beats = list(spec.starter_arc.beats or [])
    pillars = list(spec.content_pillars or [])
    if not pillars:
        pillars = ["updates", "hot takes", "behind-the-scenes"]

    posts: list[StarterPost] = []
    for i in range(count):
        fmt = formats[i % len(formats)]
        pillar = pillars[i % len(pillars)]
        beat = beats[i % len(beats)] if beats else ""

        hook = rng.choice([
            "Hot take:",
            "Quick one:",
            "Story time:",
            "Poll:",
            "Unpopular opinion:",
            "Breaking:",
        ])

        if fmt == "poll":
            text = f"{hook} {pillar}. Agree?\nA) Yes\nB) No\nC) Explain yourself"
        elif fmt == "thread":
            text = f"{hook} {pillar}. Thread 🧵\n1) {beat or 'Context'}\n2) The real point\n3) What you should do next"
        elif fmt == "story":
            default_story = "Here's how it started"
            text = f"{hook} {beat or default_story}... and why {pillar.lower()} matters today."
        elif fmt == "meme":
            text = f"{hook} When you think you understand {pillar.lower()}... and then reality shows up."
        else:
            text = f"{hook} {pillar}. {beat}".strip()

        posts.append(StarterPost(type=fmt, text=text))

    spec.starter_posts = posts


def generate_influencer_spec(
    provider: LLMProvider,
    *,
    niche: str,
    vibe: str,
    seed: int,
    posting_frequency: int,
    count_posts: int = 10,
) -> InfluencerSpec:
    """Generate, validate, and normalize an influencer spec."""
    raw = provider.generate_influencer_spec(
        niche=niche,
        vibe=vibe,
        seed=seed,
        posting_frequency=posting_frequency,
    )

    # Sanitize
    raw.name = sanitize(raw.name)
    raw.bio = sanitize(raw.bio)
    raw.lore = sanitize(raw.lore)
    raw.starter_arc.title = sanitize(raw.starter_arc.title)
    raw.starter_arc.beats = [sanitize(b) for b in raw.starter_arc.beats]
    raw.content_pillars = [sanitize(p) for p in raw.content_pillars]
    raw.image_prompts = [sanitize(p) for p in raw.image_prompts]
    for p in raw.starter_posts:
        p.text = sanitize(p.text)

    # Moderate
    assert_safe_text(raw.name, "name")
    assert_safe_text(raw.bio, "bio")
    assert_safe_text(raw.lore, "lore")
    assert_safe_list(raw.content_pillars, "content_pillars")
    assert_safe_list(raw.starter_arc.beats, "starter_arc.beats")

    if not raw.starter_posts:
        _fill_starter_posts(raw, seed=seed, count=count_posts)
    else:
        # Ensure at least `count_posts`
        if len(raw.starter_posts) < count_posts:
            _fill_starter_posts(raw, seed=seed, count=count_posts)

    return raw
