"""
Two records that track how users interact with a spoiler-gated Photo:

- PhotoPurchase: a PERMANENT grant, only for paid photos. Its mere
  existence means "this user already paid, don't ask again." One row per
  (user, photo) — enforced with a unique constraint.

- PhotoOpenLog: an APPEND-ONLY history of every single time a photo with
  a spoiler got revealed (free or already-purchased). No unique
  constraint on purpose: the same user can open the same photo many
  times, on different dates, and each one is its own row. This is what a
  future "who viewed my photo, how many times" feature (see
  TECHNICAL_REQUIREMENTS.md, section 9) will be built on top of.
"""

from datetime import datetime

from sqlalchemy import ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.time import UTCDateTime, utcnow


class PhotoPurchase(Base):
    __tablename__ = "photo_purchases"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    photo_id: Mapped[int] = mapped_column(ForeignKey("photos.id"))
    purchased_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    __table_args__ = (
        UniqueConstraint("user_id", "photo_id", name="uq_photo_purchase"),
    )


class PhotoOpenLog(Base):
    __tablename__ = "photo_open_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    photo_id: Mapped[int] = mapped_column(ForeignKey("photos.id"))
    opened_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
