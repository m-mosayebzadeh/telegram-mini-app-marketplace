"""
Who is connected right now, and handing them what just happened.

The app's ordinary requests are questions: the phone asks and the server
answers. Some things cannot wait to be asked about — a message arriving,
a message being read — so a person who has the app open keeps one live
connection, and the server pushes those moments down it.

Deliberately thin. An event says what happened and carries the few fields
a screen needs to update itself; it is never the only copy of anything.
Everything pushed here is also in the database, and a phone that was
disconnected simply asks again when it comes back. That is what makes it
safe to drop an event — a full queue, a dead socket, a restart — and it
is what makes this cheap enough to run for millions of people: nothing is
stored per connection except a small queue.

One process only, for now. Every connection lives in THIS process's
memory, so with more than one server process an event published in one
would never reach a person connected to another. The day there is more
than one, `publish` becomes a write to a shared channel (Postgres
LISTEN/NOTIFY or Redis) that every process listens to; nothing that calls
`publish` has to change. See TECHNICAL_REQUIREMENTS.md, the live
connection section.
"""

from __future__ import annotations

import asyncio
import threading
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any

#: How many undelivered events one connection may pile up before it is cut.
#:
#: A phone on a bad network can stop reading without the connection
#: noticing it is dead. Without a limit its queue grows for as long as the
#: server runs. Cutting it costs nothing: the phone reconnects and asks for
#: whatever it missed.
MAX_PENDING = 200


@dataclass(eq=False)
class Connection:
    """One open socket belonging to one person. A person with the app open
    on two devices has two."""

    user_id: int
    loop: asyncio.AbstractEventLoop
    queue: asyncio.Queue = field(default_factory=lambda: asyncio.Queue(MAX_PENDING + 1))
    overflowed: bool = False

    def push(self, event: dict[str, Any]) -> None:
        """Runs on the event loop's own thread (see `publish`)."""
        if self.overflowed:
            return
        if self.queue.qsize() >= MAX_PENDING:
            # One sentinel wakes the sender so it closes the socket; nothing
            # after it is queued.
            self.overflowed = True
            self.queue.put_nowait(None)
            return
        self.queue.put_nowait(event)


class LiveHub:
    def __init__(self) -> None:
        self._by_user: dict[int, set[Connection]] = {}
        # Routes run on worker threads while sockets live on the event loop,
        # so the registry is touched from both sides.
        self._lock = threading.Lock()

    def register(self, user_id: int) -> Connection:
        connection = Connection(user_id=user_id, loop=asyncio.get_running_loop())
        with self._lock:
            self._by_user.setdefault(user_id, set()).add(connection)
        return connection

    def unregister(self, connection: Connection) -> None:
        with self._lock:
            mine = self._by_user.get(connection.user_id)
            if mine is None:
                return
            mine.discard(connection)
            if not mine:
                del self._by_user[connection.user_id]

    def is_connected(self, user_id: int) -> bool:
        with self._lock:
            return user_id in self._by_user

    def publish(self, user_ids: Iterable[int], event: dict[str, Any]) -> None:
        """Hands `event` to every open connection of every person listed.

        Safe to call from anywhere — an ordinary route runs on a worker
        thread, not on the loop that owns the sockets, so the hand-over goes
        through that loop rather than touching its queues directly.

        Never raises and never waits. A route that just saved a message has
        done its job; whether anyone happens to be listening is not its
        problem, and must never turn a saved message into an error.
        """
        with self._lock:
            targets = [c for uid in set(user_ids) for c in self._by_user.get(uid, ())]
        for connection in targets:
            try:
                connection.loop.call_soon_threadsafe(connection.push, event)
            except RuntimeError:
                # The loop has shut down under us: the socket is already gone.
                pass


#: The one hub for this process.
hub = LiveHub()
