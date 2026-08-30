"""
Offer: a service a provider is selling (see TECHNICAL_REQUIREMENTS.md,
section 2 "پیشنهاد"). Belongs directly to a User — not via Profile — so
creating one never requires a profile to exist first.
"""

import enum
from datetime import datetime

from sqlalchemy import Enum, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.time import UTCDateTime, utcnow


class OfferServiceType(str, enum.Enum):
    # Only one member for now — modeled as an enum (not a hardcoded
    # string) so a future service type (voice call, video call, ...) is
    # just a new member, not a schema change.
    CHAT = "chat"


class OfferStatus(str, enum.Enum):
    ACTIVE = "active"
    INACTIVE = "inactive"


class Offer(Base):
    __tablename__ = "offers"

    id: Mapped[int] = mapped_column(primary_key=True)
    provider_id: Mapped[int] = mapped_column(ForeignKey("users.id"))

    service_type: Mapped[OfferServiceType] = mapped_column(
        Enum(OfferServiceType, values_callable=lambda enum_cls: [e.value for e in enum_cls]),
        default=OfferServiceType.CHAT,
    )
    price_stars: Mapped[int] = mapped_column(Integer)
    # Informational only — TECHNICAL_REQUIREMENTS.md is explicit that
    # this is NOT an enforced timer; nothing in this app ever reads this
    # value to decide when a chat session should end.
    display_duration_minutes: Mapped[int] = mapped_column(Integer)
    # The short label shown wherever an offer is listed (Discover, "my
    # offers", ...) — separate from `description`, which is the longer
    # free-text explanation. Before this field existed, the UI was
    # (wrongly) using `description` as if it were the title.
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(String(2000))

    status: Mapped[OfferStatus] = mapped_column(
        Enum(OfferStatus, values_callable=lambda enum_cls: [e.value for e in enum_cls]),
        default=OfferStatus.ACTIVE,
    )

    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
