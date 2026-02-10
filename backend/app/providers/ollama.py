"""Ollama provider.

Calls a local Ollama server (default http://localhost:11434) to generate a
structured JSON influencer spec.
"""

from __future__ import annotations

import json
from typing import Any, Dict

import httpx

from ..generation.spec import InfluencerSpec, StarterPost
from .base import LLMProvider


class OllamaProvider(LLMProvider):
    def __init__(self, model: str, base_url: str = "http://localhost:11434"):
        self.name = "ollama"
        self.model = model
        self.base_url = base_url.rstrip("/")

    def _prompt(self, niche: str, vibe: str, seed: int, posting_frequency: int) -> str:
        # Important: ask for JSON ONLY.
        return (
            "You are generating a structured JSON object for an AI influencer profile. "
            "Return JSON ONLY that matches this schema:\n"
            "{\n"
            "  \"name\": string,\n"
            "  \"bio\": string,\n"
            "  \"lore\": string,\n"
            "  \"tone_guide\": {\"voice\": one of [wholesome,savage,educational,drama,professional,chaotic], \"dos\":[string], \"donts\":[string]},\n"
            "  \"content_pillars\": [string],\n"
            "  \"starter_arc\": {\"title\": string, \"beats\":[string]},\n"
            "  \"starter_posts\": [{\"type\": one of [post,thread,poll,story,meme], \"text\": string, \"meta\": object}],\n"
            "  \"image_prompts\": [string]\n"
            "}\n\n"
            f"Niche: {niche}\n"
            f"Vibe: {vibe}\n"
            f"Posting frequency per day: {posting_frequency}\n"
            f"Seed: {seed}\n"
            "Constraints:\n"
            "- Keep it PG-13, no hate speech, no doxxing, no sexual content.\n"
            "- Make content pillars specific and non-overlapping.\n"
            "- Provide exactly 10 starter_posts with varied types.\n"
            "- Provide 3 to 6 image_prompts (avatars + banner).\n"
        )

    def generate_influencer_spec(self, *, niche: str, vibe: str, seed: int, posting_frequency: int) -> InfluencerSpec:
        prompt = self._prompt(niche=niche, vibe=vibe, seed=seed, posting_frequency=posting_frequency)

        payload: Dict[str, Any] = {
            "model": self.model,
            "prompt": prompt,
            "stream": False,
            "options": {"seed": seed},
        }

        url = f"{self.base_url}/api/generate"
        with httpx.Client(timeout=60.0) as client:
            resp = client.post(url, json=payload)
            resp.raise_for_status()
            data = resp.json()

        # Ollama returns {response: "..."}
        text = data.get("response", "").strip()
        # Some models wrap with code fences. Strip them.
        if text.startswith("```"):
            text = text.strip("`")
            # remove optional json tag
            text = text.replace("json\n", "", 1)

        obj = json.loads(text)
        spec = InfluencerSpec.model_validate(obj)
        spec.provider = self.name
        spec.model = self.model
        return spec

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
        """Generate a list of posts as structured JSON.

        Returns JSON ONLY. If the model fails, this will raise.
        """

        prompt = (
            "You are generating a JSON array of posts for an AI influencer. "
            "Return JSON ONLY as a list of objects, each with keys: type, text, meta.\n"
            "type must be one of [post,thread,poll,story,meme].\n"
            "meta should be an object.\n\n"
            f"Influencer: {influencer_name}\n"
            f"Niche: {niche}\n"
            f"Style/Vibe: {style}\n"
            f"Lore: {lore}\n"
            f"Tone voice: {tone_voice}\n"
            f"Current arc: {current_arc}\n"
            f"Content pillars: {', '.join(content_pillars)}\n"
            f"Reply mode for this batch: {mode}\n"
            f"Seed: {seed}\n\n"
            "Constraints:\n"
            "- Keep it PG-13. No hate speech, no doxxing, no sexual content.\n"
            f"- Generate exactly {count} posts with varied types.\n"
            "- Make each post distinct and punchy.\n"
        )

        payload: Dict[str, Any] = {
            "model": self.model,
            "prompt": prompt,
            "stream": False,
            "options": {"seed": seed},
        }

        url = f"{self.base_url}/api/generate"
        with httpx.Client(timeout=60.0) as client:
            resp = client.post(url, json=payload)
            resp.raise_for_status()
            data = resp.json()

        text = data.get("response", "").strip()
        if text.startswith("```"):
            text = text.strip("`")
            text = text.replace("json\n", "", 1)

        arr = json.loads(text)
        posts: list[StarterPost] = [StarterPost.model_validate(p) for p in arr]
        # Ensure mode is stored for downstream UI
        for p in posts:
            p.meta = dict(p.meta or {})
            p.meta.setdefault("mode", mode)
        return posts

