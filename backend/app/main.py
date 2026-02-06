"""
Main entry point for the FameForge API.

This module defines the FastAPI application and includes all routers.
On startup, it creates the database tables defined in the models.  For local
development the application uses a SQLite database, but the engine can be
easily swapped out for PostgreSQL by changing the `SQLALCHEMY_DATABASE_URL`
in `database.py`.
"""

from fastapi import FastAPI

from .database import Base, engine
from .routers import users, influencers, auth, feed
from .tasks import celery_app, demo_task
from celery.result import AsyncResult
from fastapi import HTTPException, status

# Create database tables on startup.  In production you would use Alembic
# migrations instead of automatic creation.
Base.metadata.create_all(bind=engine)

app = FastAPI(title="FameForge API", version="0.1.0")

# Register API routers.  Each router encapsulates a specific part of the
# domain logic, keeping the main application thin and easy to maintain.
app.include_router(users.router, prefix="/users", tags=["users"])
app.include_router(influencers.router, prefix="/influencers", tags=["influencers"])
app.include_router(auth.router, tags=["auth"])
app.include_router(feed.router, tags=["feed"])

@app.get("/")
def read_root() -> dict[str, str]:
    """Simple health check endpoint."""
    return {"message": "Welcome to the FameForge API"}


# -----------------------------------------------------------------------------
# Core API endpoints
#
@app.get("/health")
def health_check() -> dict[str, str]:
    """Return a simple status indicator.

    This endpoint can be used by load balancers or uptime monitoring services
    to verify that the API is running.
    """
    return {"status": "ok"}


@app.post("/tasks/demo", status_code=status.HTTP_202_ACCEPTED)
def enqueue_demo_task() -> dict[str, str]:
    """Enqueue a demo Celery task and return the task ID.

    The demo task is intentionally trivial; in a real application you would
    enqueue jobs for content generation, image rendering, or other
    background processes.
    """
    task = demo_task.delay()
    return {"task_id": task.id}


@app.get("/tasks/{task_id}")
def get_task_status(task_id: str) -> dict[str, str | None]:
    """Retrieve the status and result of a Celery task by ID.

    Returns the current state and, if the task has completed successfully,
    its result.  If the task does not exist, a 404 error is raised.
    """
    async_result = AsyncResult(task_id, app=celery_app)
    if async_result is None or async_result.id is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    response = {"task_id": task_id, "status": async_result.status.lower()}
    if async_result.successful():
        response["result"] = async_result.result
    return response