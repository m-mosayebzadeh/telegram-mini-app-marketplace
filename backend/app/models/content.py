"""
Content: one photo or short video belonging to a user directly (not via
Profile — see the conversation that led here: Profile is optional, so
routing content through it would mean nobody could post before creating
one, exactly the problem we already fixed for Offer).

Ideas carried over unchanged from when this was called "Photo":
  1. There is only ONE stored file per item (original_file_path) — no
     separate blurred copy. A "spoiler" is a generic overlay the
     frontend draws (no derived image for it); the real bytes are only
     ever sent after the same server-side access check used everywhere
     else in this file.
  2. Paid content always has a spoiler (CHECK constraint, not just
     application code).
  3. Its audience is EXACTLY ONE of: public, followers, a single user,
     or a single group (also a CHECK constraint).

New for "Content" (vs. the old "Photo"):
  - content_type: PHOTO or SHORT_VIDEO.
  - duration_seconds: required for a video, forbidden for a photo — same
    CHECK-enforced pairing pattern as everything else here. This is
    client-reported, not measured server-side (see app/content/router.py
    for why that's an acceptable tradeoff for a policy limit like this,
    as opposed to something security-sensitine like the spoiler check).
  - is_pinned: up to 3 per user, enforced in application code (see
    app/content/router.py), the same way MAX_ACTIVE_OFFERS_PER_USER is.
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

# A policy limit (not a hard technical one) on how long a short video can
# be — see app/content/router.py's validation.
MAX_VIDEO_DURATION_SECONDS = 60
# Likewise a policy limit on upload size, enforced in app/content/router.py.
MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB


class ContentType(str, enum.Enum):
    PHOTO = "photo"
    SHORT_VIDEO = "short_video"


class ContentAudience(str, enum.Enum):
    PUBLIC = "public"
    FOLLOWERS = "followers"
    USER = "user"
    GROUP = "group"


class Content(Base):
    __tablename__ = "contents"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))

    content_type: Mapped[ContentType] = mapped_column(
        Enum(ContentType, values_callable=lambda enum_cls: [e.value for e in enum_cls]),
    )
    # Only meaningful (and only non-NULL) for SHORT_VIDEO — see the CHECK
    # constraint below. Client-reported at upload time, capped at
    # MAX_VIDEO_DURATION_SECONDS.
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)

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

    # Whether this item is shown behind a spoiler overlay by default.
    # Forced to True whenever is_paid is True (see the CHECK constraint
    # below) — for free content, it's the owner's choice, e.g. a
    # curiosity-inducing teaser that costs nothing but still needs an
    # intentional tap to reveal.
    has_spoiler: Mapped[bool] = mapped_column(Boolean, default=False)

    audience_type: Mapped[ContentAudience] = mapped_column(
        Enum(ContentAudience, values_callable=lambda enum_cls: [e.value for e in enum_cls]),
        default=ContentAudience.PUBLIC,
    )
    # Exactly one of these two is set, and only when audience_type
    # actually calls for it — enforced below, not just by convention.
    audience_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    audience_group_id: Mapped[int | None] = mapped_column(
        ForeignKey("audience_groups.id"), nullable=True
    )

    # Up to 3 per user (see app/content/router.py) — pinned items show
    # first on the profile's content grid, ahead of the normal
    # chronological order.
    is_pinned: Mapped[bool] = mapped_column(Boolean, default=False)

    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    __table_args__ = (
        # A paid item must have a spoiler. Written as "NOT is_paid OR
        # has_spoiler" — i.e. "if is_paid then has_spoiler" — rather than
        # forbidding the other three combinations one by one.
        CheckConstraint("NOT is_paid OR has_spoiler", name="ck_paid_implies_spoiler"),
        # Price only makes sense together with is_paid.
        CheckConstraint(
            "(is_paid AND price_stars IS NOT NULL) OR "
            "(NOT is_paid AND price_stars IS NULL)",
            name="ck_price_matches_is_paid",
        ),
        # duration_seconds only makes sense for a video, and must fit
        # the policy limit — this second half could in principle be left
        # to application code alone, but putting it here too means even
        # a future bug in the router can't insert an oversized value.
        CheckConstraint(
            "(content_type = 'short_video' AND duration_seconds IS NOT NULL "
            " AND duration_seconds > 0 AND duration_seconds <= "
            f"{MAX_VIDEO_DURATION_SECONDS}) OR "
            "(content_type = 'photo' AND duration_seconds IS NULL)",
            name="ck_duration_matches_content_type",
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
