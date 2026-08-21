"""
AudienceGroup: a reusable, named circle of users an owner controls (e.g.
"Friends", "Family"), used to scope who a photo is published to. Members
are stored as separate rows (AudienceGroupMember) rather than a single
list column, so members can be added/removed one at a time and the
database can enforce "no duplicate membership" itself.
"""

from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class AudienceGroup(Base):
    __tablename__ = "audience_groups"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    name: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    # cascade="all, delete-orphan": if a group itself is deleted, delete
    # its membership rows along with it instead of leaving them behind
    # pointing at a group that no longer exists.
    members: Mapped[list["AudienceGroupMember"]] = relationship(
        back_populates="group", cascade="all, delete-orphan"
    )


class AudienceGroupMember(Base):
    """One row per (group, user) membership."""

    __tablename__ = "audience_group_members"

    id: Mapped[int] = mapped_column(primary_key=True)
    group_id: Mapped[int] = mapped_column(ForeignKey("audience_groups.id"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    added_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    group: Mapped["AudienceGroup"] = relationship(back_populates="members")

    __table_args__ = (
        # Same user can't be added to the same group twice.
        UniqueConstraint("group_id", "user_id", name="uq_group_member"),
    )
