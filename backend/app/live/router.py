"""
The live connection itself: one socket per open app.

The conversation is short. The phone opens the socket and, as its first
message, sends who it is:

    {"type": "hello", "credentials": "<the same sign-in string every request carries>"}

The server answers {"type": "ready"} and from then on pushes events (see
hub.py). The phone sends {"type": "ping"} every so often and gets
{"type": "pong"} back; that keeps proxies and mobile networks, which cut
connections that look idle, from cutting this one, and tells the phone
quickly when the line has gone dead.

Credentials go in the first message rather than in the address, because
addresses end up in server and proxy logs and a sign-in string should not.
"""

from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect, status
from sqlalchemy.orm import Session

from app.auth.dependencies import find_user_by_credentials
from app.core.database import get_db
from app.live.hub import hub
from app.live.typing import TypingGate, typing_targets
from starlette.concurrency import run_in_threadpool

router = APIRouter(tags=["live"])

#: How long a freshly opened socket may stay silent before saying who it
#: is. An unidentified socket holds a slot and does nothing useful.
HELLO_WITHIN_SECONDS = 10

#: The longest the server waits to hear anything at all — a ping included
#: — before deciding the other end is gone. The phone pings well inside
#: this (see frontend/src/lib/live.ts).
SILENCE_LIMIT_SECONDS = 75


@router.websocket("/live")
async def live(websocket: WebSocket, db: Session = Depends(get_db)) -> None:
    await websocket.accept()

    try:
        hello = json.loads(
            await asyncio.wait_for(websocket.receive_text(), HELLO_WITHIN_SECONDS)
        )
    except (asyncio.TimeoutError, ValueError, WebSocketDisconnect):
        await _close(websocket, status.WS_1008_POLICY_VIOLATION)
        return

    user = None
    if isinstance(hello, dict) and hello.get("type") == "hello":
        credentials = hello.get("credentials")
        if isinstance(credentials, str):
            user = find_user_by_credentials(db, credentials)
    user_id = user.id if user is not None else None
    # The database is needed for exactly one lookup. Holding a connection
    # from the pool for as long as a socket stays open — hours, for
    # somebody who leaves the app open — would run the pool dry with a few
    # dozen people online.
    db.close()

    if user_id is None:
        await _close(websocket, status.WS_1008_POLICY_VIOLATION)
        return

    connection = hub.register(user_id)
    try:
        await websocket.send_json({"type": "ready"})
        await _pump(websocket, connection, db)
    finally:
        hub.unregister(connection)


async def _pump(websocket: WebSocket, connection, db: Session) -> None:
    """Sends queued events, answers pings and passes on "typing…", until
    either side stops."""
    gate = TypingGate()
    bind = db.get_bind()

    async def typing(conversation_id: int) -> None:
        if gate.too_soon(conversation_id):
            return
        targets = gate.cached(conversation_id)
        if targets is None:
            # The database is sync, so it is asked off the event loop, in a
            # session of its own that opens and closes around the one
            # question. Sharing the request's session broke when the socket
            # closed mid-question: the cancelled task closed the session
            # while the worker thread was still inside it.
            targets = await run_in_threadpool(_ask_targets, bind, conversation_id, connection.user_id)
            gate.remember(conversation_id, targets)
        hub.publish(
            targets,
            {"type": "typing", "conversation_id": conversation_id, "user_id": connection.user_id},
        )

    async def outgoing() -> None:
        while True:
            event = await connection.queue.get()
            if event is None:
                # Too far behind (hub.MAX_PENDING). Closing tells the phone
                # to reconnect and catch up from the database.
                await _close(websocket, status.WS_1013_TRY_AGAIN_LATER)
                return
            await websocket.send_json(event)

    async def incoming() -> None:
        while True:
            raw = await asyncio.wait_for(websocket.receive_text(), SILENCE_LIMIT_SECONDS)
            try:
                message = json.loads(raw)
            except ValueError:
                continue
            if not isinstance(message, dict):
                continue
            if message.get("type") == "ping":
                await websocket.send_json({"type": "pong"})
            elif message.get("type") == "typing" and isinstance(message.get("conversation_id"), int):
                await typing(message["conversation_id"])

    tasks = [asyncio.create_task(outgoing()), asyncio.create_task(incoming())]
    try:
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    finally:
        for task in tasks:
            task.cancel()
        # Collect the cancellations so no task is left with an unread error.
        await asyncio.gather(*tasks, return_exceptions=True)


def _ask_targets(bind, conversation_id: int, user_id: int) -> list[int]:
    with Session(bind) as session:
        return typing_targets(session, conversation_id, user_id)


async def _close(websocket: WebSocket, code: int) -> None:
    try:
        await websocket.close(code)
    except RuntimeError:
        # Already closed from the other end.
        pass
