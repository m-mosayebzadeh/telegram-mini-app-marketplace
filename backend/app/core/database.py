"""
Database setup shared by the whole app.

SQLAlchemy is the ORM (Object-Relational Mapper): it lets us define
Python classes (like `User`) that map to database tables, and write
Python code instead of raw SQL for most operations. It also lets us
switch between SQLite (local dev) and Postgres (production) by only
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
# connect_args is only needed for SQLite: by default SQLite only allows
# the thread that created a connection to use it, but FastAPI can handle
# a single request on a different thread than the one that created the
# connection pool. This flag disables that check, which is safe here
# because we open a fresh, short-lived session per request anyway.
connect_args = {}
if settings.database_url.startswith("sqlite"):
    connect_args["check_same_thread"] = False

engine = create_engine(settings.database_url, connect_args=connect_args)

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
