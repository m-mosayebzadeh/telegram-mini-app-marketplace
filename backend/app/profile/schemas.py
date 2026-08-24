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

    avatar_url: str | None = Field(default=None, max_length=500)
    bio: str | None = Field(default=None, max_length=1000)


class ProfileOut(BaseModel):
    """What we send back."""

    id: int
    avatar_url: str | None
    bio: str | None

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
    # Only counts ACCEPTED follows (see app/models/follow.py) — a
    # pending follow request isn't a real follower yet.
    followers_count: int
    following_count: int


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
