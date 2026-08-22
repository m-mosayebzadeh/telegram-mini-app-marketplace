"""
Request: a buyer asking to purchase a specific Offer (see
TECHNICAL_REQUIREMENTS.md, section 2 "درخواست"). The provider isn't a
separate column here — it's always reachable via request.offer.provider_id.
"""

import enum
from datetime import datetime

from sqlalchemy import CheckConstraint, Enum, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.core.time import UTCDateTime, utcnow


# The auto-filled reason for a request CANCELLED as a side effect of its
# offer being deleted — shared so the offer router (which triggers this)
# and any test checking for it use the exact same text.
OFFER_DELETED_REASON = "Offer was deleted by the provider."


class RequestStatus(str, enum.Enum):
    PENDING = "pending"
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    # Closed automatically because the underlying Offer was deleted —
    # distinct from REJECTED, which always means the provider actively
    # declined this specific request.
    CANCELLED = "cancelled"


class Request(Base):
    __tablename__ = "requests"

    id: Mapped[int] = mapped_column(primary_key=True)
    buyer_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    offer_id: Mapped[int] = mapped_column(ForeignKey("offers.id"))

    status: Mapped[RequestStatus] = mapped_column(
        Enum(RequestStatus, values_callable=lambda enum_cls: [e.value for e in enum_cls]),
        default=RequestStatus.PENDING,
    )
    # Required for REJECTED (the provider's own words, or a canned option
    # the frontend fills in for them) and for CANCELLED (filled in by us
    # automatically — "the offer was deleted"). Never set otherwise.
    reason: Mapped[str | None] = mapped_column(String(500), nullable=True)

    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    responded_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)

    # Lets code write `request.offer.provider_id` instead of a separate
    # query every time it needs to know who the provider is.
    offer: Mapped["Offer"] = relationship()

    __table_args__ = (
        CheckConstraint(
            "(status IN ('rejected', 'cancelled') AND reason IS NOT NULL) OR "
            "(status IN ('pending', 'accepted') AND reason IS NULL)",
            name="ck_reason_matches_status",
        ),
    )
