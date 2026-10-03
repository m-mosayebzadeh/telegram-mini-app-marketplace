"""
The note of the day (section 32, step 4): the owner's choice in place of a
bio. A bio is written once and forgotten; a note says how somebody is
today, like Instagram's notes, and lasts a day.

When somebody taps a body in the world, or an Echo card comes up, the note
is what they read, with the hour it was written in small letters under it.
No note, nothing in its place: just the name (the owner's decision —
nothing invented to fill the gap).

A day after it was written the note is erased from the database, not only
hidden (the owner's decision). The server's heartbeat sweeps once an hour
(app/live/pulse.py); until the sweep comes round, `fresh_note` already
treats an old note as gone, so nobody ever sees one older than a day.
"""

from datetime import datetime, timedelta

from sqlalchemy import update

from app.core.time import utcnow
from app.models.profile import Profile

#: How long a note lasts.
NOTE_LIFETIME = timedelta(hours=24)

#: A note is a line, not a paragraph (Instagram's is 60 as well).
MAX_NOTE = 60


def fresh_note(profile: Profile | None, *, now=None) -> str | None:
    """The note if it was written within the last day, otherwise None."""
    if profile is None or not profile.note or profile.note_at is None:
        return None
    if (now or utcnow()) - profile.note_at > NOTE_LIFETIME:
        return None
    return profile.note


def fresh_note_at(profile: Profile | None, *, now=None) -> datetime | None:
    """When the note was written, if it is still fresh; otherwise None. Sent
    beside the note so the app can say "written at nine" under it."""
    return profile.note_at if fresh_note(profile, now=now) is not None else None


def erase_faded_notes(db, *, now=None) -> int:
    """Erases every note older than a day, in one statement that only
    touches rows with a note (the partial index ix_profiles_note_at).
    Returns how many were erased."""
    cutoff = (now or utcnow()) - NOTE_LIFETIME
    result = db.execute(
        update(Profile)
        .where(Profile.note_at.is_not(None), Profile.note_at < cutoff)
        .values(note=None, note_at=None)
    )
    db.commit()
    return result.rowcount or 0
