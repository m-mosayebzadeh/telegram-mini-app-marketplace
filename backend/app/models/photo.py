"""
Photo: one image belonging to a profile.

Three ideas mapped straight from TECHNICAL_REQUIREMENTS.md's "عکس پروفایل"
entity:
  1. `original_file_path` and `blurred_file_path` are TWO SEPARATE files.
     Blur must never be a display-side effect on the real image — the
     server decides which file to hand back, based on an access check, so
     the unblurred bytes never reach a viewer who isn't allowed to see them.
  2. Paid photos are always blurred (enforced below with a CHECK
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
from sqlalchemy.orm import Mapped, mapped_column

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

    # Where the two versions of the image are stored. A plain string for
    # now (a local file path); once we pick real file/object storage,
    # this becomes a key/URL instead — the rest of the model doesn't
    # change either way.
    original_file_path: Mapped[str] = mapped_column(String(500))
    blurred_file_path: Mapped[str] = mapped_column(String(500))

    is_paid: Mapped[bool] = mapped_column(Boolean, default=False)
    # Only meaningful when is_paid is True. Stars amount; actual payment
    # wiring is deferred (see TECHNICAL_REQUIREMENTS.md, section 7).
    price_stars: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Whether the owner wants this photo blurred at all. Forced to True
    # whenever is_paid is True (see the CHECK constraint below) — for a
    # free photo, it's the owner's choice.
    is_blurred: Mapped[bool] = mapped_column(Boolean, default=False)

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

    __table_args__ = (
        # A paid photo must be blurred. Written as "NOT is_paid OR
        # is_blurred" — i.e. "if is_paid then is_blurred" — rather than
        # forbidding the other three combinations one by one.
        CheckConstraint("NOT is_paid OR is_blurred", name="ck_paid_implies_blurred"),
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
