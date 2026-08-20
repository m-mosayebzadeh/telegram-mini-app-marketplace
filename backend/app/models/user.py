"""
The application's own User table — separate from Telegram's `TelegramUser`.

`TelegramUser` (in app/auth/telegram.py) is a short-lived object built
fresh from a single verified initData string. `User` here is the
persistent record we store in our own database and keep working with for
everything else in the app (offers, requests, chat sessions, ...).
"""

import enum
from datetime import datetime, timezone

from sqlalchemy import BigInteger, DateTime, Enum, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


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
    # what's shown in the UI. Pre-filled from Telegram on first login, but
    # the user may change these later inside the app, independent of
    # their real Telegram profile.
    display_name: Mapped[str] = mapped_column(String(128))
    username: Mapped[str | None] = mapped_column(String(64), nullable=True)

    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )

    status: Mapped[UserStatus] = mapped_column(
        Enum(UserStatus),
        default=UserStatus.ACTIVE,
    )

    def __repr__(self) -> str:
        return (
            f"User(id={self.id}, telegram_id={self.telegram_id}, "
            f"display_name={self.display_name!r})"
        )
