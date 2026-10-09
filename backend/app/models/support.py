"""
Answering people who write to Cosmos Team (TECHNICAL_REQUIREMENTS.md
section 43).

The team is one account; the people behind it are staff holding the
"support.conversations" permission (through a role), plus the owner. They
answer from the app's own conversation screen, as the team: the person on
the other side only ever sees "Cosmos Team".

Two small tables keep that honest:

- SupportLock: whoever has started answering a conversation holds it, so
  two staff never answer the same person at once. It frees itself ten
  minutes after the holder last did anything — unless the owner handed it
  to somebody, which holds until that person answers.
- SupportOpening: every time a staff member opens one of these
  conversations. Staff read people's words without them knowing who, so
  each look is recorded (section 21: the one thing that makes such access
  answerable).

Which staff member wrote each answer is kept on the message itself
(ChatMessage.staff_id), for the owner's eyes only.
"""

from datetime import datetime

from sqlalchemy import BigInteger, Boolean, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.time import UTCDateTime, utcnow


class SupportLock(Base):
    __tablename__ = "support_locks"

    #: One lock per conversation, at most.
    conversation_id: Mapped[int] = mapped_column(ForeignKey("conversations.id"), primary_key=True)
    holder_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"))
    #: The holder's last claim or answer; the ten minutes count from here.
    touched_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    #: Handed over by the owner: does not run out until the holder answers.
    handed: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")


class SupportOpening(Base):
    __tablename__ = "support_openings"

    id: Mapped[int] = mapped_column(primary_key=True)
    conversation_id: Mapped[int] = mapped_column(ForeignKey("conversations.id"), index=True)
    staff_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"))
    opened_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
