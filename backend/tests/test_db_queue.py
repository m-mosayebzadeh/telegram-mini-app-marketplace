"""
Requests queue for a database session (app/core/database.py, get_db).

Found by loading Echo with a thousand people at once (TECHNICAL_REQUIREMENTS
section 32): when more requests could hold a connection than the pool had,
every request froze. The queue keeps the number of requests holding a
session at or below what the pool can give, and the rest wait their turn
without holding a thread.
"""

import asyncio

from app.core import database
from app.core.config import settings


def test_no_more_requests_hold_a_session_than_the_pool_can_give(monkeypatch):
    monkeypatch.setattr(settings, "db_pool_size", 4)
    monkeypatch.setattr(settings, "db_max_overflow", 1)
    monkeypatch.setattr(database, "_slots", None)
    allowed = 4 + 1 - database.DB_RESERVED

    class FakeSession:
        def close(self):
            pass

    monkeypatch.setattr(database, "SessionLocal", FakeSession)
    holding = 0
    most = 0

    async def request():
        nonlocal holding, most
        gen = database.get_db()
        await gen.__anext__()
        holding += 1
        most = max(most, holding)
        await asyncio.sleep(0.01)
        holding -= 1
        await gen.aclose()

    async def crowd():
        await asyncio.gather(*(request() for _ in range(30)))

    asyncio.run(crowd())
    monkeypatch.setattr(database, "_slots", None)
    assert most == allowed


def test_every_server_keeps_a_connection_for_each_worker_thread():
    # The worker threads are anyio's 40; fewer connections kept open meant
    # opening a fresh one for most requests under load.
    assert settings.db_pool_size >= 40
