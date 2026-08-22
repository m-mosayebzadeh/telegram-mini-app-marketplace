"""
Photo: one image belonging to a profile.

Ideas mapped straight from TECHNICAL_REQUIREMENTS.md's "عکس پروفایل" entity:
  1. There is only ONE stored file per photo (original_file_path) — no
     separate blurred copy. A "spoiler" photo shows a generic overlay in
     the UI (a frontend concern, no per-photo image derived for it); the
     real bytes are only ever sent after the same server-side access
     check used everywhere else in this file, exactly like before.
  2. Paid photos always have a spoiler (enforced below with a CHECK
     constraint, not just application code).
  3. A photo's audience is EXACTLY ONE of: public, followers, a single
     user, or a single group — also enforced with a CHECK constraint.
"""

import enum
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Enum,
    ForeignKey,
    Integer,
    String,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.core.time import UTCDateTime, utcnow


class PhotoAudience(str, enum.Enum):
    PUBLIC = "public"
    FOLLOWERS = "followers"
    USER = "user"
    GROUP = "group"


class Photo(Base):
    __tablename__ = "photos"

    id: Mapped[int] = mapped_column(primary_key=True)
    profile_id: Mapped[int] = mapped_column(ForeignKey("profiles.id"))

    # A plain string for now (a local file path); once we pick real
    # file/object storage, this becomes a key/URL instead — the rest of
    # the model doesn't change either way. Never exposed through the
    # API — clients only ever get an `id` and fetch bytes through an
    # access-checked route.
    original_file_path: Mapped[str] = mapped_column(String(500))

    is_paid: Mapped[bool] = mapped_column(Boolean, default=False)
    # Only meaningful when is_paid is True. Stars amount; actual payment
    # wiring is deferred (see TECHNICAL_REQUIREMENTS.md, section 7).
    price_stars: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Whether this photo is shown behind a spoiler overlay by default.
    # Forced to True whenever is_paid is True (see the CHECK constraint
    # below) — for a free photo, it's the owner's choice, e.g. a
    # curiosity-inducing teaser that costs nothing but still needs an
    # intentional tap to reveal.
    has_spoiler: Mapped[bool] = mapped_column(Boolean, default=False)

    audience_type: Mapped[PhotoAudience] = mapped_column(
        # values_callable makes SQLAlchemy store each member's *value*
        # ("public", "followers", ...) instead of its *name* ("PUBLIC",
        # ...), which is its default. Without this, the CHECK constraint
        # below (which compares against lowercase strings) would never
        # match anything, since the default stores uppercase names.
        Enum(PhotoAudience, values_callable=lambda enum_cls: [e.value for e in enum_cls]),
        default=PhotoAudience.PUBLIC,
    )
    # Exactly one of these two is set, and only when audience_type
    # actually calls for it — enforced below, not just by convention.
    audience_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    audience_group_id: Mapped[int | None] = mapped_column(
        ForeignKey("audience_groups.id"), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    # Lets code write `photo.profile.user_id` (e.g. "who owns this
    # photo?") instead of a separate query every time it's needed.
    profile: Mapped["Profile"] = relationship()

    __table_args__ = (
        # A paid photo must have a spoiler. Written as "NOT is_paid OR
        # has_spoiler" — i.e. "if is_paid then has_spoiler" — rather than
        # forbidding the other three combinations one by one.
        CheckConstraint("NOT is_paid OR has_spoiler", name="ck_paid_implies_spoiler"),
        # Price only makes sense together with is_paid.
        CheckConstraint(
            "(is_paid AND price_stars IS NOT NULL) OR "
            "(NOT is_paid AND price_stars IS NULL)",
            name="ck_price_matches_is_paid",
        ),
        # The audience_type must agree with which target column (if any)
        # is filled in — a "user" audience needs audience_user_id and
        # nothing else; a "group" audience needs audience_group_id and
        # nothing else; public/followers need neither.
        CheckConstraint(
            "(audience_type IN ('public', 'followers') "
            " AND audience_user_id IS NULL AND audience_group_id IS NULL)"
            "OR (audience_type = 'user' "
            " AND audience_user_id IS NOT NULL AND audience_group_id IS NULL)"
            "OR (audience_type = 'group' "
            " AND audience_group_id IS NOT NULL AND audience_user_id IS NULL)",
            name="ck_audience_target_matches_type",
        ),
    )
