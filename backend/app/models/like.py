"""
Like: a user liking a piece of Content. Like-only, no dislike — a row's
mere existence means "liked"; removing it means "unliked" (see
app/content/router.py). One row per (user, content), enforced with a
unique constraint, so double-tapping like doesn't inflate the count.
"""

from datetime import datetime

from sqlalchemy import ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.time import UTCDateTime, utcnow


class Like(Base):
    __tablename__ = "likes"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    content_id: Mapped[int] = mapped_column(ForeignKey("contents.id"))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    __table_args__ = (UniqueConstraint("user_id", "content_id", name="uq_like"),)
