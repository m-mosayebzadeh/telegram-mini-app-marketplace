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

3. **Pairing Echo.** Every second, everybody waiting in Echo is paired at
   once (app/random_chat/batch.py). Every process tries; whichever takes
   the database lock for that second does it, so there is no leader.

4. **Faded notes.** Once an hour, notes older than a day are erased from
   the database, not only hidden (the owner's decision; app/profile/note.py).
   One statement over a small index of the rows that have a note.

Each server process runs its own heartbeat over its own connections, and
tells only its own connections (hub.publish_local): no process is in
charge of the others, so none of them going down silences the rest. The
counts come from the database, which every process shares, so every
process tells the same numbers. The note sweep is harmless when several
processes run it: the second finds nothing left to erase.
"""

import asyncio
import logging
from datetime import timedelta

from sqlalchemy import func, select, update

from app.auth.dependencies import ONLINE_WITHIN
from app.core.database import SessionLocal
from app.core.presence import hiding_online
from app.core.time import utcnow
from app.live.hub import hub
from app.models.random_chat import RandomChatTicket
from app.models.user import User
from app.profile.note import erase_faded_notes
from app.random_chat.batch import run_batch

log = logging.getLogger(__name__)

#: How often "who is here" is written. Well inside ONLINE_WITHIN (five
#: minutes), so nobody connected ever looks gone.
SEEN_EVERY = timedelta(seconds=60)

#: How often Echo's numbers are looked at. Only sent when they changed.
ECHO_EVERY = timedelta(seconds=5)

#: How often everybody waiting in Echo is paired, and the heartbeat's own
#: smallest step: every other job runs on a multiple of it.
MATCH_EVERY = timedelta(seconds=1)

#: How often faded notes are erased. A note is already hidden the moment
#: it turns a day old; this only decides how soon it leaves the database.
NOTES_EVERY = timedelta(hours=1)

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
            hub.publish_local(connected, event)
        elif numbers != self.last:
            listening = set(connected) & set(searching)
            if listening:
                hub.publish_local(listening, event)
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
    """The heartbeat itself, started with the server and stopped with it.
    Ticks every MATCH_EVERY; the slower jobs run when their time is due."""
    echo = EchoPulse()
    since_echo = timedelta(0)
    since_seen = SEEN_EVERY
    # The first sweep comes with the first beat, so a server that restarts
    # often still erases faded notes.
    since_notes = NOTES_EVERY
    while not stop.is_set():
        try:
            await asyncio.wait_for(stop.wait(), MATCH_EVERY.total_seconds())
            return
        except asyncio.TimeoutError:
            pass
        try:
            await asyncio.to_thread(_match)
        except Exception:  # a missed pass must never stop the next one
            log.exception("echo pairing pass failed")
        since_echo += MATCH_EVERY
        if since_echo < ECHO_EVERY:
            continue
        since_echo = timedelta(0)
        since_seen += ECHO_EVERY
        since_notes += ECHO_EVERY
        write_seen = since_seen >= SEEN_EVERY
        sweep_notes = since_notes >= NOTES_EVERY
        try:
            await asyncio.to_thread(_beat, echo, write_seen, sweep_notes)
        except Exception:  # a missed beat must never stop the next one
            log.exception("pulse beat failed")
        if write_seen:
            since_seen = timedelta(0)
        if sweep_notes:
            since_notes = timedelta(0)


def _match() -> None:
    with SessionLocal() as db:
        run_batch(db)


def announce_gone(db) -> int:
    """Whoever stopped counting as here in the last minute: no socket kept
    them seen, so their last sighting just passed the five minutes. Their
    ring goes out in the worlds that show them. One query a minute, for
    the whole server; never somebody who hides being online."""
    now = utcnow()
    gone = db.scalars(
        select(User.id).where(
            User.last_seen_at <= now - ONLINE_WITHIN,
            User.last_seen_at > now - ONLINE_WITHIN - SEEN_EVERY,
        )
    ).all()
    hiders = hiding_online(db, gone)
    told = 0
    for user_id in gone:
        if user_id not in hiders and not hub.is_connected(user_id):
            hub.presence(user_id, False)
            told += 1
    return told


def _beat(echo: EchoPulse, write_seen: bool, sweep_notes: bool = False) -> None:
    with SessionLocal() as db:
        if write_seen:
            mark_connected_as_seen(db)
            announce_gone(db)
            hub.sweep_pending()
        if sweep_notes:
            erase_faded_notes(db)
        echo.tick(db)
