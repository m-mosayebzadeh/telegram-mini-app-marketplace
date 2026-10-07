"""
Friends (section 32, step 4): two-way, like LinkedIn, made for this app.

One person asks, the other accepts, and from then on each is in the
other's list. It replaces following, which split people into an audience
and the famous; a friendship has no direction and no count to chase.

One row per pair, whoever asked, smallest id first — the convention every
pair in this app uses — so "are these two friends" is one lookup and a
pair can never be friends twice. Saying no, cancelling a request and
unfriending all simply remove the row: nothing is kept that could be
shown back to anybody.
"""

from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.time import UTCDateTime, utcnow

FRIENDSHIP_PENDING = "pending"
FRIENDSHIP_ACCEPTED = "accepted"

#: Who may see somebody's list of friends. Everyone by default — the
#: freest setting, narrowed by whoever wants it narrower (the owner's
#: rule) — then friends only, people they choose, or nobody.
FRIENDS_SEEN_BY_EVERYONE = "everyone"
FRIENDS_SEEN_BY_FRIENDS = "friends"
FRIENDS_SEEN_BY_CHOSEN = "chosen"
FRIENDS_SEEN_BY_NOBODY = "nobody"
FRIENDS_SEEN_BY = (
    FRIENDS_SEEN_BY_EVERYONE,
    FRIENDS_SEEN_BY_FRIENDS,
    FRIENDS_SEEN_BY_CHOSEN,
    FRIENDS_SEEN_BY_NOBODY,
)


class Friendship(Base):
    __tablename__ = "friendships"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_low_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), index=True)
    user_high_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), index=True)
    #: Who asked. While pending, the other one is the one who answers.
    requested_by_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"))
    status: Mapped[str] = mapped_column(String(16), default=FRIENDSHIP_PENDING)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    accepted_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)

    __table_args__ = (
        UniqueConstraint("user_low_id", "user_high_id", name="uq_friendship_pair"),
        CheckConstraint("user_low_id < user_high_id", name="ck_friendship_order"),
        CheckConstraint("status IN ('pending', 'accepted')", name="ck_friendship_status"),
    )

    def other_than(self, user_id: int) -> int:
        return self.user_high_id if self.user_low_id == user_id else self.user_low_id


class FriendsListViewer(Base):
    """Somebody allowed to see a person's list of friends, when that person
    chose "people I choose"."""

    __tablename__ = "friends_list_viewers"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), index=True)
    viewer_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"))

    __table_args__ = (UniqueConstraint("owner_id", "viewer_id", name="uq_friends_viewer"),)
