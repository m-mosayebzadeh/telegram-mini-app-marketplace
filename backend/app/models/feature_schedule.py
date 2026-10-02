"""
FeatureSchedule: when a feature is open, on the viewer's own wall clock.

Written as a general structure with random chat as its first consumer
(TECHNICAL_REQUIREMENTS.md section 28), because the events that follow
all need the same two answers: is this open right now, and how long until
it opens.

The one idea that makes this different from ordinary scheduling: the
window is stored as two wall-clock minutes and NO timezone at all. "Ten
at night" means ten at night wherever the viewer is, so Iranians are
online together and Germans are online together — which is better for
language and for the feel of the room, and turns "every night at ten"
into a personal appointment rather than a broadcast.

An absolute instant cannot express that, because 22:00 in Tehran and
22:00 in Berlin are different moments. The accepted consequence is that
the pool splits by timezone and each region has to reach critical mass on
its own; that is irrelevant inside one country and becomes a reason to
grow one region at a time rather than spreading thin.
"""

from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.time import UTCDateTime, utcnow

#: The features that can be scheduled. A plain string rather than a
#: database enum, for the same reason every other enum here is text: adding
#: a value should not be an ALTER TYPE that cannot run in a transaction.
FEATURE_RANDOM_CHAT = "random_chat"

#: A window covering the whole day. Stored rather than special-cased so
#: "always open" and "open 22:00-00:00" are read by exactly the same code.
WHOLE_DAY = (0, 1440)


class FeatureSchedule(Base):
    __tablename__ = "feature_schedules"

    id: Mapped[int] = mapped_column(primary_key=True)
    feature: Mapped[str] = mapped_column(String(32), unique=True)

    #: The admin's master switch, separate from the window. It exists so a
    #: feature can be built in full and held shut until the community is
    #: large enough — the owner's plan — and so we can test it before
    #: anyone else sees it.
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)

    #: Minutes past midnight, on the viewer's own clock. opens == closes
    #: would be an empty window, so the whole day is 0..1440 rather than
    #: 0..0. A window that wraps past midnight (22:00 to 02:00) is written
    #: with closes < opens and read as two pieces; see is_open_at.
    opens_at_minute: Mapped[int] = mapped_column(Integer, default=0)
    closes_at_minute: Mapped[int] = mapped_column(Integer, default=1440)

    #: Open all day, whatever the window says. A switch of its own rather
    #: than setting the window to 0..1440, so turning it off brings back
    #: the hours that were set before instead of losing them (section 32).
    always_open: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")

    #: How many times a day one person may use this feature, and whether
    #: that number applies at all.
    #:
    #: Two columns rather than "null means unlimited", because the panel
    #: has a tick box that greys out the number: with a single nullable
    #: column, ticking it would throw the number away and whoever comes
    #: back next month would have to remember what it used to be.
    daily_quota: Mapped[int] = mapped_column(Integer, default=10)
    daily_quota_unlimited: Mapped[bool] = mapped_column(Boolean, default=True)

    #: How many seconds two people found for each other are held while
    #: they decide (section 32). Long enough to read a line and a few
    #: interests while in the middle of something else; set in the panel.
    proposal_seconds: Mapped[int] = mapped_column(Integer, default=30, server_default="30")

    #: Whether the waiting screen shows how many are here and searching.
    #: On to begin with; the owner turns it off from the panel if small
    #: numbers make the place feel empty (section 32).
    show_counts: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")

    #: Ask "eighteen or over" the first time somebody opens Echo (section
    #: 32): Echo is where strangers meet, so that is where it is asked,
    #: once. On to begin with; the owner can turn it off in the panel.
    ask_adult: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")

    @property
    def effective_daily_quota(self) -> int | None:
        """The cap that actually applies, or None for unlimited."""
        return None if self.daily_quota_unlimited else self.daily_quota

    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime, default=utcnow, onupdate=utcnow
    )

    __table_args__ = (
        CheckConstraint(
            "opens_at_minute BETWEEN 0 AND 1440 AND closes_at_minute BETWEEN 0 AND 1440",
            name="ck_feature_schedule_minutes",
        ),
    )

    def is_open_at(self, local_minute: int) -> bool:
        """Whether the window covers this minute of the viewer's own day.

        `local_minute` is minutes past midnight where the VIEWER is, which
        the caller works out from their device. Nothing here knows or
        stores a timezone.
        """
        if not self.enabled:
            return False
        if self.always_open:
            return True
        if self.opens_at_minute == self.closes_at_minute:
            return False
        if self.opens_at_minute < self.closes_at_minute:
            return self.opens_at_minute <= local_minute < self.closes_at_minute
        # Wraps past midnight: 22:00 to 02:00 is "after 22:00" or "before 02:00".
        return local_minute >= self.opens_at_minute or local_minute < self.closes_at_minute

    def minutes_until_close(self, local_minute: int) -> int | None:
        """How long until it shuts, or None when it is shut or open all day.

        Sent so the app can change the Echo door at the right minute by
        itself, rather than asking the server every minute whether it has.
        """
        if not self.is_open_at(local_minute) or self.always_open:
            return None
        return (self.closes_at_minute - local_minute) % 1440 or 1440

    def minutes_until_open(self, local_minute: int) -> int | None:
        """How long until it opens, or None when it is open or switched off.

        This is what the countdown is built from, and the countdown is not
        decoration: an event nobody knows is coming brings nobody back, so
        the whole day's worth of "4 hours until it opens" is where the
        return visit actually comes from.
        """
        if not self.enabled or self.is_open_at(local_minute):
            return None
        return (self.opens_at_minute - local_minute) % 1440
