"""Deterministic mock provider.

This is used for local dev and offline-friendly builds.
"""

from __future__ import annotations

import random

from ..generation.spec import InfluencerSpec, StarterArc, ToneGuide
from ..generation.spec import StarterPost
from .base import LLMProvider


class MockProvider(LLMProvider):
    def __init__(self, model: str = "mock-v1"):
        self.name = "mock"
        self.model = model

    def generate_influencer_spec(self, *, niche: str, vibe: str, seed: int, posting_frequency: int) -> InfluencerSpec:
        rng = random.Random(seed)
        adjective = rng.choice(["Neon", "Savvy", "Viral", "Cosmic", "Tactical", "Chaos", "Clean", "Oracle"])
        handle = f"{adjective}{niche.capitalize()}"

        bio = f"{handle} delivers {vibe.lower()} takes on {niche.lower()} with a running storyline and punchy formats."
        lore = (
            f"Born from {niche.lower()} obsession and {vibe.lower()} energy, {handle} is here to build a cult following "
            f"one post at a time."
        )

        pillars = [
            f"{niche.capitalize()} breakdowns",
            f"Hot takes & predictions",
            f"Behind-the-scenes lore",
            f"Community debates",
        ]
        rng.shuffle(pillars)
        pillars = pillars[:4]

        arc = StarterArc(
            title=f"{niche.capitalize()}: The Redemption Season",
            beats=[
                "Origin reveal",
                "A rival appears",
                "A bold prediction",
                "The payoff moment",
            ],
        )

        tone = ToneGuide(
            voice=("savage" if vibe.lower() in {"savage", "chaotic"} else "wholesome"),
            dos=["Use short punchlines", "Stay on niche", "Ask questions"],
            donts=["Hate speech", "Doxxing", "Explicit content"],
        )

        prompts = [
            f"High-quality portrait of a {vibe.lower()} {niche.lower()} influencer, neon studio lighting, photorealistic",
            f"Alternate angle portrait of the same {niche.lower()} influencer, cinematic lighting, sharp focus",
            f"Wide banner of {handle} brand, {niche.lower()} themed, bold typography, modern",
        ]

        return InfluencerSpec(
            name=handle,
            bio=bio,
            lore=lore,
            tone_guide=tone,
            content_pillars=pillars,
            starter_arc=arc,
            starter_posts=[],  # pipeline will fill deterministically
            image_prompts=prompts,
            provider=self.name,
            model=self.model,
        )

    def generate_posts(
        self,
        *,
        influencer_name: str,
        niche: str,
        style: str,
        lore: str,
        tone_voice: str,
        content_pillars: list[str],
        current_arc: str,
        mode: str,
        seed: int,
        count: int,
    ) -> list[StarterPost]:
        """Deterministic post generator for MVP dev."""
        rng = random.Random(seed)
        formats = ["post", "thread", "poll", "story", "meme"]
        hooks_by_mode = {
            "wholesome": ["Real talk:", "Friendly reminder:", "We got this:", "Quick win:"],
            "savage": ["Hot take:", "Listen:", "Be honest:", "Unpopular opinion:"],
            "educational": ["Quick lesson:", "Breakdown:", "Here’s the play:", "Explain it like I’m 5:"],
            "drama": ["Breaking:", "Plot twist:", "This is wild:", "Main character energy:"],
        }
        hooks = hooks_by_mode.get(mode, hooks_by_mode["wholesome"])

        pillars = content_pillars or ["updates", "hot takes", "behind-the-scenes"]
        posts: list[StarterPost] = []
        for i in range(count):
            fmt = formats[i % len(formats)]
            pillar = pillars[i % len(pillars)]
            hook = rng.choice(hooks)
            beat = current_arc or ""

            if fmt == "poll":
                text = f"{hook} {pillar}. What’s your vote?\nA) Yes\nB) No\nC) I need context"
            elif fmt == "thread":
                text = (
                    f"{hook} {pillar}. Thread 🧵\n"
                    f"1) {beat or 'Context'}\n2) The real point\n3) What you should do next"
                )
            elif fmt == "story":
                text = f"{hook} Story time. {lore[:120]}…\nAnd here’s why {pillar.lower()} matters today."
            elif fmt == "meme":
                text = f"{hook} When you think you understand {pillar.lower()}… and reality shows up."
            else:
                text = f"{hook} {pillar}. {beat}".strip()

            posts.append(StarterPost(type=fmt, text=text, meta={"mode": mode}))
        return posts
