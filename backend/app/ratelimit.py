"""Redis-backed rate limiting.

Phase A replaces the previous in-memory limiter with a Redis-based one so
limits are enforced across processes (api workers, celery workers) and
survive restarts.

We use a simple INCR-with-expiry strategy:
 - INCR key
 - if value == 1: EXPIRE key window

This is fast, works well for fixed windows, and is easy to reason about.
"""

import os
from typing import Optional, Callable

from fastapi import HTTPException, Request
import redis.asyncio as redis


REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
_redis = redis.from_url(REDIS_URL, decode_responses=True)


async def hit_limit(key: str, limit: int, window_seconds: int) -> int:
    """Increment key and return current count.

    Raises on Redis errors only if RATE_LIMIT_FAIL_OPEN is false.
    """
    try:
        pipe = _redis.pipeline()
        pipe.incr(key)
        pipe.ttl(key)
        count, ttl = await pipe.execute()
        if ttl == -1:
            await _redis.expire(key, window_seconds)
        return int(count)
    except Exception:
        # Fail-open by default so Redis blips don't take down the API.
        fail_open = os.getenv("RATE_LIMIT_FAIL_OPEN", "true").lower() == "true"
        if fail_open:
            return 0
        raise


def rate_limit_dependency(
    *,
    scope: str,
    limit: int,
    window_seconds: int,
    key_func: Optional[Callable[[Request], str]] = None,
):
    """Return a FastAPI dependency enforcing a Redis rate limit."""

    async def _dep(request: Request) -> None:
        base = key_func(request) if key_func else request.client.host if request.client else "unknown"
        key = f"rl:{scope}:{base}"
        count = await hit_limit(key, limit, window_seconds)
        if count and count > limit:
            raise HTTPException(status_code=429, detail="Rate limit exceeded")

    return _dep


def user_rate_limit_dependency(scope: str, limit: int, window_seconds: int, user_id: int):
    """Convenience helper for per-user keys.

    Use this when you already know the user_id.
    """

    async def _dep(_: Request) -> None:
        key = f"rl:{scope}:user:{user_id}"
        count = await hit_limit(key, limit, window_seconds)
        if count and count > limit:
            raise HTTPException(status_code=429, detail="Rate limit exceeded")

    return _dep
