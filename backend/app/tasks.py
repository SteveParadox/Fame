"""
Celery task definitions for the FameForge API.

Celery is used to offload long‑running or asynchronous work from the
FastAPI request/response cycle.  This module configures the Celery app
to use Redis as a broker and result backend.  Tasks defined here can be
enqueued via `.delay()` or `.apply_async()` and their status can be
checked using Celery's `AsyncResult` interface.
"""

import os
from datetime import datetime, timedelta
from celery import Celery
from celery.schedules import crontab
import random
from .database import SessionLocal
from .realtime import publish_event_sync, publish_task_event_sync, incr_with_expiry, set_once
from .notifier import notify_sync
from . import models, crud
from .providers.registry import get_llm_provider
from .generation.pipeline import generate_influencer_spec
from .generation.posts import generate_posts_batch

# Read broker and backend URLs from environment variables with sensible
# defaults pointing at a local Redis instance.  In production, set
# CELERY_BROKER_URL and CELERY_RESULT_BACKEND to your Redis service.
BROKER_URL = os.getenv("CELERY_BROKER_URL", "redis://localhost:6379/0")
RESULT_BACKEND = os.getenv("CELERY_RESULT_BACKEND", BROKER_URL)

celery_app = Celery(
    "fameforge_tasks",
    broker=BROKER_URL,
    backend=RESULT_BACKEND,
)


@celery_app.task(bind=True)
def demo_task(self) -> str:
    """A simple task used for demonstration purposes.

    It returns a static string and could be replaced with more complex
    operations such as content generation or sending emails.
    """
    return "demo-task-result"


def _generate_influencer_name(niche: str, vibe: str) -> str:
    """Generate a simple influencer name based on niche and vibe.

    Combines a random adjective with the capitalised niche to form a unique
    handle.  In production this could call an LLM or name generation service.
    """
    adjectives = ["Mighty", "Savvy", "Viral", "Epic", "Cosmic", "Quantum", "Neon", "Crypto"]
    adjective = random.choice(adjectives)
    return f"{adjective}{niche.capitalize()}"


@celery_app.task(bind=True)
def build_influencer(
    self,
    user_id: int,
    niche: str,
    vibe: str,
    posting_frequency: int,
    seed: int | None = None,
    llm_provider: str | None = None,
    llm_model: str | None = None,
) -> dict:
    """Background task to build a new AI influencer and seed starter content.

    This function generates a name, bio, lore, tone guide, content pillars,
    initial posts, and placeholder images.  It stores the influencer,
    associated assets and posts in the database.  It returns the new
    influencer's ID upon completion.
    """
    db = SessionLocal()
    task_id = getattr(self.request, "id", None) or "unknown"
    try:
        publish_task_event_sync(task_id, "build.progress", {
            "stage": "starting",
            "pct": 5,
            "message": "Booting the influencer factory..."
        })

        # Seeded generation (deterministic when seed provided)
        if seed is None:
            seed = random.SystemRandom().randint(0, 2_147_483_647)

        publish_task_event_sync(task_id, "build.progress", {
            "stage": "provider",
            "pct": 10,
            "message": f"Selecting generation provider..."
        })

        provider = get_llm_provider(llm_provider, llm_model)
        publish_task_event_sync(task_id, "build.progress", {
            "stage": "spec",
            "pct": 25,
            "message": "Generating name, lore, tone guide, pillars, and arc..."
        })
        spec = generate_influencer_spec(
            provider,
            niche=niche,
            vibe=vibe,
            seed=seed,
            posting_frequency=posting_frequency,
            count_posts=10,
        )

        # Back-compat fields
        content_pillars = list(spec.content_pillars)

        publish_task_event_sync(task_id, "build.progress", {
            "stage": "persist",
            "pct": 55,
            "message": "Saving influencer identity to the database..."
        })

        # Create influencer record
        influencer = models.Influencer(
            name=spec.name,
            bio=spec.bio,
            niche=niche,
            style=vibe,
            face_url=None,
            lore=spec.lore,
            current_arc=spec.starter_arc.title,
            owner_id=user_id,
            posting_frequency=posting_frequency,
            content_pillars=",".join(content_pillars),
            seed=seed,
            generation_provider=spec.provider,
            generation_model=spec.model,
            tone_guide_json=spec.tone_guide.model_dump(),
            content_pillars_json=content_pillars,
            starter_arc_json=spec.starter_arc.model_dump(),
            image_prompts_json=list(spec.image_prompts),
            reply_mode=str(spec.tone_guide.voice),
        )
        db.add(influencer)
        db.flush()  # assign ID without committing
        db.add(models.InfluencerTokenState(influencer_id=influencer.id))
        db.commit()
        db.refresh(influencer)

        publish_task_event_sync(task_id, "build.progress", {
            "stage": "posts",
            "pct": 70,
            "message": "Seeding starter posts (mixing formats + scheduling drafts)..."
        })

        # Create starter posts.
        # UX trick: publish the first 2 immediately so the feed isn't empty.
        now = datetime.utcnow()
        for i, sp in enumerate(spec.starter_posts[:10]):
            is_live = i < 2
            scheduled_at = None if is_live else (now + timedelta(hours=12 + 24 * (i - 2)))
            mode = (sp.meta or {}).get("mode") or str(spec.tone_guide.voice) or "wholesome"
            post = models.Post(
                influencer_id=influencer.id,
                content=sp.text,
                mode=mode,
                post_type=sp.type,
                status="published" if is_live else "draft",
                meta=sp.meta,
                scheduled_at=scheduled_at,
            )
            db.add(post)
            db.flush()
            if is_live:
                publish_event_sync(
                    {
                        "type": "post.created",
                        "post_id": post.id,
                        "influencer_id": influencer.id,
                        "content": post.content,
                        "created_at": post.created_at.isoformat() if post.created_at else None,
                    }
                )

        publish_task_event_sync(task_id, "build.progress", {
            "stage": "assets",
            "pct": 85,
            "message": "Storing image prompts + placeholder assets (ready for real image gen)..."
        })

        # Store image prompts as assets (so you can render/regenerate later)
        # Note: url is required, so we use a sentinel and keep the prompt in meta.
        for p in spec.image_prompts:
            db.add(
                models.InfluencerAsset(
                    influencer_id=influencer.id,
                    url="prompt://image",
                    asset_type="image_prompt",
                    meta={"prompt": p},
                )
            )

        # Placeholder profile images (until you wire image generation)
        for i in range(3):
            db.add(
                models.InfluencerAsset(
                    influencer_id=influencer.id,
                    url=f"https://placehold.co/600x600?text={spec.name}+{i+1}",
                    asset_type="image",
                )
            )

        db.commit()

        publish_task_event_sync(task_id, "build.progress", {
            "stage": "finalize",
            "pct": 95,
            "message": "Finalizing build and notifying clients..."
        })

        # Notify clients that a new influencer is ready.
        publish_event_sync(
            {
                "type": "influencer.built",
                "influencer_id": influencer.id,
                "owner_id": user_id,
                "niche": niche,
                "style": vibe,
                "provider": spec.provider,
                "model": spec.model,
                "seed": seed,
            }
        )

        publish_task_event_sync(task_id, "build.progress", {
            "stage": "done",
            "pct": 100,
            "message": "Influencer created. Ready to ship content into the feed."
        })

        publish_task_event_sync(task_id, "build.done", {
            "stage": "done",
            "pct": 100,
            "message": "Influencer ready.",
            "influencer_id": influencer.id,
            "owner_id": user_id,
            "name": spec.name,
        })

        # Return details of the generated influencer
        return {
            "influencer_id": influencer.id,
            "name": spec.name,
            "bio": spec.bio,
            "lore": spec.lore,
            "tone_guide": spec.tone_guide.model_dump(),
            "content_pillars": content_pillars,
            "starter_arc": spec.starter_arc.model_dump(),
            "starter_posts": [p.model_dump() for p in spec.starter_posts[:10]],
            "image_prompts": list(spec.image_prompts),
            "provider": spec.provider,
            "model": spec.model,
            "seed": seed,
        }
    except Exception as e:
        task_id = getattr(self.request, "id", None) or "unknown"
        publish_task_event_sync(task_id, "build.error", {
            "pct": 100,
            "stage": "error",
            "message": str(e)[:300],
        })
        raise
    finally:
        db.close()


@celery_app.task(bind=True)
def regenerate_post(
    self,
    user_id: int,
    post_id: int,
    llm_provider: str | None = None,
    llm_model: str | None = None,
    seed: int | None = None,
) -> dict:
    """Regenerate a single draft post's content for an influencer the user owns."""
    db = SessionLocal()
    task_id = getattr(self.request, "id", None) or "unknown"
    try:
        post = db.query(models.Post).filter(models.Post.id == post_id).first()
        if not post:
            raise ValueError("Post not found")
        influencer = db.query(models.Influencer).filter(models.Influencer.id == post.influencer_id).first()
        if not influencer or influencer.owner_id != user_id:
            raise PermissionError("Not allowed")

        publish_task_event_sync(task_id, "build.progress", {
            "stage": "regenerate",
            "pct": 10,
            "message": "Regenerating post draft..."
        })

        if seed is None:
            seed = random.SystemRandom().randint(0, 2_147_483_647)

        provider = get_llm_provider(llm_provider, llm_model)
        tone_voice = (influencer.tone_guide_json or {}).get("voice") or influencer.reply_mode or "wholesome"
        pillars = list(influencer.content_pillars_json or [])
        current_arc = influencer.current_arc or ""

        mode = post.mode or influencer.reply_mode or "wholesome"
        batch = generate_posts_batch(
            provider,
            influencer_name=influencer.name,
            niche=influencer.niche,
            style=influencer.style,
            lore=influencer.lore or "",
            tone_voice=tone_voice,
            pillars=pillars,
            current_arc=current_arc,
            mode=mode,
            seed=seed,
            count=1,
        )
        new = batch[0]
        post.content = new.text
        post.post_type = new.type or post.post_type
        post.mode = mode
        meta = dict(post.meta or {})
        meta["regenerated_at"] = datetime.utcnow().isoformat()
        meta["mode"] = mode
        post.meta = meta
        db.add(post)
        db.commit()

        publish_task_event_sync(task_id, "build.progress", {
            "stage": "regenerate",
            "pct": 100,
            "message": "Post draft regenerated."
        })
        publish_event_sync({"type": "post.updated", "post_id": post.id, "influencer_id": influencer.id})
        return {"post_id": post.id, "content": post.content, "mode": post.mode}
    finally:
        db.close()


# -----------------------------------------------------------------------------
# Periodic content generation
#

@celery_app.on_after_configure.connect
def setup_periodic_tasks(sender, **kwargs) -> None:
    """Configure periodic Celery tasks.

    Schedules the `generate_daily_posts` task to run every day at midnight (UTC).
    """
    # Run at midnight (00:00 UTC) daily
    sender.add_periodic_task(
        crontab(minute=0, hour=0),
        generate_daily_posts.s(),
        name="generate daily influencer posts",
    )

    # Snapshot daily metrics shortly after midnight (UTC). We snapshot the
    # previous day so charts represent complete days.
    sender.add_periodic_task(
        crontab(minute=5, hour=0),
        snapshot_daily_metrics.s(),
        name="snapshot daily influencer metrics",
    )

    # Publish scheduled drafts every minute
    sender.add_periodic_task(
        crontab(minute="*"),
        publish_scheduled_posts.s(),
        name="publish scheduled posts",
    )

    # Retention: resolve yesterday's daily challenge and create today's.
    sender.add_periodic_task(
        crontab(minute=1, hour=0),
        resolve_yesterday_challenge.s(),
        name="resolve yesterday daily challenge",
    )
    sender.add_periodic_task(
        crontab(minute=2, hour=0),
        create_today_challenge.s(),
        name="create today daily challenge",
    )



@celery_app.task
def publish_scheduled_posts() -> dict:
    """Publish any draft posts whose scheduled time has arrived.

    This makes the 'scheduler' real: build_influencer can create drafts with
    `scheduled_at`, and this task flips them to published and emits SSE events.
    """
    db = SessionLocal()
    now = datetime.utcnow()
    published = 0
    try:
        posts = (
            db.query(models.Post)
            .filter(models.Post.status == "draft", models.Post.scheduled_at != None, models.Post.scheduled_at <= now)
            .all()
        )
        for post in posts:
            post.status = "published"
            post.created_at = now
            published += 1
            publish_event_sync(
                {
                    "type": "post.created",
                    "post_id": post.id,
                    "influencer_id": post.influencer_id,
                    "content": post.content,
                    "created_at": now.isoformat(),
                }
            )
        db.commit()
        return {"status": "ok", "published": published}
    finally:
        db.close()


@celery_app.task
def generate_daily_posts() -> dict:
    """Generate daily posts for all influencers based on their frequency and topics.

    Iterates through each influencer, generates a number of posts equal to
    `posting_frequency`, and inserts them into the database.  Each post is
    constructed using the influencer's content pillars and current arc.
    """
    db = SessionLocal()
    created_count = 0
    try:
        influencers = db.query(models.Influencer).all()
        for inf in influencers:
            # Determine topics: prefer structured JSON pillars, fall back to CSV, then niche
            if getattr(inf, "content_pillars_json", None):
                topics = [str(p).strip() for p in (inf.content_pillars_json or []) if str(p).strip()]
            elif inf.content_pillars:
                topics = [p.strip() for p in inf.content_pillars.split(",") if p.strip()]
            else:
                topics = [inf.niche.capitalize()]
            for i in range(inf.posting_frequency or 1):
                topic = topics[i % len(topics)]
                content = (
                    f"{inf.name} shares {topic.lower()} insights. "
                    f"{(inf.current_arc or inf.lore or '').strip()}"
                )
                post = models.Post(influencer_id=inf.id, content=content)
                db.add(post)
                db.flush()  # assign ID without committing
                created_count += 1
                publish_event_sync(
                    {
                        "type": "post.created",
                        "post_id": post.id,
                        "influencer_id": inf.id,
                        "content": content,
                        "created_at": post.created_at.isoformat() if post.created_at else None,
                    }
                )
        db.commit()
        return {"status": "ok", "posts_created": created_count}
    finally:
        db.close()


# -----------------------------------------------------------------------------
# Daily challenges (retention loop)


@celery_app.task
def create_today_challenge() -> dict:
    """Ensure today's daily challenge exists and is surfaced as a poll post.

    If a challenge already exists, it is reused. When possible, we also create
    a linked poll post so the challenge can live directly in the feed.
    """
    db = SessionLocal()
    try:
        ch = crud.get_or_create_today_challenge(db)
        # Create a linked poll post the first time we create a challenge.
        if ch.post_id is None and ch.influencer_id:
            # Poll post meta drives the poll UI.
            meta = {
                "question": ch.prompt,
                "options": ch.options_json if isinstance(ch.options_json, list) else [],
                "challenge_id": ch.id,
            }
            content = f"🔥 Daily Challenge: {ch.prompt}"
            post = models.Post(
                influencer_id=ch.influencer_id,
                content=content,
                post_type="poll",
                mode="drama",
                status="published",
                meta=meta,
            )
            db.add(post)
            db.commit()
            db.refresh(post)
            ch.post_id = post.id
            db.add(ch)
            db.commit()
            publish_event_sync({
                "type": "post.created",
                "post_id": post.id,
                "influencer_id": post.influencer_id,
                "content": post.content,
                "created_at": post.created_at.isoformat() if post.created_at else None,
            })

        publish_event_sync({"type": "challenge.created", "challenge_id": ch.id, "post_id": ch.post_id})
        return {"status": "ok", "challenge_id": ch.id, "post_id": ch.post_id}
    finally:
        db.close()


@celery_app.task
def resolve_yesterday_challenge() -> dict:
    """Resolve yesterday's challenge and turn the result into a story beat."""
    db = SessionLocal()
    try:
        yday = (datetime.utcnow() - timedelta(days=1)).date()
        ch = (
            db.query(models.DailyChallenge)
            .filter(models.DailyChallenge.day == yday, models.DailyChallenge.resolved_at == None)
            .first()
        )
        if not ch:
            return {"status": "ok", "resolved": False}

        options = ch.options_json if isinstance(ch.options_json, list) else []
        counts, total = crud._challenge_counts(db, ch.id, len(options))  # internal helper
        if total <= 0:
            # No votes: pick a random twist so the arc still moves.
            winner = 0 if not options else random.randint(0, len(options) - 1)
        else:
            winner = max(range(len(counts)), key=lambda i: counts[i])

        ch.winning_option_index = int(winner)
        ch.results_json = {"counts": counts, "total": total}
        ch.resolved_at = datetime.utcnow()
        db.add(ch)

        # If this challenge was tied to an influencer, update the arc and post the outcome.
        if ch.influencer_id and options:
            inf = db.query(models.Influencer).filter(models.Influencer.id == ch.influencer_id).first()
            if inf:
                chosen = str(options[winner])
                inf.current_arc = chosen
                db.add(inf)
                # Outcome post: makes fans feel their vote mattered.
                pct = 0 if total <= 0 else int(round(100.0 * counts[winner] / max(1, total)))
                outcome_text = f"🗳️ You chose: **{chosen}** ({pct}% of votes).\n\nNext posts will follow this arc."
                post = models.Post(
                    influencer_id=inf.id,
                    content=outcome_text,
                    post_type="post",
                    mode="educational",
                    status="published",
                    meta={"challenge_id": ch.id, "result": {"winner": winner, "counts": counts, "total": total}},
                )
                db.add(post)
                db.flush()
                publish_event_sync({
                    "type": "post.created",
                    "post_id": post.id,
                    "influencer_id": inf.id,
                    "content": post.content,
                    "created_at": post.created_at.isoformat() if post.created_at else None,
                })

        db.commit()

        publish_event_sync({"type": "challenge.resolved", "challenge_id": ch.id, "winner": int(winner)})
        return {"status": "ok", "resolved": True, "challenge_id": ch.id, "winner": int(winner)}
    finally:
        db.close()


@celery_app.task
def snapshot_daily_metrics() -> dict:
    """Snapshot daily influencer metrics into `influencer_daily_metrics`.

    This creates (or updates) a single row per influencer per day containing:
      - total follower count (as of snapshot time)
      - posts/likes/comments counts for that day
      - token price (from token state)

    It makes analytics cheap and robust against deleted follow rows.
    """
    db = SessionLocal()
    try:
        day = (datetime.utcnow() - timedelta(days=1)).date()
        start = datetime.combine(day, datetime.min.time())
        end = start + timedelta(days=1)

        influencers = db.query(models.Influencer).all()
        updated = 0
        for inf in influencers:
            follower_count = db.query(models.Follow).filter(models.Follow.influencer_id == inf.id).count()

            posts_count = db.query(models.Post).filter(models.Post.influencer_id == inf.id, models.Post.created_at >= start, models.Post.created_at < end).count()

            likes_count = (
                db.query(models.Reaction)
                .join(models.Post, models.Post.id == models.Reaction.post_id)
                .filter(
                    models.Post.influencer_id == inf.id,
                    models.Reaction.type == "like",
                    models.Reaction.created_at >= start,
                    models.Reaction.created_at < end,
                )
                .count()
            )

            comments_count = (
                db.query(models.Comment)
                .join(models.Post, models.Post.id == models.Comment.post_id)
                .filter(
                    models.Post.influencer_id == inf.id,
                    models.Comment.author_type == "user",
                    models.Comment.created_at >= start,
                    models.Comment.created_at < end,
                )
                .count()
            )

            state = db.query(models.InfluencerTokenState).filter(models.InfluencerTokenState.influencer_id == inf.id).first()
            token_price = state.price if state else None

            existing = (
                db.query(models.InfluencerDailyMetric)
                .filter(models.InfluencerDailyMetric.influencer_id == inf.id, models.InfluencerDailyMetric.date == day)
                .first()
            )
            if existing:
                existing.follower_count = int(follower_count)
                existing.posts_count = int(posts_count)
                existing.likes_count = int(likes_count)
                existing.comments_count = int(comments_count)
                existing.token_price = token_price
            else:
                db.add(
                    models.InfluencerDailyMetric(
                        influencer_id=inf.id,
                        date=day,
                        follower_count=int(follower_count),
                        posts_count=int(posts_count),
                        likes_count=int(likes_count),
                        comments_count=int(comments_count),
                        token_price=token_price,
                    )
                )
            updated += 1

        db.commit()
        return {"date": str(day), "influencers": updated}
    finally:
        db.close()


# -----------------------------------------------------------------------------
# In‑character replies
#

# In‑memory rate limit tracker for influencer replies.  Keys are influencer
# IDs and values are timestamps of the last reply.  This is a simplistic
# implementation suitable for an MVP; in production consider Redis or a more
# robust store.
_reply_rate_limit: dict[int, float] = {}

def _moderate_content(text: str) -> bool:
    """Simple moderation filter to reject comments containing banned words.

    Returns True if the content is acceptable; False otherwise.  Extend
    this list or integrate with a moderation API for a full implementation.
    """
    banned_words = ["hate", "violence", "sexist", "racist"]
    lower = text.lower()
    return not any(bad in lower for bad in banned_words)


def _generate_reply(influencer: models.Influencer, user_comment: models.Comment) -> str:
    """Generate a simple in‑character reply based on the influencer's reply mode.

    This is a placeholder implementation using canned responses.  A real
    implementation could call into an LLM to generate contextually rich
    replies.  The reply takes into account the influencer's name and reply
    mode.
    """
    mode = (influencer.reply_mode or "wholesome").lower()
    name = influencer.name
    # Basic reply templates per mode
    templates = {
        "wholesome": f"Thanks for your support! 😊 - {name}",
        "savage": f"Oh please, {name} knows best. 😏", 
        "educational": f"Interesting point! Did you know {influencer.niche.lower()} has many facets?", 
        "drama": f"This just got spicy! 🌶️ Stay tuned for more.",
    }
    return templates.get(mode, templates["wholesome"])


@celery_app.task
def reply_to_comment(comment_id: int) -> None:
    """Generate and store an in‑character reply to a user comment.

    When a user comments on a post, this task is enqueued to produce a
    response from the post's influencer.  The reply respects a simple
    rate limit (one reply per influencer per minute) and passes through
    a basic moderation filter.  If moderation fails or rate limit is hit,
    no reply is created.
    """
    import time
    db = SessionLocal()
    try:
        comment = db.query(models.Comment).filter(models.Comment.id == comment_id).first()
        if not comment or comment.author_type != "user":
            return
        # Identify the post and influencer
        post = db.query(models.Post).filter(models.Post.id == comment.post_id).first()
        if not post:
            return
        influencer = db.query(models.Influencer).filter(models.Influencer.id == post.influencer_id).first()
        if not influencer:
            return
        # Rate limiting: only allow one reply every 60 seconds per influencer
        now = time.time()
        last_time = _reply_rate_limit.get(influencer.id, 0)
        if now - last_time < 60:
            return
        # Moderation: ensure the user's comment is acceptable before replying
        if not _moderate_content(comment.content):
            return
        # Generate reply text
        reply_text = _generate_reply(influencer, comment)
        # Store the reply as a new comment authored by the influencer
        reply = models.Comment(
            post_id=post.id,
            user_id=None,
            influencer_id=influencer.id,
            content=reply_text,
            author_type="influencer",
        )
        db.add(reply)
        db.commit()
        publish_event_sync(
            {
                "type": "comment.reply",
                "comment_id": reply.id,
                "post_id": post.id,
                "influencer_id": influencer.id,
                "content": reply_text,
            }
        )

        # --- Reply spike notification (owner only, MVP)
        try:
            count = incr_with_expiry(f"metric:reply_spike:{influencer.id}", ttl_seconds=600)
            if count >= 10 and set_once(f"notif:reply_spike:{influencer.id}", ttl_seconds=1800):
                notify_sync(
                    user_id=influencer.owner_id,
                    notif_type="notify.reply_spike",
                    message=f"Reply spike: {count} replies in the last 10 minutes.",
                    data={"influencer_id": influencer.id, "count": count},
                )
        except Exception:
            pass
        # Update rate limit timestamp
        _reply_rate_limit[influencer.id] = now
    finally:
        db.close()