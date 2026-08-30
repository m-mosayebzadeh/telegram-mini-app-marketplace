"""
Follow: a directed "A wants to follow B" relationship between two users.

Per TECHNICAL_REQUIREMENTS.md, every account behaves the same way — there
is no public/private account toggle — and every follow request needs the
target's explicit approval before it takes effect (same UX as Instagram's
private accounts, just applied to everyone).
"""

import enum
from datetime import datetime

from sqlalchemy import CheckConstraint, Enum, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.time import UTCDateTime, utcnow


class FollowStatus(str, enum.Enum):
    PENDING = "pending"
    ACCEPTED = "accepted"
    # A rejected request is kept, not deleted — the whole point is to
    # let the followee see their own request history (who they've
    # rejected before), the same way Request keeps a REJECTED row
    # instead of deleting it. Re-requesting after rejection resets this
    # same row back to PENDING (see app/follow/router.py's
    # request_follow) — the unique pair constraint below means there
    # can only ever be one row per (follower, followee) anyway.
    REJECTED = "rejected"


class Follow(Base):
    __tablename__ = "follows"

    id: Mapped[int] = mapped_column(primary_key=True)

    follower_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    followee_id: Mapped[int] = mapped_column(ForeignKey("users.id"))

    status: Mapped[FollowStatus] = mapped_column(
        Enum(FollowStatus, values_callable=lambda enum_cls: [e.value for e in enum_cls]),
        default=FollowStatus.PENDING,
    )

    requested_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    # None until the followee accepts or rejects — set either way,
    # and cleared again if a rejected request gets reset back to
    # PENDING by a fresh request from the same follower.
    responded_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)

    __table_args__ = (
        # Same pair can't have two rows — re-requesting after a pending
        # request already exists should update the existing row, not
        # create a second one.
        UniqueConstraint("follower_id", "followee_id", name="uq_follow_pair"),
        # A user can't follow themselves.
        CheckConstraint("follower_id != followee_id", name="ck_no_self_follow"),
    )
