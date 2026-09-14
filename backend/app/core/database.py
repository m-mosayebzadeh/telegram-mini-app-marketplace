"""
Database setup shared by the whole app.

SQLAlchemy is the ORM (Object-Relational Mapper): it lets us define
Python classes (like `User`) that map to database tables, and write
Python code instead of raw SQL for most operations. It also lets us
point at a different Postgres by only
changing the `database_url` setting — no code changes needed, which is
exactly what TECHNICAL_REQUIREMENTS.md asks for in the tech stack section.
"""

from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import settings

# The "engine" is the object that actually knows how to talk to the
# database (open connections, run SQL, etc).
#
# pool_pre_ping checks a pooled connection is still alive before handing it
# out. Without it, the first request after the database restarts — or after a
# network hiccup between app and database — fails with a stale connection
# instead of quietly opening a new one.
engine = create_engine(settings.database_url, pool_pre_ping=True)

# A "session" is a temporary workspace for talking to the database:
# you load objects into it, change them, and then commit to save the
# changes. SessionLocal is a factory that creates new Session objects
# on demand — we create one per incoming request, not one shared globally.
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    """
    Base class every ORM model (e.g. `User`) inherits from.
    SQLAlchemy uses this to keep track of all the tables we define, so it
    knows what to create when we call `Base.metadata.create_all(engine)`.
    """


def get_db() -> Generator[Session, None, None]:
    """
    FastAPI dependency that provides a database session for a single
    request, and guarantees it gets closed afterwards — even if the
    request handler raises an error.

    The `yield` here is what makes this a "generator": code before
    `yield` runs before the request is handled, the session is handed to
    the request handler, and code after `yield` (in `finally`) runs after
    the handler is done, regardless of whether it succeeded or raised.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
