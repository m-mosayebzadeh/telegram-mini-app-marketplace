"""
Profile: the public-facing "page" for a user (bio, avatar, location,
interests).

One-to-one with User: every user has at most one profile, and every
profile belongs to exactly one user. The `unique=True` on user_id below
is what actually enforces the "one-to-one" part — without it, this would
be a regular one-to-many relationship (one user could have many profiles).
"""

from sqlalchemy import JSON, Boolean, CheckConstraint, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

# A simple cap so "interests" can't turn into an unbounded free-for-all —
# enforced in app/profile/router.py, not the database (JSON columns can't
# carry a CHECK on list length the way a plain column can).
MAX_INTERESTS = 10


class Profile(Base):
    __tablename__ = "profiles"

    id: Mapped[int] = mapped_column(primary_key=True)

    # ForeignKey("users.id") points at the *table* name ("users"), not the
    # Python class — that's just how SQLAlchemy's FK syntax works.
    # unique=True is what makes this one-to-one instead of one-to-many.
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), unique=True)

    # No avatar_url column anymore — see app/models/profile_photo.py.
    # A user can have any number of photos now; wherever a single
    # "current avatar" url is needed, app/profile/photos.py's
    # get_current_avatar_url() computes it from the newest ProfilePhoto
    # row instead of reading a stored column here.
    bio: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    location: Mapped[str | None] = mapped_column(String(200), nullable=True)

    # A JSON column (works the same on SQLite and Postgres) holding a
    # plain list of short tag strings, e.g. ["Music", "Travel"]. No
    # separate table: nothing yet needs to query "everyone interested in
    # X" — see TECHNICAL_REQUIREMENTS.md, this is for future
    # discovery/recommendation, not built now.
    interests: Mapped[list[str]] = mapped_column(JSON, default=list)

    # The "پروفایل معتبر" (verified/trusted profile) badge from the
    # design pass — deliberately NOT part of ProfileUpdate (see
    # app/profile/schemas.py and app/profile/router.py): a user can't
    # grant this to themselves. For now it's only ever set by the demo
    # seed script (backend/scripts/seed_demo_profile.py); a real
    # verification flow is a later phase. The frontend shows nothing at
    # all when this is False — never an empty placeholder badge.
    is_trusted: Mapped[bool] = mapped_column(Boolean, default=False)

    # Birthday — Gregorian on the wire; the frontend converts to the
    # Jalali calendar for display/editing since that's the app's default
    # locale (see frontend/src/lib/jalali.ts). month/day are both-or-
    # neither (per the CHECK constraint below); year is independently
    # optional even when month/day ARE set — matching Telegram's own
    # "set birthdate" screen, which lets year be left as "—" while still
    # showing month/day. (An earlier pass deliberately left year out
    # entirely; revisited and reversed per explicit product decision —
    # see the conversation that led here.)
    birthday_month: Mapped[int | None] = mapped_column(Integer, nullable=True)
    birthday_day: Mapped[int | None] = mapped_column(Integer, nullable=True)
    birthday_year: Mapped[int | None] = mapped_column(Integer, nullable=True)

    __table_args__ = (
        CheckConstraint(
            "(birthday_month IS NULL AND birthday_day IS NULL AND birthday_year IS NULL) OR "
            "(birthday_month BETWEEN 1 AND 12 AND birthday_day BETWEEN 1 AND 31 "
            " AND (birthday_year IS NULL OR birthday_year BETWEEN 1900 AND 2100))",
            name="ck_birthday_both_or_neither",
        ),
    )

    # `relationship()` doesn't create a database column — it's a
    # convenience so Python code can write `profile.user` (or, from the
    # User side, `user.profile`) and get the related object loaded
    # automatically, instead of writing a manual query every time.
    user: Mapped["User"] = relationship(back_populates="profile")
