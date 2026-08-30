"""
Pydantic schemas for the profile endpoints — these describe the shape of
JSON going in and out of the API, separately from Profile (the database
model in app/models/profile.py). Keeping them separate means the API's
public shape doesn't have to change just because the database schema
does, and vice versa.
"""

from datetime import datetime

from pydantic import BaseModel, Field


class ProfileUpdate(BaseModel):
    """What a client sends to create or update their own profile."""

    bio: str | None = Field(default=None, max_length=1000)
    location: str | None = Field(default=None, max_length=200)
    # Length capped at MAX_INTERESTS (app/models/profile.py) — checked in
    # app/profile/router.py, since a JSON column can't carry a CHECK on
    # list length the way a plain column can.
    interests: list[str] = Field(default_factory=list)
    # See Profile.birthday_month's docstring (app/models/profile.py).
    # month/day are both-set-or-both-omitted; year is independently
    # optional. Cross-field checks enforced in app/profile/router.py (a
    # Pydantic Field can't cross-check sibling fields against a database
    # CHECK constraint directly).
    birthday_month: int | None = Field(default=None, ge=1, le=12)
    birthday_day: int | None = Field(default=None, ge=1, le=31)
    birthday_year: int | None = Field(default=None, ge=1900, le=2100)

    # Deliberately no is_trusted here — see Profile.is_trusted's
    # docstring. A profile owner can never set their own trust badge
    # through this endpoint.


class ProfilePhotoOut(BaseModel):
    """One row of GET /profiles/{user_id}/photos — the fullscreen
    gallery's swipe-through list (see app/models/profile_photo.py)."""

    id: int
    url: str
    created_at: datetime

    model_config = {"from_attributes": True}


class ProfileOut(BaseModel):
    """What we send back."""

    id: int
    avatar_url: str | None
    bio: str | None
    location: str | None
    interests: list[str]
    is_trusted: bool
    birthday_month: int | None
    birthday_day: int | None
    birthday_year: int | None

    # Lets FastAPI build this schema directly from a Profile ORM object
    # (profile.id, profile.avatar_url, ...) instead of requiring a plain
    # dict — without this, returning an ORM instance from a route would
    # raise a validation error.
    model_config = {"from_attributes": True}


class PublicProfileOut(BaseModel):
    """
    What GET /profiles/{user_id} sends back — for viewing ANYONE's
    profile, not just your own. Combines the display-only fields from
    User with the (possibly absent) Profile fields; never includes
    telegram_id (TECHNICAL_REQUIREMENTS.md, section 5).
    """

    user_id: int
    display_name: str
    username: str | None
    avatar_url: str | None
    bio: str | None
    location: str | None
    interests: list[str]
    is_trusted: bool
    birthday_month: int | None
    birthday_day: int | None
    birthday_year: int | None
    # Only counts ACCEPTED follows (see app/models/follow.py) — a
    # pending follow request isn't a real follower yet.
    followers_count: int
    following_count: int
    # The VIEWER's own relationship to this profile — "not_following" if
    # there's no Follow row from the current caller to this user at all,
    # otherwise that row's actual status. Always "not_following" when
    # viewing your own profile (you can't follow yourself). Lets the
    # frontend show the right button (Follow / Requested / Following)
    # without a second round trip.
    follow_status: str


class FollowListItemOut(BaseModel):
    """One row in a followers/following list (GET /follow/{user_id}/followers
    or /following) — a lighter version of PublicProfileOut with no bio or
    counts, since a list of many people doesn't need either."""

    user_id: int
    display_name: str
    username: str | None
    avatar_url: str | None


class ProviderSummaryOut(BaseModel):
    """
    GET /profiles/{user_id}/provider-summary — the provider-side mirror
    of "خلاصه اعتماد خریدار" (TECHNICAL_REQUIREMENTS.md section 2): what a
    prospective BUYER should be able to see about a provider before
    requesting their offer. Unlike the buyer version, most of this is
    already computable — see the doc for exactly which fields aren't yet
    (average rating, which needs the Rating entity — not built).
    """

    status: str  # "established" | "new"
    joined_at: datetime
    completed_services_count: int
    # None (not 0.0) when the provider has never received a single
    # request yet — "no data" is a different fact than "always
    # responds"/"never responds", and showing 0% would lie about that.
    response_rate: float | None
    rejection_rate: float | None
    disputed_transactions_count: int


class BuyerSummaryOut(BaseModel):
    """
    GET /profiles/{user_id}/buyer-summary — the ORIGINAL direction of
    "خلاصه اعتماد خریدار" (TECHNICAL_REQUIREMENTS.md section 2): what a
    PROVIDER should see about a buyer before accepting/rejecting their
    request. That entity was fully blocked when first documented (no
    Transaction/ChatSession existed yet); like ProviderSummaryOut, it
    now returns the subset that's genuinely computable today. Still
    missing, per the doc: cancelled-by-buyer count (buyer-initiated
    cancellation isn't built), dispute count (no Report entity yet), and
    both rating averages (no Rating entity yet).
    """

    status: str  # "established" | "new"
    joined_at: datetime
    completed_transactions_count: int
    # Everything ever charged to this buyer, whether the transaction has
    # released to its provider yet or not (see Transaction.status) — the
    # money already left their wallet the moment they paid, in both
    # cases, so both count as "spent" from a trust-signal point of view.
    total_stars_spent: int
