"""
AdminGrant: one (user, role) assignment — a user can hold any number of
roles at once (see app/models/role.py), each contributing its own
scopes to that user's effective admin access (the union of every ACTIVE
role they hold — see app/auth/dependencies.py's _effective_admin_scopes).

Only the owner can create or delete a row here — see
app/admin/router.py — so the set of people with any admin access at all
is always something the real owner explicitly and auditably decided.
"""

from datetime import datetime

from sqlalchemy import ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.time import UTCDateTime, utcnow


class AdminGrant(Base):
    __tablename__ = "admin_grants"

    id: Mapped[int] = mapped_column(primary_key=True)

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    role_id: Mapped[int] = mapped_column(ForeignKey("roles.id"))

    granted_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    __table_args__ = (
        # The same role can't be assigned twice to the same person —
        # re-assigning an already-held role is just a no-op, not a
        # second row (see app/admin/router.py's assign_role).
        UniqueConstraint("user_id", "role_id", name="uq_admin_grant_user_role"),
    )
