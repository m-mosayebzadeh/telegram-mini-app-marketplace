"""
Database setup shared by the whole app.

SQLAlchemy is the ORM (Object-Relational Mapper): it lets us define
Python classes (like `User`) that map to database tables, and write
Python code instead of raw SQL for most operations. It also lets us
point at a different Postgres by only
changing the `database_url` setting — no code changes needed, which is
exactly what TECHNICAL_REQUIREMENTS.md asks for in the tech stack section.
"""

import asyncio
from collections.abc import AsyncGenerator, Generator

from fastapi.concurrency import run_in_threadpool
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
#
# How many connections each server process may open (settings.db_pool_size
# + db_max_overflow). Several processes together must stay under the
# database's own limit (Postgres allows 100 unless told otherwise), or a
# connection pooler goes in front of it. get_db below keeps requests from
# ever asking for more connections than this.
engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    pool_size=settings.db_pool_size,
    max_overflow=settings.db_max_overflow,
)

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


#: Connections kept back from requests: the server's heartbeat
#: (app/live/pulse.py) and the live sockets' one lookup each use their own.
DB_RESERVED = 3

_slots: asyncio.Semaphore | None = None


def _db_slots() -> asyncio.Semaphore:
    global _slots
    if _slots is None:
        _slots = asyncio.Semaphore(max(1, settings.db_pool_size + settings.db_max_overflow - DB_RESERVED))
    return _slots


async def get_db() -> AsyncGenerator[Session, None]:
    """
    FastAPI dependency: one database session for one request, closed
    afterwards even if the request fails.

    Requests queue for a session here, without holding a thread, so no more
    requests hold a session than the pool has connections. Found by loading
    Echo with a thousand people at once (TECHNICAL_REQUIREMENTS.md section
    32): before this, a request kept its connection between the worker
    threads it hops across, so more requests than connections could hold
    one; the worker threads all ended up waiting for a connection while the
    requests holding connections waited for a free thread to finish — and
    every request froze. Now a request that has a session is guaranteed a
    connection, so a worker thread never waits for one, and that circle
    cannot form. The rest simply wait their turn.
    """
    async with _db_slots():
        db = SessionLocal()
        try:
            yield db
        finally:
            # Closing sends a rollback to the database: done on a worker
            # thread so the event loop never waits on the network.
            await run_in_threadpool(db.close)


def open_db() -> Generator[Session, None, None]:
    """
    A session outside the queue, for the live socket (app/live/router.py):
    it needs one quick lookup when it connects and then stays open for
    hours, and must not hold a request's place in the queue for that long.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
