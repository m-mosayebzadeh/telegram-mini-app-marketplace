"""
Signing in: the ways a person can prove who they are, and the sessions that
proving gives them (TECHNICAL_REQUIREMENTS.md section 32, "signing in
without Telegram").

Every way in — Google, a phone number, Telegram through our bot, another
phone already signed in — ends the same way: a session of our own. From
then on the app knows the person by that session alone, never by the way
they came in. That is what keeps Telegram (or any one provider) from being
the identity of the product: it is only one door.

- `AuthIdentity` — one door one person has: "Google account X", "phone
  +98…", "Telegram user N". The same person may have several; one door
  never leads to two people.
- `AuthSession` — one signed-in device. The browser holds only a random
  token in a secure cookie the page itself cannot read; the database holds
  only a hash of it, so even a copy of the database lets nobody in. A
  session lasts ninety days from its last use (the owner's decision) and
  can be closed from any other device.
"""

from datetime import datetime

from sqlalchemy import ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.time import UTCDateTime, utcnow

#: The doors. Kept as plain words so the list can grow without a migration.
PROVIDER_TELEGRAM = "telegram"
PROVIDER_GOOGLE = "google"
PROVIDER_PHONE = "phone"
#: Signed in by scanning a code with a phone that was already signed in.
PROVIDER_DEVICE = "device"
#: Local development only (app/dev/router.py).
PROVIDER_DEV = "dev"


class AuthIdentity(Base):
    __tablename__ = "auth_identities"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    provider: Mapped[str] = mapped_column(String(16))
    #: Who they are at that door: Google's account id, a phone number in
    #: international form, a Telegram user id.
    subject: Mapped[str] = mapped_column(String(128))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    __table_args__ = (UniqueConstraint("provider", "subject", name="uq_auth_identity_door"),)


class AuthSession(Base):
    __tablename__ = "auth_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    #: SHA-256 of the token in the cookie. The token itself is never stored.
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    #: Which door this session came through, shown in the list of sessions.
    provider: Mapped[str] = mapped_column(String(16))
    #: A short name for the device, read from the browser ("Chrome on
    #: Windows"), so a person can recognise their own sessions.
    device: Mapped[str] = mapped_column(String(80), default="")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    last_used_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    #: Set when the person signs out or closes it from another device.
    revoked_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)

    __table_args__ = (Index("ix_auth_sessions_user_open", "user_id", "revoked_at"),)


class DeviceSignInRequest(Base):
    """A new device asking to be signed in by a phone already signed in
    (section 32, "sign in with another phone").

    The new device shows a code (as a picture to scan, and as letters to
    type); somebody signed in on their phone approves it, seeing which
    device is asking. Only the device that asked can then collect the
    session: it alone holds the secret, which is never in the code. A
    request lives two minutes and is used once.
    """

    __tablename__ = "auth_device_requests"

    id: Mapped[int] = mapped_column(primary_key=True)
    #: What the new device shows; short enough to type.
    code: Mapped[str] = mapped_column(String(12), unique=True)
    #: SHA-256 of the secret only the asking device holds.
    secret_hash: Mapped[str] = mapped_column(String(64))
    #: The asking device's name, shown to whoever approves.
    device: Mapped[str] = mapped_column(String(80), default="")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime)
    approved_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    refused_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    claimed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
