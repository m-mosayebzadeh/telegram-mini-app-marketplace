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

from sqlalchemy import BigInteger, ForeignKey, Index, String, UniqueConstraint
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
    #: What the person sees in "Settings -> ways in" to recognise this door:
    #: the Google address half hidden ("m.mo***h@gmail.com"), the Telegram
    #: @username or name. Never the whole address (section 36): enough to
    #: tell which account it is, and nothing worth stealing.
    label: Mapped[str | None] = mapped_column(String(128), nullable=True)
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
    #: When this session last proved, through one of the account's own
    #: ways in, that it is the owner (section 36). Changing the ways in
    #: needs that to be recent: somebody who only has the session — a phone
    #: left open — must not be able to swap them and keep the account.
    confirmed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    #: A trip to Google started from inside the account (to confirm, or to
    #: connect a Google account): the hash of its `state`, and what it is
    #: for. Google posts the answer back from its own site, where this
    #: session's cookie is not sent, so the answer finds its session by this.
    google_state_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    google_purpose: Mapped[str | None] = mapped_column(String(8), nullable=True)

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
    #: When a signed-in phone opened the request (scanned or typed), so the
    #: asking device can say "now confirm it on your phone".
    seen_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    approved_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    refused_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    claimed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)


#: What a request through the bot is for: signing in, or — from inside the
#: account (section 36) — confirming it is the owner, or connecting a
#: Telegram account to this account.
PURPOSE_SIGN_IN = "sign_in"
PURPOSE_CONFIRM = "confirm"
PURPOSE_LINK = "link"


class BotSignInRequest(Base):
    """Signing in through our Telegram bot (section 32).

    The sign-in page asks for one of these and opens the bot with its code
    ("t.me/<bot>?start=<code>"). Tapping Start hands the code to the bot,
    which notes who tapped it (`seen_at` and the Telegram account) and asks
    them, naming the device, whether it is really them signing in. Only on
    "yes" from that same account (`approved_at`) can the asking page collect
    a session, with the secret only it holds. Without that question,
    somebody could send you their link, and your tap on Start would sign
    THEM in to your account.

    The same states, under the same names, as DeviceSignInRequest, so both
    are read the same way.
    """

    __tablename__ = "auth_bot_requests"

    id: Mapped[int] = mapped_column(primary_key=True)
    #: Goes in the bot link; Telegram allows letters, digits, _ and - only.
    code: Mapped[str] = mapped_column(String(32), unique=True)
    secret_hash: Mapped[str] = mapped_column(String(64))
    #: The asking device's name, shown in the bot's question.
    device: Mapped[str] = mapped_column(String(80), default="")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime)
    #: When somebody tapped Start with this code, and who they are on Telegram.
    seen_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    telegram_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    first_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    last_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    username: Mapped[str | None] = mapped_column(String(64), nullable=True)
    #: PURPOSE_SIGN_IN, or for a signed-in person PURPOSE_CONFIRM / PURPOSE_LINK.
    purpose: Mapped[str] = mapped_column(String(8), default=PURPOSE_SIGN_IN)
    #: Who asked, for confirming or connecting: only they may collect it.
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    #: Why it was refused when the bot refused it on its own, for the page
    #: to say: "not_yours" (not this account's Telegram), "taken" (that
    #: Telegram belongs to another account).
    problem: Mapped[str | None] = mapped_column(String(16), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    refused_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    claimed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
