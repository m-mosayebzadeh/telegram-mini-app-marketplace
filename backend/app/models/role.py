"""
Role: a named, reusable bundle of admin permission scopes (e.g.
"Support" -> ["finance.topups"]) — replaces the earlier design where
each AdminGrant row carried its own flat scope list directly. A user
can now hold any number of roles at once (see AdminGrant, which is now
a per (user, role) assignment row instead of one row per user).

is_active is a soft on/off switch: deactivating a role strips its
scopes from everyone holding it WITHOUT deleting the assignment rows
themselves — reactivating it later restores everyone's access without
having to reassign anyone. Deleting a role is the permanent version:
the role row and every assignment to it are gone for good (see
app/admin/router.py's delete_role).
"""

from datetime import datetime

from sqlalchemy import JSON, Boolean, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.time import UTCDateTime, utcnow


class Role(Base):
    __tablename__ = "roles"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(64), unique=True)

    # e.g. ["finance.topups"] — same free-form scope-string design the
    # old per-user AdminGrant.scopes used, just attached to a reusable
    # role now instead of copy-pasted per person. Checked by
    # app/auth/dependencies.py's require_admin(scope).
    scopes: Mapped[list[str]] = mapped_column(JSON, default=list)

    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
