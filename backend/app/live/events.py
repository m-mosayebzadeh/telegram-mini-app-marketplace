"""
The moments worth pushing, in one place.

Routes call these after they have committed. The order matters: an event
that went out before the commit could describe something that then rolled
back, and the phone would show a message that does not exist.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy.orm import Session

from app.chat_message.actions import messages_out, reactions_of
from app.live.hub import hub
from app.models.chat_message import ChatMessage
from app.models.conversation import Conversation


def _everyone_in(conversation: Conversation) -> list[int]:
    return [p.user_id for p in conversation.participants]


def _shaped(db: Session, message: ChatMessage) -> dict:
    return messages_out(db, [message])[0].model_dump(mode="json")


def announce_message(db: Session, conversation: Conversation, message: ChatMessage) -> None:
    """A new message, to everyone in the thread — the sender included,
    because the sender may have the same thread open on a second device."""
    hub.publish(
        _everyone_in(conversation),
        {"type": "message", "conversation_id": conversation.id, "message": _shaped(db, message)},
    )


def announce_edited(db: Session, conversation: Conversation, message: ChatMessage) -> None:
    hub.publish(
        _everyone_in(conversation),
        {"type": "edited", "conversation_id": conversation.id, "message": _shaped(db, message)},
    )


def announce_deleted(conversation: Conversation, message_ids: list[int], only_for: int | None) -> None:
    """Messages gone from view: for everyone, or — with `only_for` — from
    one person's own devices, since hiding a message for yourself is
    nobody else's business."""
    if not message_ids:
        return
    hub.publish(
        [only_for] if only_for is not None else _everyone_in(conversation),
        {"type": "deleted", "conversation_id": conversation.id, "message_ids": message_ids},
    )


def announce_reactions(db: Session, conversation: Conversation, message_id: int) -> None:
    """The whole set of reactions on a message after a change, rather than
    the change itself: an event that arrives twice, or after a reconnect,
    still leaves the right answer on screen."""
    reactions = reactions_of(db, [message_id]).get(message_id, [])
    hub.publish(
        _everyone_in(conversation),
        {
            "type": "reactions",
            "conversation_id": conversation.id,
            "message_id": message_id,
            "reactions": [r.model_dump() for r in reactions],
        },
    )


def announce_read(conversation: Conversation, reader_id: int, read_at: datetime) -> None:
    """Somebody has read the thread up to `read_at`. Sent to the others,
    whose own messages up to that moment now show as seen."""
    hub.publish(
        [uid for uid in _everyone_in(conversation) if uid != reader_id],
        {
            "type": "read",
            "conversation_id": conversation.id,
            "user_id": reader_id,
            "read_at": read_at.isoformat(),
        },
    )
