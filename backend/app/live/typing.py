"""
"Typing…": who should be told that somebody is writing in a thread.

Nothing here is stored. A typing signal lives for a few seconds on the
other person's screen and is worth nothing afterwards, so it goes straight
from one socket to the others and is forgotten.

Two rules are checked before passing it on, because the signal comes from
the phone and a phone can send anything: the sender must really be in the
thread, and in a direct thread neither side may have blocked the other —
"typing…" from somebody you blocked is exactly the contact a block exists
to stop.
"""

from __future__ import annotations

import time

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models.block import Block
from app.models.conversation import CONVERSATION_DIRECT, Conversation

#: The phone sends a typing signal at most this often while somebody types
#: (frontend/src/lib/live.ts). Anything faster from one connection is
#: dropped, so a misbehaving client cannot turn the server into a
#: loudspeaker.
MIN_INTERVAL_SECONDS = 2.0

#: How long the answer to "who is in this thread" is trusted. People type
#: in bursts; asking the database on every burst would be most of the cost
#: of this feature, and a thread's membership barely ever changes.
MEMBERS_TTL_SECONDS = 60.0


def typing_targets(db: Session, conversation_id: int, user_id: int) -> list[int]:
    """The others in the thread who should see that `user_id` is typing —
    or nobody, if `user_id` is not in it or a block stands between them."""
    conversation = db.get(Conversation, conversation_id)
    if conversation is None:
        return []
    members = [p.user_id for p in conversation.participants]
    if user_id not in members:
        return []
    others = [uid for uid in members if uid != user_id]
    if conversation.kind == CONVERSATION_DIRECT and others:
        other = others[0]
        blocked = db.scalar(
            select(Block.id).where(
                or_(
                    (Block.blocker_id == user_id) & (Block.blocked_id == other),
                    (Block.blocker_id == other) & (Block.blocked_id == user_id),
                )
            )
        )
        if blocked is not None:
            return []
    return others


class TypingGate:
    """One connection's memory of whom it may tell, and how recently it did.

    Lives exactly as long as the socket, so there is nothing to clean up
    and nothing shared between people.
    """

    def __init__(self) -> None:
        self._members: dict[int, tuple[float, list[int]]] = {}
        self._last_sent: dict[int, float] = {}

    def too_soon(self, conversation_id: int, now: float | None = None) -> bool:
        now = time.monotonic() if now is None else now
        last = self._last_sent.get(conversation_id)
        if last is not None and now - last < MIN_INTERVAL_SECONDS:
            return True
        self._last_sent[conversation_id] = now
        return False

    def cached(self, conversation_id: int, now: float | None = None) -> list[int] | None:
        now = time.monotonic() if now is None else now
        found = self._members.get(conversation_id)
        if found is None or now - found[0] > MEMBERS_TTL_SECONDS:
            return None
        return found[1]

    def remember(self, conversation_id: int, targets: list[int], now: float | None = None) -> None:
        self._members[conversation_id] = (time.monotonic() if now is None else now, targets)
