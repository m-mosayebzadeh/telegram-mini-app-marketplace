"""
Regression test for a real bug: on SQLite, a timezone-aware DateTime
column silently comes back with tzinfo stripped after a round trip
through the database, even though it was written as UTC-aware. This
made timestamps in API responses look like unlabeled local time instead
of UTC. UTCDateTime (app/core/time.py) re-attaches the UTC label on read.
"""

from datetime import timezone

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.core.database import Base
from app.models.user import User


def test_joined_at_round_trips_as_timezone_aware_utc():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(bind=engine)

    with Session(engine) as db:
        user = User(telegram_id=1, display_name="test")
        db.add(user)
        db.commit()
        db.refresh(user)  # forces a real read back from the database

        assert user.joined_at.tzinfo is not None
        assert user.joined_at.utcoffset() == timezone.utc.utcoffset(None)
        # This is exactly what a client reads from the API response, so
        # it must be unambiguous, not just "correct in Python."
        assert user.joined_at.isoformat().endswith("+00:00")
