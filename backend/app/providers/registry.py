"""Provider registry.

Select providers via request fields or env vars.
"""

from __future__ import annotations

import os

from .base import LLMProvider
from .mock import MockProvider
from .ollama import OllamaProvider


def get_llm_provider(provider_name: str | None, model: str | None) -> LLMProvider:
    name = (provider_name or os.getenv("GEN_PROVIDER") or "mock").lower()

    if name == "ollama":
        m = model or os.getenv("OLLAMA_MODEL") or "llama3"
        base_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
        return OllamaProvider(model=m, base_url=base_url)

    # default: mock
    return MockProvider(model=model or "mock-v1")
