"""
Notifications when the app is closed (TECHNICAL_REQUIREMENTS.md section 38).

A browser that agreed to notifications hands the app an address at its own
push service (Google's for Chrome, Mozilla's, Apple's) and two keys; the
app keeps them here. To notify, the server sends one short, encrypted
message to that address, and the browser shows it — even with the app
closed. Nothing is asked on a clock: one message per thing that happened,
to the people it happened to.

Tied to the sign-in session that subscribed: a device signed out, or
closed from another device, stops being notified — its subscriptions are
dropped the next time anything would have been sent to them.
"""

from datetime import datetime

from sqlalchemy import BigInteger, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.time import UTCDateTime, utcnow


class PushSubscription(Base):
    __tablename__ = "push_subscriptions"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), index=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("auth_sessions.id"), index=True)
    #: The browser's address at its push service; one per browser.
    endpoint: Mapped[str] = mapped_column(String(1000), unique=True)
    #: The browser's keys, which encrypt every message so only it can read it.
    p256dh: Mapped[str] = mapped_column(String(200))
    auth: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
