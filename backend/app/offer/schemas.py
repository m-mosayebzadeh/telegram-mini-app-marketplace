from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from app.core.config import SESSION_BLOCK_COUNT


def _must_divide_into_blocks(value: int, what: str) -> int:
    """A session is sold and settled one block at a time, so both its price and
    its length have to split into whole blocks — otherwise every session would
    carry a rounding error in the one place it is least acceptable."""
    if value % SESSION_BLOCK_COUNT:
        raise ValueError(f'{what} must divide evenly into {SESSION_BLOCK_COUNT} blocks')
    return value


class OfferCreate(BaseModel):
    price_photons: int = Field(gt=0)
    session_duration_seconds: int = Field(gt=0)
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(min_length=1, max_length=2000)

    @field_validator('price_photons')
    @classmethod
    def _price_in_whole_blocks(cls, value: int) -> int:
        return _must_divide_into_blocks(value, 'price_photons')

    @field_validator('session_duration_seconds')
    @classmethod
    def _duration_in_whole_blocks(cls, value: int) -> int:
        return _must_divide_into_blocks(value, 'session_duration_seconds')


class OfferUpdate(BaseModel):
    """
    All fields optional — a real PATCH: only the fields actually sent
    get changed, everything else stays as-is. Only reachable at all when
    the offer has no live (pending/accepted) request, per
    TECHNICAL_REQUIREMENTS.md section 4.
    """

    price_photons: int | None = Field(default=None, gt=0)
    session_duration_seconds: int | None = Field(default=None, gt=0)
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, min_length=1, max_length=2000)

    @field_validator('price_photons')
    @classmethod
    def _price_in_whole_blocks(cls, value: int | None) -> int | None:
        return value if value is None else _must_divide_into_blocks(value, 'price_photons')

    @field_validator('session_duration_seconds')
    @classmethod
    def _duration_in_whole_blocks(cls, value: int | None) -> int | None:
        return value if value is None else _must_divide_into_blocks(value, 'session_duration_seconds')


class OfferProviderOut(BaseModel):
    """
    Just enough about the person behind an offer to draw the showcase
    card (docs/design-system/02-components.md: photo, name, trust badge,
    one line of bio, interest tags).

    Deliberately a SUBSET of PublicProfileOut: a browse list has no
    business carrying follower counts, birthdays or the viewer's follow
    status. Anyone who wants those taps through to the profile, which is
    one request for one person rather than all of it for everyone.
    """

    user_id: int
    display_name: str
    username: str | None
    avatar_url: str | None
    bio: str | None
    is_trusted: bool
    interests: list[str]


class OfferOut(BaseModel):
    id: int
    provider_id: int
    service_type: str
    price_photons: int
    session_duration_seconds: int
    title: str
    description: str
    status: str
    #: Whether it has been deleted. Only staff ever see a deleted offer at all,
    #: so for everyone else this is always false.
    is_deleted: bool = False
    created_at: datetime

    # Only populated when listing your OWN offers (see list_offers) —
    # None everywhere else (marketplace-wide discovery, someone else's
    # offers), since a buyer browsing offers has no business seeing how
    # many other people requested one before they did.
    request_count: int | None = None

    # Only populated by GET /offers/{id} for a non-owner viewer — the
    # status ('pending' | 'accepted') of the CALLER's own live request
    # specifically against THIS offer, if any (see app/offer/router.py's
    # _my_live_request_status_for_offer). Scoped to just this offer on
    # purpose: it only answers "would tapping Request be a no-op here",
    # not the broader "one live request per provider" rule, which is
    # enforced at request-creation time instead (POST /requests) via a
    # structured error the frontend uses to show the right message for
    # THAT case.
    my_request_status: str | None = None

    # Only populated by marketplace-wide discovery (GET /offers with no
    # provider_id). Listing ONE provider's offers leaves it None, because
    # the caller is already on that provider's page and repeating them on
    # every row would be the same blob N times.
    provider: OfferProviderOut | None = None

    model_config = {"from_attributes": True}
