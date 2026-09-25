"""
Offer: a service a provider is selling (see TECHNICAL_REQUIREMENTS.md,
section 2 "پیشنهاد"). Belongs directly to a User — not via Profile — so
creating one never requires a profile to exist first.
"""

import enum
from datetime import datetime

from sqlalchemy import CheckConstraint, Enum, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.config import SESSION_BLOCK_COUNT
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
        Enum(OfferServiceType, values_callable=lambda enum_cls: [e.value for e in enum_cls], native_enum=False),
        default=OfferServiceType.CHAT,
    )
    # The price of ONE session, not a rate. It must divide evenly by
    # SESSION_BLOCK_COUNT, because a session is sold and settled one block at a
    # time and a block price that needed rounding would put a fraction of a
    # Photon somewhere on every single session.
    price_photons: Mapped[int] = mapped_column(Integer)
    # How long that session runs. This used to be decoration — the old model
    # said explicitly that nothing read it — and is now a real commitment: the
    # session opens for exactly this long and closes itself at the end of the
    # last block (see TECHNICAL_REQUIREMENTS.md section 15).
    #
    # Seconds rather than minutes so a block is always a whole number: any
    # whole number of minutes divides exactly by four once expressed in
    # seconds, which a count of minutes would not.
    session_duration_seconds: Mapped[int] = mapped_column(Integer)
    # The short label shown wherever an offer is listed (Discover, "my
    # offers", ...) — separate from `description`, which is the longer
    # free-text explanation. Before this field existed, the UI was
    # (wrongly) using `description` as if it were the title.
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(String(2000))

    status: Mapped[OfferStatus] = mapped_column(
        Enum(OfferStatus, values_callable=lambda enum_cls: [e.value for e in enum_cls], native_enum=False),
        default=OfferStatus.ACTIVE,
    )

    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    # Deleting is marking, not removing. Requests keep pointing at the offer
    # they were made against — the rule that a request cancelled because its
    # offer went away is counted differently from one the buyer cancelled only
    # means something while the offer is still there to look at. A removed row
    # would leave those requests pointing at nothing, which is what the
    # database now refuses outright.
    #
    # Users never see a deleted offer; staff see everything, which is the
    # point of keeping it.
    deleted_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)

    @property
    def is_deleted(self) -> bool:
        return self.deleted_at is not None

    __table_args__ = (
        # Enforced here as well as in the schema: these two invariants are what
        # let every later block calculation be plain integer arithmetic.
        CheckConstraint(
            f'price_photons > 0 AND price_photons % {SESSION_BLOCK_COUNT} = 0',
            name='ck_offer_price_divides_into_blocks',
        ),
        CheckConstraint(
            f'session_duration_seconds > 0 AND session_duration_seconds % {SESSION_BLOCK_COUNT} = 0',
            name='ck_offer_duration_divides_into_blocks',
        ),
    )

    @property
    def block_duration_seconds(self) -> int:
        """How long one block of this offer's session lasts."""
        return self.session_duration_seconds // SESSION_BLOCK_COUNT

    @property
    def block_price_photons(self) -> int:
        """What one block of this offer's session costs."""
        return self.price_photons // SESSION_BLOCK_COUNT

    # When the provider last opened THIS offer's own incoming-requests
    # list (GET /requests?offer_id=..., see app/request/router.py's
    # list_requests_for_offer) — NULL means "never". Powers the
    # per-offer "unseen requests" badge (OfferOut.request_count, see
    # app/offer/router.py's list_offers): a request created after this
    # timestamp counts as unseen. Deliberately per-OFFER, not a single
    # per-user timestamp — opening offer A's own request list is what
    # clears offer A's badge specifically, leaving offer B's untouched,
    # per the product decision behind this (see
    # TECHNICAL_REQUIREMENTS.md section 4).
    requests_last_viewed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
