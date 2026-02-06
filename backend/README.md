# FameForge Backend MVP

This directory contains a minimal FastAPI backend for the FameForge project.  It
implements basic user and influencer functionality as described in the MVP
development plan.

## Features

- **User management** — Create users and retrieve their profiles.
- **Influencer management** — Create and list influencers, each tied to a user.
- **ORM models** — SQLite database models using SQLAlchemy for Users and Influencers.
- **Dependency injection** — Database sessions are provided per request via FastAPI’s dependency system.
- **Health & task API** — A `/health` endpoint returns the server status and `/tasks/*` endpoints enqueue and track background jobs via Celery.

## Getting Started

1. **Install dependencies**

   Use a Python virtual environment (e.g., `python3 -m venv venv && source venv/bin/activate`) and install the dependencies:

   ```bash
   pip install -r requirements.txt
   ```

2. **Run the application**

   From this `backend` directory, start the server using Uvicorn:

   ```bash
   uvicorn app.main:app --reload
   ```

   The API will be available at `http://127.0.0.1:8000`.  The interactive
   documentation is available at `http://127.0.0.1:8000/docs`.

3. **Testing endpoints**

   - **Create a user**

     ```bash
     curl -X POST "http://127.0.0.1:8000/users/" \
       -H "Content-Type: application/json" \
       -d '{"email": "test@example.com", "password": "secret123"}'
     ```

   - **Create an influencer** (use the returned user `id` as `owner_id`):

     ```bash
     curl -X POST "http://127.0.0.1:8000/influencers/?owner_id=1" \
       -H "Content-Type: application/json" \
       -d '{"name": "CryptoGuru", "bio": "An AI crypto analyst", "niche": "crypto", "style": "professional"}'
     ```

   - **List all influencers**

     ```bash
     curl "http://127.0.0.1:8000/influencers/"
     ```

   - **Check API health**

     ```bash
     curl "http://127.0.0.1:8000/health"
     # {"status":"ok"}
     ```

   - **Enqueue a background task**

     ```bash
     curl -X POST "http://127.0.0.1:8000/tasks/demo"
     # {"task_id": "<some-id>"}
     ```

     To check the task status, call:

     ```bash
     curl "http://127.0.0.1:8000/tasks/<some-id>"
     # {"task_id":"<some-id>","status":"pending"}
     ```

   - **Build a new AI influencer (factory)**

     ```bash
     # authenticate and obtain a token first (see /token endpoint)
     TOKEN=$(curl -X POST -d "username=admin@example.com&password=admin123" \ 
       -H "Content-Type: application/x-www-form-urlencoded" \ 
       "http://127.0.0.1:8000/token" | jq -r .access_token)

     # create an influencer by specifying niche, vibe and posting frequency
     curl -X POST "http://127.0.0.1:8000/influencers/build" \
       -H "Authorization: Bearer $TOKEN" \
       -H "Content-Type: application/json" \
       -d '{"niche": "crypto", "vibe": "savvy", "posting_frequency": 5}'
     # returns {"task_id": "<task-id>"}

     # check the task result
     curl "http://127.0.0.1:8000/tasks/<task-id>"
     # when ready, the result will include influencer_id and generated details
     ```

   - **Automatic daily posting**

     Once an influencer is created and configured with a posting frequency,
     the system automatically generates daily posts based on their content
     pillars and current arc.  The Celery worker runs a scheduled task at
     midnight (UTC) to create these posts.  No user intervention is required.

     This requires a running Redis instance and a Celery worker process:

     ```bash
     # in one terminal
     uvicorn app.main:app --reload

     # in another terminal
     celery -A app.tasks.celery_app worker --loglevel=info
     ```

This backend is a starting point.  It does not yet implement authentication,
post scheduling, or the token economy.  Those features can be layered on top
by following the development plan.

## Feed & Social Interactions

The API exposes additional endpoints under the `/feed` and `/posts` prefixes.  These
enable a public influencer feed with infinite scroll, follow/unfollow, likes and
comments, and basic trending.  All write actions (follow, like, comment) require
authentication via a Bearer token.

- **Fetch the public feed**

  ```bash
  # Get the latest 20 posts (default)
  curl "http://127.0.0.1:8000/feed"

  # Skip the first 40 posts and limit to 20 for infinite scroll
  curl "http://127.0.0.1:8000/feed?skip=40&limit=20"

  # Get trending posts (based on recent engagement)
  curl "http://127.0.0.1:8000/feed?trending=true&limit=10"
  ```

- **Follow / Unfollow an influencer**

  ```bash
  # Follow influencer with id 5 (requires bearer token)
  curl -X POST "http://127.0.0.1:8000/influencers/5/follow" \
    -H "Authorization: Bearer $TOKEN"

  # Unfollow influencer with id 5
  curl -X DELETE "http://127.0.0.1:8000/influencers/5/follow" \
    -H "Authorization: Bearer $TOKEN"
  ```

- **Like / Unlike a post**

  ```bash
  curl -X POST "http://127.0.0.1:8000/posts/10/like" \
    -H "Authorization: Bearer $TOKEN"

  curl -X DELETE "http://127.0.0.1:8000/posts/10/like" \
    -H "Authorization: Bearer $TOKEN"
  ```

- **Comment on a post**

  ```bash
  curl -X POST "http://127.0.0.1:8000/posts/10/comments" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"content":"Great analysis!"}'
  ```

These endpoints complete the basic social functionality, enabling users to scroll, react,
and follow influencers.