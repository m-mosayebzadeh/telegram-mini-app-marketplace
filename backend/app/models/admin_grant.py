"""
AdminGrant: narrow, per-person admin access for someone who isn't the
one true owner (see app/core/config.py's owner_telegram_id) — e.g. an
accountant who should only be able to review wallet top-up requests,
not do everything an owner can. Deliberately a list of scope strings
per person, not a fixed set of predefined roles ("admin"/"support"/...)
— see TECHNICAL_REQUIREMENTS.md's phase-2 note: "دسترسی‌های تکی برای
افراد دیگر... به‌صورت مجزا و per-person، نه نقش‌های از‌پیش‌تعریف‌شده."

Only the owner can create or delete a row here — see
app/admin/router.py — so the set of people with any admin access at all
is always something the real owner explicitly and auditably decided.
"""

from datetime import datetime

from sqlalchemy import JSON, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.time import UTCDateTime, utcnow


class AdminGrant(Base):
    __tablename__ = "admin_grants"

    id: Mapped[int] = mapped_column(primary_key=True)

    # unique=True: one grant row per user, holding their whole scope
    # list — not one row per (user, scope) pair. Simpler to read and
    # update ("this person's access is exactly this list").
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), unique=True)

    # e.g. ["finance.topups"] — checked by app/auth/dependencies.py's
    # require_admin(scope). New scope strings can be introduced later
    # (dispute resolution, user management, ...) without a migration,
    # since this is just a JSON list, not a fixed column per permission.
    scopes: Mapped[list[str]] = mapped_column(JSON, default=list)

    granted_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
