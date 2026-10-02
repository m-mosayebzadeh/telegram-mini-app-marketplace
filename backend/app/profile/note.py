"""
The note of the day (section 32, step 4): the owner's choice in place of a
bio. A bio is written once and forgotten; a note says how somebody is
today, like Instagram's notes, and lasts a day.

When somebody taps a body in the world, or an Echo card comes up, the note
is what they read. No note, nothing in its place: just the name (the
owner's decision — nothing invented to fill the gap).
"""

from datetime import timedelta

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
