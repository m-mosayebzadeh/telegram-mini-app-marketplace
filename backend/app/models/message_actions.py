"""
What people do TO a message after it has been sent: edit it, hide it from
their own view, react to it.

The rule over all of this is TECHNICAL_REQUIREMENTS.md section 24.1: nothing
is ever really deleted or overwritten. An edit keeps what the message said
before; a deletion only marks. The product sells a guarantee around paying
strangers, and a guarantee that one side could quietly rewrite the evidence
of is not one.
"""

from datetime import datetime

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.time import UTCDateTime, utcnow
from app.models.chat_message import MAX_CHAT_MESSAGE_TEXT_LENGTH

#: Enough for any single emoji, including the long ones built from several
#: code points joined together (a family, a flag, a skin tone).
MAX_REACTION_LENGTH = 32


class MessageEdit(Base):
    """What a message said before one edit.

    One row per edit, never updated. Staff reading a complaint can see
    every version and when each was replaced; the people in the thread see
    only the latest, marked as edited.
    """

    __tablename__ = "message_edits"

    id: Mapped[int] = mapped_column(primary_key=True)
    message_id: Mapped[int] = mapped_column(ForeignKey("chat_messages.id"), index=True)
    previous_text: Mapped[str] = mapped_column(String(MAX_CHAT_MESSAGE_TEXT_LENGTH))
    edited_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class HiddenMessage(Base):
    """One message removed from ONE person's view.

    A row per message, which is fine only because hiding single messages is
    rare. Clearing a whole thread must never be done with these — that is
    one timestamp on the participant row (section 24.1's table explains why
    confusing the two turns one tap into tens of thousands of writes).
    """

    __tablename__ = "hidden_messages"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    message_id: Mapped[int] = mapped_column(ForeignKey("chat_messages.id"), primary_key=True)
    hidden_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class MessageReaction(Base):
    """One person's reaction to one message.

    One per person per message, like Telegram without its paid tier: a
    second reaction replaces the first. The primary key is what enforces
    it, so two taps racing each other cannot leave two behind.
    """

    __tablename__ = "message_reactions"

    message_id: Mapped[int] = mapped_column(ForeignKey("chat_messages.id"), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True, index=True)
    emoji: Mapped[str] = mapped_column(String(MAX_REACTION_LENGTH))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


