"""
The moments worth pushing, in one place.

Routes call these after they have committed. The order matters: an event
that went out before the commit could describe something that then rolled
back, and the phone would show a message that does not exist.
"""

from __future__ import annotations

from datetime import datetime

from app.chat_message.schemas import ChatMessageOut
from app.live.hub import hub
from app.models.chat_message import ChatMessage
from app.models.conversation import Conversation


def _everyone_in(conversation: Conversation) -> list[int]:
    return [p.user_id for p in conversation.participants]


def announce_message(conversation: Conversation, message: ChatMessage) -> None:
    """A new message, to everyone in the thread — the sender included,
    because the sender may have the same thread open on a second device."""
    hub.publish(
        _everyone_in(conversation),
        {
            "type": "message",
            "conversation_id": conversation.id,
            "message": ChatMessageOut.model_validate(message).model_dump(mode="json"),
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
