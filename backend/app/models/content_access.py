"""
Two records that track how users interact with a spoiler-gated Content
item:

- ContentPurchase: a PERMANENT grant, only for paid content. Its mere
  existence means "this user already paid, don't ask again." One row per
  (user, content) — enforced with a unique constraint.

- ContentOpenLog: an APPEND-ONLY history of every single time a content
  item with a spoiler got revealed (free or already-purchased). No
  unique constraint on purpose: the same user can open the same item
  many times, on different dates, and each one is its own row. This is
  what a future "who viewed my content, how many times" feature (see
  TECHNICAL_REQUIREMENTS.md, section 9) will be built on top of.
"""

from datetime import datetime

from sqlalchemy import ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.time import UTCDateTime, utcnow


class ContentPurchase(Base):
    __tablename__ = "content_purchases"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    content_id: Mapped[int] = mapped_column(ForeignKey("contents.id"))
    purchased_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    __table_args__ = (
        UniqueConstraint("user_id", "content_id", name="uq_content_purchase"),
    )


class ContentOpenLog(Base):
    __tablename__ = "content_open_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    content_id: Mapped[int] = mapped_column(ForeignKey("contents.id"))
    opened_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
