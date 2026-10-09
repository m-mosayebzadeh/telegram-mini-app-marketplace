"""
The moments worth pushing, in one place.

Routes call these after they have committed. The order matters: an event
that went out before the commit could describe something that then rolled
back, and the phone would show a message that does not exist.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy.orm import Session, object_session

from app.chat_message.actions import messages_out, reactions_of
from app.live.hub import hub
from app.models.chat_message import ChatMessage
from app.models.conversation import Conversation


def _everyone_in(conversation: Conversation) -> list[int]:
    """The people in the thread — and, for a conversation with Cosmos Team,
    the staff who answer for the team (section 43), so a new word reaches
    their open screens the moment it is written."""
    ids = [p.user_id for p in conversation.participants]
    db = object_session(conversation)
    if db is not None:
        from app.support import service as support  # imports the auth layer; not at load time

        if support.is_team_conversation(db, conversation):
            ids = sorted(set(ids) | set(support.staff_ids(db)))
    return ids


def _shaped(db: Session, message: ChatMessage) -> dict:
    return messages_out(db, [message])[0].model_dump(mode="json")


def announce_message(db: Session, conversation: Conversation, message: ChatMessage) -> None:
    """A new message, to everyone in the thread — the sender included,
    because the sender may have the same thread open on a second device."""
    hub.publish(
        _everyone_in(conversation),
        {"type": "message", "conversation_id": conversation.id, "message": _shaped(db, message)},
    )
    # And to whoever is away, a notification (section 38).
    from app.models.user import User
    from app.push import sender

    author = db.get(User, message.sender_id)
    if author is not None:
        sender.message_sent(db, conversation, message, author)


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


def announce_requests(user_ids: list[int]) -> None:
    """Something about a request between these people changed: made,
    confirmed, refused, withdrawn, paid, or run out.

    Carries no details on purpose. Each screen already knows how to read its
    requests, and reading them is also what runs the lazy deadlines — so the
    nudge alone keeps every countdown and every queued card honest.
    """
    hub.publish(user_ids, {"type": "requests"})


def announce_cleared(conversation: Conversation) -> None:
    """Somebody cleared or deleted this chat for everyone in it: whoever has
    it open reads it again, and finds it empty."""
    hub.publish(
        _everyone_in(conversation), {"type": "cleared", "conversation_id": conversation.id}
    )


def announce_echo_to_everyone() -> None:
    """Echo itself changed: the panel switched it on or off, or moved its
    hours. Everyone with the app open hears it, so the Echo mark in the bar
    changes at once instead of when somebody next opens Echo (the owner's
    report).

    Marked "everyone" so each app waits a moment of its own before asking:
    a whole crowd asking for its status in the same instant is a spike the
    server does not need.
    """
    hub.publish_everyone({"type": "echo", "everyone": True})


def announce_echo(user_ids: list[int]) -> None:
    """Something about these people's Echo changed: they were put in front
    of somebody, somebody answered, or it was settled.

    Carries no details, like the request nudge: reading Echo's status is
    also what settles a proposal whose time has run out, so the nudge alone
    keeps every card and every countdown honest.
    """
    hub.publish(user_ids, {"type": "echo"})
