"""
Database initialization and seeding script for FameForge.

This script creates all database tables and optionally seeds the database with
a default admin user.  Run this script from within the Docker container or
your local environment to prepare the Postgres database.

Usage:
    python init_db.py --with-seed
"""

import argparse
from app.database import Base, engine, SessionLocal
from app import models, crud


def init_db(with_seed: bool = False) -> None:
    """Create all tables and optionally seed the database."""
    # Create all tables defined in SQLAlchemy models
    Base.metadata.create_all(bind=engine)

    # Lightweight schema upgrades for dev environments without Alembic.
    # This keeps existing containers working when we add new columns.
    with engine.begin() as conn:
        # Post.mode (content tone per post)
        try:
            conn.exec_driver_sql(
                "ALTER TABLE posts ADD COLUMN IF NOT EXISTS mode VARCHAR DEFAULT 'wholesome'"
            )
            conn.exec_driver_sql(
                "CREATE INDEX IF NOT EXISTS ix_posts_mode ON posts (mode)"
            )
        except Exception:
            # On fresh DBs, create_all already handled it.
            pass

        # Phase B: users.email_verified, lockout fields
        try:
            conn.exec_driver_sql(
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE"
            )
            conn.exec_driver_sql(
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_count INTEGER DEFAULT 0"
            )
            conn.exec_driver_sql(
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP NULL"
            )
            conn.exec_driver_sql(
                "CREATE INDEX IF NOT EXISTS ix_users_email_verified ON users (email_verified)"
            )
        except Exception:
            pass

        # Phase B: email_tokens table
        try:
            conn.exec_driver_sql(
                """
                CREATE TABLE IF NOT EXISTS email_tokens (
                    id VARCHAR PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    purpose VARCHAR NOT NULL,
                    token_hash VARCHAR NOT NULL UNIQUE,
                    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                    expires_at TIMESTAMP NOT NULL,
                    used_at TIMESTAMP NULL
                )
                """
            )
            conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_email_tokens_purpose ON email_tokens (purpose)")
            conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_email_tokens_user_id ON email_tokens (user_id)")
        except Exception:
            pass
    if with_seed:
        db = SessionLocal()
        try:
            # Only create the admin user if one doesn't already exist
            admin_email = "admin@example.com"
            existing = db.query(models.User).filter(models.User.email == admin_email).first()
            if existing is None:
                admin_user = models.User(
                    email=admin_email,
                    hashed_password=crud.get_password_hash("admin123"),
                    is_active=True,
                )
                db.add(admin_user)
                db.commit()
                db.refresh(admin_user)
                print(f"Created admin user with email {admin_email} and password 'admin123'")
            else:
                print("Admin user already exists, skipping seed creation")
        finally:
            db.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Initialize and optionally seed the database")
    parser.add_argument(
        "--with-seed",
        action="store_true",
        help="Create a default admin user after initializing tables",
    )
    args = parser.parse_args()
    init_db(with_seed=args.with_seed)


if __name__ == "__main__":
    main()