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