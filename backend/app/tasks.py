"""
Celery task definitions for the FameForge API.

Celery is used to offload long‑running or asynchronous work from the
FastAPI request/response cycle.  This module configures the Celery app
to use Redis as a broker and result backend.  Tasks defined here can be
enqueued via `.delay()` or `.apply_async()` and their status can be
checked using Celery's `AsyncResult` interface.
"""

import os
from celery import Celery
from celery.schedules import crontab
import random
from .database import SessionLocal
from . import models

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
) -> dict:
    """Background task to build a new AI influencer and seed starter content.

    This function generates a name, bio, lore, tone guide, content pillars,
    initial posts, and placeholder images.  It stores the influencer,
    associated assets and posts in the database.  It returns the new
    influencer's ID upon completion.
    """
    db = SessionLocal()
    try:
        # Generate basic attributes
        name = _generate_influencer_name(niche, vibe)
        bio = f"{name} is a {vibe.lower()} {niche.lower()} influencer created by AI."
        lore = f"{name} emerged from the combination of {niche.lower()} wisdom and {vibe.lower()} style."
        tone_guide = f"Speak in a {vibe.lower()} tone about {niche.lower()} topics."
        # Generate simple content pillars (topics) based on niche
        content_pillars = [f"{niche.capitalize()} tips", f"Behind the scenes of {niche.lower()}", f"{niche.capitalize()} news"]

        # Create influencer record
        influencer = models.Influencer(
            name=name,
            bio=bio,
            niche=niche,
            style=vibe,
            face_url=None,
            lore=lore,
            current_arc=f"{niche.capitalize()} journey arc",
            owner_id=user_id,
            posting_frequency=posting_frequency,
            content_pillars=",".join(content_pillars),
        )
        db.add(influencer)
        db.commit()
        db.refresh(influencer)

        # Create starter posts based on content pillars and posting frequency
        for i in range(10):
            topic = content_pillars[i % len(content_pillars)]
            content = f"{name}'s post {i+1}: {topic} - {vibe.lower()} insights."
            post = models.Post(influencer_id=influencer.id, content=content)
            db.add(post)

        # Create placeholder profile images (use a placeholder service)
        for i in range(3):
            asset = models.InfluencerAsset(
                influencer_id=influencer.id,
                url=f"https://placehold.co/600x600?text={name}+{i+1}",
                asset_type="image",
            )
            db.add(asset)

        db.commit()

        # Return details of the generated influencer
        return {
            "influencer_id": influencer.id,
            "name": name,
            "bio": bio,
            "lore": lore,
            "tone_guide": tone_guide,
            "content_pillars": content_pillars,
        }
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
            # Determine topics: fall back to the niche if no pillars are set
            if inf.content_pillars:
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
                created_count += 1
        db.commit()
        return {"status": "ok", "posts_created": created_count}
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
        # Update rate limit timestamp
        _reply_rate_limit[influencer.id] = now
    finally:
        db.close()