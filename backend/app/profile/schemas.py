"""
Pydantic schemas for the profile endpoints — these describe the shape of
JSON going in and out of the API, separately from Profile (the database
model in app/models/profile.py). Keeping them separate means the API's
public shape doesn't have to change just because the database schema
does, and vice versa.
"""

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
