"""
The application's own User table — separate from Telegram's `TelegramUser`.

`TelegramUser` (in app/auth/telegram.py) is a short-lived object built
fresh from a single verified initData string. `User` here is the
persistent record we store in our own database and keep working with for
everything else in the app (offers, requests, chat sessions, ...).
"""

import enum
from datetime import datetime

from sqlalchemy import BigInteger, Enum, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.core.time import UTCDateTime, utcnow


class UserStatus(str, enum.Enum):
    """Matches TECHNICAL_REQUIREMENTS.md: a user is either active or blocked."""

    ACTIVE = "active"
    BLOCKED = "blocked"


class User(Base):
    __tablename__ = "users"

    # Our own internal primary key. This is what other tables (offers,
    # requests, ...) will reference later — never the Telegram id directly.
    id: Mapped[int] = mapped_column(primary_key=True)

    # Telegram's user id. This is the real identity anchor: it never
    # changes, and every future "who is this request from?" lookup goes
    # through this column. unique=True + index=True makes lookups by
    # telegram_id fast and guarantees two rows can never claim the same
    # Telegram account.
    #
    # BigInteger (not a plain Integer) because Telegram user ids can be
    # larger than a 32-bit integer can hold.
    telegram_id: Mapped[int] = mapped_column(BigInteger, unique=True, index=True)

    # Display-only info, per TECHNICAL_REQUIREMENTS.md: NOT identity, just
    # what's shown in the UI. Pre-filled from Telegram on first login (see
    # app/auth/dependencies.py), but the user may change these later
    # inside the app, independent of their real Telegram profile.
    #
    # Kept as two separate fields (not one combined "display name")
    # because how they're JOINED for display depends on which script the
    # name is written in — see the display_name property below — and a
    # single pre-joined string can't be un-joined later to redo that.
    first_name: Mapped[str] = mapped_column(String(128))
    last_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    # Pre-filled from Telegram on first login, but the user can change it
    # afterward inside the app (see PUT /me/username in app/main.py) —
    # independent of their real Telegram @username from then on. Must be
    # unique across the whole app once set (enforced by unique=True below
    # AND re-checked in the endpoint for a clean 400 instead of a raw
    # IntegrityError); nullable so "never set one" stays a valid state,
    # and unique=True still allows any number of NULLs (SQLite/Postgres
    # both treat NULL as distinct from every other NULL for uniqueness).
    username: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)

    joined_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    status: Mapped[UserStatus] = mapped_column(
        # values_callable: store "active"/"blocked" (the enum's values)
        # instead of SQLAlchemy's default of "ACTIVE"/"BLOCKED" (the
        # member names) — keeps the raw database consistent with what
        # the API actually returns (see main.py's current_user.status.value).
        Enum(UserStatus, values_callable=lambda enum_cls: [e.value for e in enum_cls]),
        default=UserStatus.ACTIVE,
    )

    # When this user last opened their own "my offers" list (Activity
    # tab's Offers segment) — NULL means "never". Powers the per-offer
    # request_count "new since you last looked" badge (see
    # app/offer/router.py's list_offers): a provider's own-offers view
    # both reads this (to decide what counts as new) and updates it to
    # "now" in the same call, so simply opening that screen is what
    # clears the badge — no separate "mark as read" action needed.
    requests_last_viewed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)

    # uselist=False is what tells SQLAlchemy "this side of the
    # relationship is a single object, not a list" — i.e. `user.profile`
    # instead of `user.profiles`. The actual one-to-one *constraint*
    # still lives on the Profile side (its user_id column is unique).
    profile: Mapped["Profile | None"] = relationship(
        back_populates="user", uselist=False
    )

    @property
    def display_name(self) -> str:
        """
        first_name and last_name, joined the way TECHNICAL_REQUIREMENTS.md
        describes — first_name, then a space, then last_name if there is
        one. This is script-agnostic on purpose: WHICH SIDE each part
        visually ends up on (a Persian name reading right-to-left, a
        Latin one left-to-right) is a rendering concern, not something
        baked into the stored string — the frontend gets this exact text
        and renders it with `dir="auto"`, letting the browser's own bidi
        algorithm pick the right direction from the name's own first
        strong character, regardless of the app's current UI language.
        Kept as a read-only property (not a stored column) so every
        existing `.display_name` read across the codebase keeps working
        unchanged after first_name/last_name replaced the old single
        column.
        """
        return f"{self.first_name} {self.last_name}" if self.last_name else self.first_name

    def __repr__(self) -> str:
        return (
            f"User(id={self.id}, telegram_id={self.telegram_id}, "
            f"display_name={self.display_name!r})"
        )
