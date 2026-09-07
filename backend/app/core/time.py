"""
Shared UTC time helpers, used by every model's timestamp columns.

Every timestamp in this app is stored in UTC — never the server's local
time — so values from anywhere in the world sort and compare correctly,
and clients are always responsible for converting to their own local
time zone for display.

SQLite (our local dev database) has no native timezone-aware datetime
type. SQLAlchemy's `DateTime(timezone=True)` still round-trips correctly
on Postgres (our production database, per TECHNICAL_REQUIREMENTS.md), but
on SQLite specifically, a value written as UTC-aware silently comes back
from a query with its tzinfo stripped — same real instant, just missing
the label that says "this is UTC". `UTCDateTime` below re-attaches that
label on the way out (and the way in, in case a naive value ever slips
through), so `some_row.created_at.isoformat()` always includes an
explicit "+00:00" and is never ambiguous, on either database.
"""

from datetime import datetime, timezone

from sqlalchemy import DateTime
from sqlalchemy.types import TypeDecorator


def utcnow() -> datetime:
    """The current time, always timezone-aware and in UTC."""
    return datetime.now(timezone.utc)


def start_of_utc_day(moment: datetime | None = None) -> datetime:
    """
    Midnight UTC of the day `moment` falls on (defaults to right now) —
    the fixed, once-a-day reset boundary used by the buyer's daily
    request quota (see app/request/router.py's
    MAX_DAILY_REQUESTS_PER_BUYER). Deliberately a fixed UTC clock
    moment, not each buyer's own local midnight: this app never collects
    a user's timezone, so there's no per-user boundary to use instead —
    everyone still gets exactly one reset every 24 hours, just at a
    different point in their own local day (the frontend renders this
    same instant in the viewer's own local time, so it reads correctly
    for them regardless).
    """
    moment = moment or utcnow()
    return moment.replace(hour=0, minute=0, second=0, microsecond=0)


class UTCDateTime(TypeDecorator):
    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect) -> datetime | None:
        """Python value -> database. Runs when saving."""
        if value is not None and value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value

    def process_result_value(self, value: datetime | None, dialect) -> datetime | None:
        """Database value -> Python. Runs when loading (this is the fix)."""
        if value is not None and value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value
