"""
Database configuration for the FameForge backend.

This module defines the SQLAlchemy engine and session maker used
throughout the application.  The default configuration uses a local
SQLite database for rapid prototyping.  Update `SQLALCHEMY_DATABASE_URL`
to point at a PostgreSQL database when deploying to production.
"""

from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

# TODO: move this configuration to an environment variable or a settings
# module.  For demonstration purposes we use SQLite.  To switch to
# PostgreSQL, set `SQLALCHEMY_DATABASE_URL` to something like
# "postgresql+psycopg2://user:password@localhost/dbname".
import os

# Derive the database URL from the environment with a sensible default.  In
# production you should set the `DATABASE_URL` environment variable to a
# PostgreSQL DSN (e.g., "postgresql+psycopg2://user:password@hostname/dbname").
DATABASE_URL = os.getenv("DATABASE_URL")
if DATABASE_URL:
    SQLALCHEMY_DATABASE_URL = DATABASE_URL
    connect_args = {}  # PostgreSQL does not require special args
else:
    # Fallback to a local SQLite database for development.  Note that
    # SQLite needs a thread check disabled when used with FastAPI.
    SQLALCHEMY_DATABASE_URL = "sqlite:///./sql_app.db"
    connect_args = {"check_same_thread": False}

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args=connect_args,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()