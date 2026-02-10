"""Lightweight moderation and sanitization.

This is not a replacement for a real moderation model, but it prevents the most
obvious foot-guns and keeps 'savage' from turning into 'bannable'.
"""

from __future__ import annotations

import re
from typing import Iterable


_BANNED_SUBSTRINGS = [
    # Slurs and extreme content should live here. Keep short for MVP.
    "kill yourself",
    "doxx",
    "nazi",
]

_PHONE_RE = re.compile(r"\b(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{2,4}\)?[\s-]?)?\d{3,4}[\s-]?\d{3,4}\b")
_EMAIL_RE = re.compile(r"\b[^\s@]+@[^\s@]+\.[^\s@]+\b")


def contains_banned(text: str) -> bool:
    t = (text or "").lower()
    return any(bad in t for bad in _BANNED_SUBSTRINGS)


def contains_pii(text: str) -> bool:
    if not text:
        return False
    # Basic PII detection heuristics
    if _EMAIL_RE.search(text):
        return True
    if _PHONE_RE.search(text):
        return True
    return False


def sanitize(text: str) -> str:
    if not text:
        return ""
    cleaned = text.strip()
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned


def assert_safe_text(text: str, field_name: str = "text") -> None:
    if contains_banned(text):
        raise ValueError(f"Unsafe content detected in {field_name}.")
    if contains_pii(text):
        raise ValueError(f"Possible PII detected in {field_name}.")


def assert_safe_list(values: Iterable[str], field_name: str) -> None:
    for v in values:
        assert_safe_text(v, field_name=field_name)
