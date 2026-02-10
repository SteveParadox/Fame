"""Post generation helpers for creator studio.

These functions generate additional posts for an existing influencer using a
selected provider (Ollama/mock/etc.). If a provider can't generate, we fall back
to deterministic templates so the studio remains usable offline.
"""

from __future__ import annotations

import random
from typing import List

from .moderation import assert_safe_text, sanitize
from .spec import StarterPost
from ..providers.base import LLMProvider


def _fallback_posts(*, niche: str, pillars: List[str], current_arc: str, mode: str, seed: int, count: int) -> List[StarterPost]:
    rng = random.Random(seed)
    formats = ["post", "thread", "poll", "story", "meme"]
    hooks_by_mode = {
        "wholesome": ["Quick win:", "Friendly reminder:", "You got this:", "Small W:", "Good energy:"],
        "savage": ["Hot take:", "Be honest:", "Stop lying:", "This is painful:", "Let's not pretend:"],
        "educational": ["Lesson:", "Breakdown:", "Tactics:", "Explain like I'm five:", "Here's the deal:"],
        "drama": ["Breaking:", "Plot twist:", "The tea:", "Main character moment:", "We need to talk:"],
    }
    hooks = hooks_by_mode.get(mode, hooks_by_mode["wholesome"])
    pillars = pillars or [f"{niche} takes", "predictions", "community"]

    posts: List[StarterPost] = []
    for i in range(count):
        fmt = formats[i % len(formats)]
        pillar = pillars[i % len(pillars)]
        hook = rng.choice(hooks)
        if fmt == "poll":
            text = f"{hook} {pillar}. What's your call?\nA) Agree\nB) Disagree\nC) Explain"
        elif fmt == "thread":
            text = f"{hook} {pillar}. Thread 🧵\n1) Context\n2) The key point\n3) What to watch next"
        elif fmt == "story":
            text = f"{hook} {current_arc or 'Story time'}: {pillar}. Here's what people miss..."
        elif fmt == "meme":
            text = f"{hook} When {pillar.lower()} hits and everyone suddenly becomes an expert."
        else:
            text = f"{hook} {pillar}.".strip()
        posts.append(StarterPost(type=fmt, text=text, meta={"mode": mode, "by": "fallback"}))
    return posts


def generate_posts_batch(
    provider: LLMProvider,
    *,
    influencer_name: str,
    niche: str,
    style: str,
    lore: str,
    tone_voice: str,
    pillars: List[str],
    current_arc: str,
    mode: str,
    seed: int,
    count: int,
) -> List[StarterPost]:
    """Generate `count` posts, moderating and sanitizing output."""
    try:
        posts = provider.generate_posts(
            influencer_name=influencer_name,
            niche=niche,
            style=style,
            lore=lore,
            tone_voice=tone_voice,
            content_pillars=pillars,
            current_arc=current_arc,
            mode=mode,
            seed=seed,
            count=count,
        )
    except Exception:
        posts = _fallback_posts(niche=niche, pillars=pillars, current_arc=current_arc, mode=mode, seed=seed, count=count)

    safe_posts: List[StarterPost] = []
    for p in posts[:count]:
        text = sanitize(p.text)
        assert_safe_text(text, "post.text")
        meta = dict(p.meta or {})
        meta.setdefault("mode", mode)
        safe_posts.append(StarterPost(type=p.type or "post", text=text, meta=meta))
    return safe_posts
