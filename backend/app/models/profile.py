"""
Profile: the public-facing "page" for a user (bio, avatar, photos).

One-to-one with User: every user has at most one profile, and every
profile belongs to exactly one user. The `unique=True` on user_id below
is what actually enforces the "one-to-one" part — without it, this would
be a regular one-to-many relationship (one user could have many profiles).
"""

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Profile(Base):
    __tablename__ = "profiles"

    id: Mapped[int] = mapped_column(primary_key=True)

    # ForeignKey("users.id") points at the *table* name ("users"), not the
    # Python class — that's just how SQLAlchemy's FK syntax works.
    # unique=True is what makes this one-to-one instead of one-to-many.
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), unique=True)

    avatar_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    bio: Mapped[str | None] = mapped_column(String(1000), nullable=True)

    # `relationship()` doesn't create a database column — it's a
    # convenience so Python code can write `profile.user` (or, from the
    # User side, `user.profile`) and get the related object loaded
    # automatically, instead of writing a manual query every time.
    user: Mapped["User"] = relationship(back_populates="profile")
