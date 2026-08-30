"""
ChatSession: the open conversation between a buyer and provider, tied to
one paid Request (see TECHNICAL_REQUIREMENTS.md, "نشست چت").

Created automatically the moment payment succeeds (see
app/request/router.py's pay_for_request) — never a separate "open the
session" action, so a paid request can never be left without one.

Deliberately just two states, OPEN/CLOSED, matching
TECHNICAL_REQUIREMENTS.md section 3: a session NEVER closes itself based
on elapsed time, only a manual action by either party. What happens to
the money after closing (the grace-period auto-release, or a dispute
freezing it) lives on Transaction / app/wallet/service.py, not here —
this model only tracks the conversation's own open/closed state.
"""

import enum
from datetime import datetime

from sqlalchemy import Boolean, Enum, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.core.time import UTCDateTime, utcnow


class ChatSessionStatus(str, enum.Enum):
    OPEN = "open"
    CLOSED = "closed"


class ChatSession(Base):
    __tablename__ = "chat_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    # One-to-one: every paid Request gets exactly one session, and vice
    # versa — enforced by unique=True, not just convention.
    request_id: Mapped[int] = mapped_column(ForeignKey("requests.id"), unique=True)
    transaction_id: Mapped[int] = mapped_column(ForeignKey("transactions.id"), unique=True)

    status: Mapped[ChatSessionStatus] = mapped_column(
        Enum(ChatSessionStatus, values_callable=lambda enum_cls: [e.value for e in enum_cls]),
        default=ChatSessionStatus.OPEN,
    )
    opened_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    closed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    closed_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )

    # Per-viewer "archived" state — moves a session out of the Chats
    # tab's main list into its Archived segment (see app/chat_session/router.py's
    # /archive, /unarchive) without touching the other participant's
    # view of the same session, and without deleting anything: the
    # session (and the Transaction it's tied to) always stays exactly
    # where it is, for both parties' financial/dispute history. Two
    # plain booleans rather than a join table, since a session only ever
    # has exactly two possible viewers (buyer, provider).
    archived_by_buyer: Mapped[bool] = mapped_column(Boolean, default=False)
    archived_by_provider: Mapped[bool] = mapped_column(Boolean, default=False)

    # Lets code reach `session.request.buyer_id` /
    # `session.request.offer.provider_id` instead of separate queries.
    request: Mapped["Request"] = relationship()
    transaction: Mapped["Transaction"] = relationship()
