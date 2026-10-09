"""
What the app counts about itself (TECHNICAL_REQUIREMENTS.md section 43,
"analytics"). The owner's rule: counts of things that happened, never what
anybody said — no message text, no names, nothing typed — kept on our own
server rather than handed to an outside analytics service.

Most numbers need nothing new: they are counted from the tables that
already exist (people, messages, friendships, Echo, reports, blocks). Two
small tables hold what nothing else records:

- ActiveDay: one row per person per day they used the app — what "came
  back the next day / the next week" is counted from. Written at most once
  a day per person, alongside the "last seen" the server already keeps.
- AppEvent: a handful of named events: steps of signing in (where people
  give up), how long the app took to open, errors, the world's frame rate,
  notifications sent and opened. Each is a name, an optional number and an
  optional short word from a fixed vocabulary — never free text.
"""

from datetime import date, datetime

from sqlalchemy import BigInteger, Date, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.time import UTCDateTime, utcnow


class ActiveDay(Base):
    __tablename__ = "active_days"

    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), primary_key=True)
    #: The day in UTC.
    day: Mapped[date] = mapped_column(Date, primary_key=True)

    __table_args__ = (Index("ix_active_days_day", "day"),)


class AppEvent(Base):
    __tablename__ = "app_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    #: One of app/analytics/events.py's EVENTS.
    name: Mapped[str] = mapped_column(String(32))
    #: Absent for events from somebody not signed in yet (signing in).
    user_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=True)
    at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    #: A number when the event has one: milliseconds, frames per second.
    value: Mapped[int | None] = mapped_column(Integer, nullable=True)
    #: A short word from a fixed vocabulary: which step, which way in.
    detail: Mapped[str | None] = mapped_column(String(32), nullable=True)

    __table_args__ = (Index("ix_app_events_name_at", "name", "at"),)
