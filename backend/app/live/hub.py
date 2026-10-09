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

Every connection lives in THIS process's memory. With more than one
server process, an event is also sent through Redis (app/live/broker.py)
so the process that holds the person can deliver it; without REDIS_URL
there is one process and nothing else is needed. Nothing that calls
`publish` knows which. See TECHNICAL_REQUIREMENTS.md section 32, "more
than one node".

Two kinds of sending:

- `publish` and `publish_everyone` — something happened to people, and
  they must hear it wherever they are connected: here directly, and
  through Redis on every other process.
- `publish_local` — only the people on this process. The heartbeat uses
  it (app/live/pulse.py): every process runs its own and tells its own
  connections, so no single process is in charge of the others and none
  of them going down silences the rest.

One more thing travels the same way: a device that is not signed in yet,
waiting for a phone to approve it (app/auth/router.py). It has no live
connection — it is not anybody yet — so it waits inside an ordinary
request, and `device_request_changed` wakes that request the moment the
phone opens, approves or refuses it, on whichever process it waits.
"""

from __future__ import annotations

import asyncio
import json
import threading
import time
import uuid
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
    #: The sign-in session this socket was opened with, so closing that
    #: session from another device cuts this socket too.
    session_id: int | None = None
    queue: asyncio.Queue = field(default_factory=lambda: asyncio.Queue(MAX_PENDING + 1))
    overflowed: bool = False

    def end(self, event: dict[str, Any]) -> None:
        """A last event, then the socket closes (the sentinel). Runs on the
        event loop's own thread."""
        if not self.overflowed:
            self.queue.put_nowait(event)
            self.overflowed = True
            self.queue.put_nowait(None)

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
        #: Carries events to the other processes, when there are any.
        self._broker = None
        #: This process's name on the channel, so it can skip its own
        #: messages: the people here were already told directly.
        self.node_id = uuid.uuid4().hex
        #: Waiting sign-in requests on this process, by their code: each
        #: waiter is the loop it waits on and the event that wakes it.
        self._device_waiters: dict[str, set[tuple[asyncio.AbstractEventLoop, asyncio.Event]]] = {}
        #: Whose ring each person connected HERE can see right now: the
        #: people their world last showed them, and the reverse, so that
        #: somebody coming online is told to their watchers only — at most
        #: a world's worth of people each, never everybody (section 43).
        self._watches: dict[int, set[int]] = {}
        self._watched_by: dict[int, set[int]] = {}
        #: Worlds asked for before their socket arrived here — the app asks
        #: for the world and opens its socket at the same moment, and the
        #: world usually answers first. Kept briefly, by when they came,
        #: and taken up when the socket registers (see `sweep_pending`).
        self._pending_watches: dict[int, tuple[float, list[int]]] = {}

    def attach(self, broker) -> None:
        """Called once at startup when REDIS_URL is set."""
        self._broker = broker

    def register(self, user_id: int, session_id: int | None = None) -> Connection:
        connection = Connection(user_id=user_id, loop=asyncio.get_running_loop(), session_id=session_id)
        with self._lock:
            self._by_user.setdefault(user_id, set()).add(connection)
            pending = self._pending_watches.pop(user_id, None)
        if pending is not None:
            self._watch_local(user_id, pending[1])
        return connection

    def unregister(self, connection: Connection) -> None:
        with self._lock:
            mine = self._by_user.get(connection.user_id)
            if mine is None:
                return
            mine.discard(connection)
            if not mine:
                del self._by_user[connection.user_id]
                # Gone from this process: their world is not open here.
                self._drop_watch(connection.user_id)

    def is_connected(self, user_id: int) -> bool:
        with self._lock:
            return user_id in self._by_user

    def connected_user_ids(self) -> list[int]:
        """Everyone with the app open right now, on this server."""
        with self._lock:
            return list(self._by_user)

    def publish(self, user_ids: Iterable[int], event: dict[str, Any]) -> None:
        """Hands `event` to every open connection of every person listed,
        on this process and — through Redis — on every other.

        Safe to call from anywhere, and never raises or waits: a route that
        just saved a message has done its job; whether anyone happens to be
        listening is not its problem, and must never turn a saved message
        into an error.
        """
        users = sorted(set(user_ids))
        if not users:
            return
        self.publish_local(users, event)
        self._send({"users": users, "event": event})

    def publish_everyone(self, event: dict[str, Any]) -> None:
        """Hands `event` to everybody with the app open, on every process."""
        self.publish_local(self.connected_user_ids(), event)
        self._send({"users": None, "event": event})

    def publish_local(self, user_ids: Iterable[int], event: dict[str, Any]) -> None:
        """Only the people connected to THIS process.

        Goes through each socket's own loop rather than touching its queue
        directly: an ordinary route runs on a worker thread, not on the loop
        that owns the sockets.
        """
        with self._lock:
            targets = [c for uid in set(user_ids) for c in self._by_user.get(uid, ())]
        for connection in targets:
            try:
                connection.loop.call_soon_threadsafe(connection.push, event)
            except RuntimeError:
                # The loop has shut down under us: the socket is already gone.
                pass

    # --- presence: a ring that appears the moment somebody arrives ----------

    def watch(self, viewer_id: int, user_ids: Iterable[int]) -> None:
        """The world just showed `viewer_id` these people: from now on they
        hear when any of them comes or goes. Kept by whichever process holds
        the viewer's socket — the world was asked over an ordinary request,
        which may have landed on another one."""
        ids = sorted(set(user_ids))
        self._watch_local(viewer_id, ids)
        if self._broker is not None:
            self._broker.send(json.dumps({"from": self.node_id, "watch": viewer_id, "ids": ids}, separators=(",", ":")))

    def _watch_local(self, viewer_id: int, ids: list[int]) -> None:
        with self._lock:
            if viewer_id not in self._by_user:
                # Not connected here yet, or connected to another process:
                # kept for a moment in case the socket is on its way here.
                self._pending_watches[viewer_id] = (time.monotonic(), ids)
                return
            self._drop_watch(viewer_id)
            self._watches[viewer_id] = set(ids)
            for watched in ids:
                self._watched_by.setdefault(watched, set()).add(viewer_id)

    def sweep_pending(self, older_than: float = 60.0) -> int:
        """Forgets worlds whose socket never came here (it went to another
        process, or the app closed): from the heartbeat, once a minute, so
        memory never grows with people who are not connected here."""
        cutoff = time.monotonic() - older_than
        with self._lock:
            stale = [viewer for viewer, (at, _) in self._pending_watches.items() if at < cutoff]
            for viewer in stale:
                del self._pending_watches[viewer]
        return len(stale)

    def _drop_watch(self, viewer_id: int) -> None:
        """Caller holds the lock."""
        for watched in self._watches.pop(viewer_id, ()):
            viewers = self._watched_by.get(watched)
            if viewers is not None:
                viewers.discard(viewer_id)
                if not viewers:
                    del self._watched_by[watched]

    def presence(self, user_id: int, online: bool) -> None:
        """`user_id` arrived or left: everyone whose world shows them, on
        every process, hears it and lights or dims the ring."""
        self._presence_local(user_id, online)
        if self._broker is not None:
            self._broker.send(json.dumps({"from": self.node_id, "presence": user_id, "online": online}, separators=(",", ":")))

    def _presence_local(self, user_id: int, online: bool) -> None:
        with self._lock:
            viewers = list(self._watched_by.get(user_id, ()))
        if viewers:
            self.publish_local(viewers, {"type": "presence", "user_id": user_id, "online": online})

    def close_session(self, session_id: int) -> None:
        """A sign-in session was closed: its sockets hear "signed_out" and
        are cut, here and — through Redis — on every other process, so the
        device is sent to the sign-in page at once rather than at its next
        request."""
        self._close_local(session_id)
        if self._broker is not None:
            self._broker.send(json.dumps({"from": self.node_id, "close_session": session_id}, separators=(",", ":")))

    def _close_local(self, session_id: int) -> None:
        with self._lock:
            targets = [c for conns in self._by_user.values() for c in conns if c.session_id == session_id]
        for connection in targets:
            try:
                connection.loop.call_soon_threadsafe(connection.end, {"type": "signed_out"})
            except RuntimeError:
                pass

    def watch_device_request(self, code: str) -> asyncio.Event:
        """Called by the waiting request, on the event loop: the event is set
        when something happens to this sign-in request. The caller must
        `unwatch_device_request` when it stops waiting."""
        waiter = (asyncio.get_running_loop(), asyncio.Event())
        with self._lock:
            self._device_waiters.setdefault(code, set()).add(waiter)
        return waiter[1]

    def unwatch_device_request(self, code: str, event: asyncio.Event) -> None:
        with self._lock:
            mine = self._device_waiters.get(code)
            if mine is None:
                return
            mine.difference_update({w for w in mine if w[1] is event})
            if not mine:
                del self._device_waiters[code]

    def device_request_changed(self, code: str) -> None:
        """A phone opened, approved or refused a sign-in request: wakes the
        device waiting on it, here or — through Redis — elsewhere. It only
        wakes it; the device reads the answer from the database."""
        self._wake_device_local(code)
        if self._broker is not None:
            self._broker.send(json.dumps({"from": self.node_id, "device_request": code}, separators=(",", ":")))

    def _wake_device_local(self, code: str) -> None:
        with self._lock:
            waiters = list(self._device_waiters.get(code, ()))
        for loop, event in waiters:
            try:
                loop.call_soon_threadsafe(event.set)
            except RuntimeError:
                pass

    def _send(self, message: dict[str, Any]) -> None:
        if self._broker is None:
            return
        self._broker.send(json.dumps({"from": self.node_id, **message}, separators=(",", ":")))

    def receive(self, raw: str) -> None:
        """A message from the channel: delivered to whoever it names that is
        connected here. Our own messages are skipped (already delivered),
        and anything unreadable is dropped — an event is only a nudge."""
        try:
            message = json.loads(raw)
            if message.get("from") == self.node_id:
                return
            if "close_session" in message:
                self._close_local(int(message["close_session"]))
                return
            if "device_request" in message:
                self._wake_device_local(str(message["device_request"]))
                return
            if "watch" in message:
                self._watch_local(int(message["watch"]), [int(i) for i in message["ids"]])
                return
            if "presence" in message:
                self._presence_local(int(message["presence"]), bool(message["online"]))
                return
            event = message["event"]
            users = message["users"]
        except (ValueError, KeyError, TypeError):
            return
        self.publish_local(self.connected_user_ids() if users is None else users, event)


#: The one hub for this process.
hub = LiveHub()
