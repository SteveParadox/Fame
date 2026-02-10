"""Realtime event utilities (Redis pub/sub + SSE).

We use Redis Pub/Sub as a lightweight event bus so multiple API instances
and workers can publish events that are streamed to clients via Server-Sent
Events (SSE).

Event payloads are JSON dictionaries with a `type` field.

This is intentionally MVP-simple. If you later want per-user channels,
fan-out, backpressure, etc., upgrade this to a proper event system.
"""

from __future__ import annotations

import asyncio
import json
import os
from datetime import datetime
from typing import Any, AsyncGenerator, Dict, List

import redis.asyncio as redis
import redis as redis_sync


REDIS_URL = os.getenv("REDIS_URL") or os.getenv("CELERY_BROKER_URL") or "redis://localhost:6379/0"
CHANNEL = os.getenv("REALTIME_CHANNEL", "fameforge:events")

# Task-specific event replay (used for build progress streaming)
TASK_EVENTS_PREFIX = os.getenv("TASK_EVENTS_PREFIX", "fameforge:task_events:")
TASK_EVENTS_TTL_SECONDS = int(os.getenv("TASK_EVENTS_TTL_SECONDS", "3600"))


_redis: redis.Redis | None = None
_redis_sync: redis_sync.Redis | None = None


def get_redis() -> redis.Redis:
    global _redis
    if _redis is None:
        _redis = redis.from_url(REDIS_URL, decode_responses=True)
    return _redis


def get_redis_sync() -> redis_sync.Redis:
    """Synchronous Redis client for sync contexts (FastAPI sync routes, Celery)."""
    global _redis_sync
    if _redis_sync is None:
        _redis_sync = redis_sync.from_url(REDIS_URL, decode_responses=True)
    return _redis_sync


def _task_events_key(task_id: str) -> str:
    return f"{TASK_EVENTS_PREFIX}{task_id}"


def record_task_event_sync(task_id: str, event: Dict[str, Any]) -> None:
    """Append a task event to Redis for replay (sync contexts)."""
    try:
        r = get_redis_sync()
        key = _task_events_key(task_id)
        r.rpush(key, json.dumps(event, ensure_ascii=False))
        r.expire(key, TASK_EVENTS_TTL_SECONDS)
    except Exception:
        return


def get_task_events_sync(task_id: str) -> List[Dict[str, Any]]:
    """Fetch previously recorded task events (sync)."""
    try:
        r = get_redis_sync()
        raw = r.lrange(_task_events_key(task_id), 0, -1)
        out: List[Dict[str, Any]] = []
        for item in raw:
            try:
                out.append(json.loads(item))
            except Exception:
                continue
        return out
    except Exception:
        return []


async def get_task_events(task_id: str) -> List[Dict[str, Any]]:
    """Fetch previously recorded task events (async)."""
    try:
        r = get_redis()
        raw = await r.lrange(_task_events_key(task_id), 0, -1)
        out: List[Dict[str, Any]] = []
        for item in raw:
            try:
                out.append(json.loads(item))
            except Exception:
                continue
        return out
    except Exception:
        return []


def publish_task_event_sync(task_id: str, event_type: str, data: Dict[str, Any]) -> None:
    """Publish + record a task-scoped event.

    This lets the frontend subscribe to a per-task stream and also replay prior
    progress events if the client connects late.
    """
    event = {
        "type": event_type,
        "task_id": task_id,
        "ts": datetime.utcnow().isoformat(),
        **data,
    }
    record_task_event_sync(task_id, event)
    publish_event_sync(event)


async def sse_task_stream(task_id: str) -> AsyncGenerator[str, None]:
    """SSE stream that replays + follows events for a single task."""
    # Replay recorded events first
    for evt in await get_task_events(task_id):
        evt_type = evt.get("type", "event")
        yield f"event: {evt_type}\n" + f"data: {json.dumps(evt, ensure_ascii=False)}\n\n"

    r = get_redis()
    pubsub = r.pubsub()
    await pubsub.subscribe(CHANNEL)
    try:
        yield "event: ping\ndata: {}\n\n"
        while True:
            message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
            if message is None:
                yield "event: ping\ndata: {}\n\n"
                await asyncio.sleep(10)
                continue
            data = message.get("data")
            if not data:
                continue
            try:
                obj = json.loads(data)
            except Exception:
                continue
            if obj.get("task_id") != task_id:
                continue
            evt_type = obj.get("type", "event")
            yield f"event: {evt_type}\n" + f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"
    finally:
        try:
            await pubsub.unsubscribe(CHANNEL)
            await pubsub.close()
        except Exception:
            pass


def set_once(key: str, ttl_seconds: int) -> bool:
    """Set a key only if it doesn't already exist (NX) with a TTL.

    Returns True if the key was set (i.e., first time), False otherwise.
    """
    try:
        return bool(get_redis_sync().set(key, "1", nx=True, ex=ttl_seconds))
    except Exception:
        return False


def incr_with_expiry(key: str, ttl_seconds: int) -> int:
    """Increment a counter and ensure it expires.

    Returns the new counter value.
    """
    try:
        r = get_redis_sync()
        val = int(r.incr(key))
        if val == 1:
            r.expire(key, ttl_seconds)
        return val
    except Exception:
        return 0


async def publish_event(event: Dict[str, Any]) -> None:
    """Publish an event to Redis pub/sub."""
    try:
        payload = json.dumps(event, ensure_ascii=False)
        await get_redis().publish(CHANNEL, payload)
    except Exception:
        # MVP: don't crash core flows because realtime is down.
        return


def publish_event_sync(event: Dict[str, Any]) -> None:
    """Synchronous wrapper for publishing events.

    Celery tasks are sync by default; this lets them publish without needing
    an async context.
    """
    try:
        asyncio.run(publish_event(event))
    except RuntimeError:
        # If already in an event loop, schedule it.
        try:
            loop = asyncio.get_event_loop()
            loop.create_task(publish_event(event))
        except Exception:
            return


async def sse_event_stream() -> AsyncGenerator[str, None]:
    """Yield SSE-formatted strings from Redis pub/sub."""
    r = get_redis()
    pubsub = r.pubsub()
    await pubsub.subscribe(CHANNEL)
    try:
        # Initial ping so EventSource opens immediately.
        yield "event: ping\ndata: {}\n\n"
        while True:
            message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
            if message is None:
                # keepalive
                yield "event: ping\ndata: {}\n\n"
                await asyncio.sleep(10)
                continue
            data = message.get("data")
            if not data:
                continue
            # Expect JSON string
            try:
                obj = json.loads(data)
            except Exception:
                obj = {"type": "unknown", "raw": str(data)}
            evt_type = obj.get("type", "event")
            yield f"event: {evt_type}\n" + f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"
    finally:
        try:
            await pubsub.unsubscribe(CHANNEL)
            await pubsub.close()
        except Exception:
            pass