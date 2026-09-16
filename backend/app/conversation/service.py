"""
Finding and creating conversations, and working out what may be done in
one right now.

Everything that needs a thread goes through here rather than building one
itself, because "these two people already have a thread" is a rule that
has to hold everywhere — including when two requests arrive at the same
instant and both find nothing.
"""

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.time import utcnow
from app.models.chat_session import ChatSession, ChatSessionStatus
from app.models.conversation import (
    CONVERSATION_DIRECT,
    CONVERSATION_EVENT,
    CONVERSATION_GROUP,
    FREE_CAPABILITIES,
    PAID_SESSION_CAPABILITIES,
    Conversation,
    ConversationParticipant,
)


def get_direct(db: Session, one_user_id: int, other_user_id: int) -> Conversation | None:
    key = Conversation.direct_key_for(one_user_id, other_user_id)
    return db.scalar(select(Conversation).where(Conversation.direct_key == key))


def get_or_create_direct(
    db: Session, one_user_id: int, other_user_id: int
) -> Conversation:
    """The one thread these two people have, created if this is the first
    time.

    Does NOT commit — the caller decides the unit of work.

    Two requests can reach this at the same moment and both find nothing,
    so the unique index on direct_key is the real guarantee and the retry
    below is how that shows up in Python: if the insert loses the race, the
    row the winner wrote is there to be read.
    """
    if one_user_id == other_user_id:
        raise ValueError("A conversation needs two different people.")

    existing = get_direct(db, one_user_id, other_user_id)
    if existing is not None:
        return existing

    conversation = Conversation(
        kind=CONVERSATION_DIRECT,
        direct_key=Conversation.direct_key_for(one_user_id, other_user_id),
        base_capabilities=list(FREE_CAPABILITIES),
        created_at=utcnow(),
    )
    db.add(conversation)
    try:
        # A nested block so losing the race rolls back only this insert,
        # leaving whatever else the caller has done in the session intact.
        with db.begin_nested():
            db.flush()
    except IntegrityError:
        found = get_direct(db, one_user_id, other_user_id)
        if found is None:  # pragma: no cover - the index says this cannot happen
            raise
        return found

    now = utcnow()
    for user_id in (one_user_id, other_user_id):
        db.add(
            ConversationParticipant(
                conversation_id=conversation.id, user_id=user_id, joined_at=now
            )
        )
    db.flush()
    db.refresh(conversation)
    return conversation


def create_group(
    db: Session,
    *,
    user_ids: list[int],
    capabilities: list[str] | None = None,
    is_event: bool = False,
) -> Conversation:
    """A thread with any number of people — a three-person chat, or an event
    room. No direct_key, so none of the one-thread-per-pair rules apply.

    The capabilities are given by whoever opens it rather than inherited,
    which is what lets an event decide its own rules: an anonymous room, a
    text-only room, a room where voice is allowed.
    """
    conversation = Conversation(
        kind=CONVERSATION_EVENT if is_event else CONVERSATION_GROUP,
        direct_key=None,
        base_capabilities=list(capabilities or FREE_CAPABILITIES),
        created_at=utcnow(),
    )
    db.add(conversation)
    db.flush()

    now = utcnow()
    for user_id in dict.fromkeys(user_ids):  # keeps order, drops duplicates
        db.add(
            ConversationParticipant(
                conversation_id=conversation.id, user_id=user_id, joined_at=now
            )
        )
    db.flush()
    db.refresh(conversation)
    return conversation


def active_paid_session(db: Session, conversation_id: int) -> ChatSession | None:
    """The paid session running in this thread right now, if any.

    "Running" means open and already started: a session whose money is
    reserved but whose provider has not arrived yet has not begun, so it
    unlocks nothing.
    """
    return db.scalar(
        select(ChatSession)
        .where(
            ChatSession.conversation_id == conversation_id,
            ChatSession.status == ChatSessionStatus.OPEN,
            ChatSession.started_at.is_not(None),
        )
        .order_by(ChatSession.opened_at.desc())
    )


def capabilities_now(
    conversation: Conversation, paid_session: ChatSession | None
) -> list[str]:
    """What may be sent in this thread at this moment.

    The conversation's own baseline, plus whatever a running paid session
    adds. Written as a union rather than a replacement so that a session
    can only ever widen what is possible — a bought session that took away
    something free would be an absurd thing to sell.
    """
    allowed = list(conversation.base_capabilities or FREE_CAPABILITIES)
    if paid_session is not None:
        for capability in PAID_SESSION_CAPABILITIES:
            if capability not in allowed:
                allowed.append(capability)
    return allowed


def touch(conversation: Conversation, when: datetime | None = None) -> None:
    """Records that something was said, so the chat list can be ordered
    without reading the messages table."""
    conversation.last_message_at = when or utcnow()
