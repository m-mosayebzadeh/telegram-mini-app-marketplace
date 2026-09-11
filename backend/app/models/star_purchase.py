"""
StarPurchase: one real Telegram Stars top-up, paid entirely inside
Telegram's own native payment sheet (see app/telegram_bot.py,
app/topup/router.py, and app/telegram_webhook/router.py).

Deliberately its own entity, separate from TopUpRequest (the manual
card-to-card flow) — this one has no admin review step at all. It's
created PENDING the moment we ask Telegram for an invoice link, and
flips to PAID automatically the instant Telegram's webhook reports a
successful_payment for it — see app/telegram_webhook/router.py for the
exact security/idempotency reasoning (invoice_payload matches this row
back to the right purchase; telegram_payment_charge_id is Telegram's
own unique id for that specific payment, so a duplicate/replayed
webhook call can never credit the wallet twice for the same payment).
"""

import enum
from datetime import datetime

from sqlalchemy import CheckConstraint, Enum, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.time import UTCDateTime, utcnow


class StarPurchaseStatus(str, enum.Enum):
    PENDING = "pending"
    PAID = "paid"


class StarPurchase(Base):
    __tablename__ = "star_purchases"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))

    stars: Mapped[int] = mapped_column(Integer)

    # An opaque token WE generate (see app/topup/router.py's
    # create_star_invoice) and hand to Telegram as the invoice's
    # "payload" field — Telegram doesn't interpret it at all, it just
    # echoes it back untouched on the eventual successful_payment
    # update, which is how the webhook finds its way back to THIS row.
    invoice_payload: Mapped[str] = mapped_column(String(100), unique=True)

    status: Mapped[StarPurchaseStatus] = mapped_column(
        Enum(StarPurchaseStatus, values_callable=lambda enum_cls: [e.value for e in enum_cls]),
        default=StarPurchaseStatus.PENDING,
    )

    # Only set once Telegram actually confirms payment. Unique because
    # it's Telegram's own id for that one payment — the webhook looks
    # this up first, before even touching invoice_payload, so a replayed
    # or duplicated webhook call is a no-op the second time (see the
    # webhook handler's own docstring).
    telegram_payment_charge_id: Mapped[str | None] = mapped_column(String(100), unique=True, nullable=True)
    paid_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)

    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    __table_args__ = (
        CheckConstraint(
            "(status = 'pending' AND telegram_payment_charge_id IS NULL AND paid_at IS NULL) OR "
            "(status = 'paid' AND telegram_payment_charge_id IS NOT NULL AND paid_at IS NOT NULL)",
            name="ck_star_purchase_paid_fields_match_status",
        ),
    )
