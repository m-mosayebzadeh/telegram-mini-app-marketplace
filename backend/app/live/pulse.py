"""
The server's own heartbeat (section 32: the app never asks "anything
new?" over and over; the server says so when something changes).

Two small jobs, run on a clock inside the server rather than by every
phone on its own clock:

1. **Who is here.** Somebody with the app open holds a live connection,
   and that connection — not the last request they happened to make — is
   what "here right now" means. Once a minute, one statement marks every
   connected person as seen. Before this, "online" came from the app
   asking the server something every few seconds; with that asking gone,
   an open but idle app would have gone grey after five minutes.

2. **Echo's numbers.** Every few seconds, if the number searching or the
   number here changed, the new numbers go to the people searching, as
   one tiny message each. And when Echo goes from nobody waiting to
   somebody waiting (or back), everybody hears it, so the Echo mark in
   the bar can quicken. One count for the whole server instead of one
   request every four seconds from every phone that is waiting.

Each server process runs its own heartbeat over its own connections.
"""

import asyncio
import logging
from datetime import timedelta

from sqlalchemy import func, select, update

from app.auth.dependencies import ONLINE_WITHIN
from app.core.database import SessionLocal
from app.core.time import utcnow
from app.live.hub import hub
from app.models.random_chat import RandomChatTicket
from app.models.user import User

log = logging.getLogger(__name__)

#: How often "who is here" is written. Well inside ONLINE_WITHIN (five
#: minutes), so nobody connected ever looks gone.
SEEN_EVERY = timedelta(seconds=60)

#: How often Echo's numbers are looked at. Only sent when they changed.
ECHO_EVERY = timedelta(seconds=5)

#: Big lists are written in pieces, so one statement never carries tens
#: of thousands of ids.
CHUNK = 1000


class EchoPulse:
    """Remembers the last numbers sent, so only a change is announced."""

    def __init__(self) -> None:
        self.last: tuple[int, int] | None = None
        self.anyone_waiting: bool | None = None

    def tick(self, db) -> None:
        connected = hub.connected_user_ids()
        if not connected:
            return
        searching = list(
            db.scalars(select(RandomChatTicket.user_id).where(RandomChatTicket.active.is_(True)))
        )
        online = db.scalar(
            select(func.count(User.id)).where(User.last_seen_at >= utcnow() - ONLINE_WITHIN)
        ) or 0
        numbers = (len(searching), online)
        event = {"type": "echo_counts", "waiting_now": numbers[0], "online_now": numbers[1]}

        anyone = numbers[0] > 0
        if self.anyone_waiting is not None and anyone != self.anyone_waiting:
            # The door's state changed for everybody: everybody hears it.
            hub.publish(connected, event)
        elif numbers != self.last:
            listening = set(connected) & set(searching)
            if listening:
                hub.publish(listening, event)
        self.last = numbers
        self.anyone_waiting = anyone


def mark_connected_as_seen(db) -> int:
    """One write, in pieces, for everybody connected. Returns how many."""
    ids = hub.connected_user_ids()
    now = utcnow()
    for start in range(0, len(ids), CHUNK):
        db.execute(update(User).where(User.id.in_(ids[start:start + CHUNK])).values(last_seen_at=now))
    if ids:
        db.commit()
    return len(ids)


async def run_pulse(stop: asyncio.Event) -> None:
    """The heartbeat itself, started with the server and stopped with it."""
    echo = EchoPulse()
    since_seen = SEEN_EVERY
    while not stop.is_set():
        try:
            await asyncio.wait_for(stop.wait(), ECHO_EVERY.total_seconds())
            return
        except asyncio.TimeoutError:
            pass
        since_seen += ECHO_EVERY
        try:
            await asyncio.to_thread(_beat, echo, since_seen >= SEEN_EVERY)
        except Exception:  # a missed beat must never stop the next one
            log.exception("pulse beat failed")
        if since_seen >= SEEN_EVERY:
            since_seen = timedelta(0)


def _beat(echo: EchoPulse, write_seen: bool) -> None:
    with SessionLocal() as db:
        if write_seen:
            mark_connected_as_seen(db)
        echo.tick(db)
