from datetime import datetime

from pydantic import BaseModel, Field


class OfferCreate(BaseModel):
    price_stars: int = Field(gt=0)
    display_duration_minutes: int = Field(gt=0)
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(min_length=1, max_length=2000)


class OfferUpdate(BaseModel):
    """
    All fields optional — a real PATCH: only the fields actually sent
    get changed, everything else stays as-is. Only reachable at all when
    the offer has no live (pending/accepted) request, per
    TECHNICAL_REQUIREMENTS.md section 4.
    """

    price_stars: int | None = Field(default=None, gt=0)
    display_duration_minutes: int | None = Field(default=None, gt=0)
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, min_length=1, max_length=2000)


class OfferOut(BaseModel):
    id: int
    provider_id: int
    service_type: str
    price_stars: int
    display_duration_minutes: int
    title: str
    description: str
    status: str
    created_at: datetime

    # Only populated when listing your OWN offers (see list_offers) —
    # None everywhere else (marketplace-wide discovery, someone else's
    # offers), since a buyer browsing offers has no business seeing how
    # many other people requested one before they did.
    request_count: int | None = None

    # Only populated by GET /offers/{id} for a non-owner viewer — the
    # status ('pending' | 'accepted') of the CALLER's own live request
    # against this offer's provider, if any (see app/offer/router.py's
    # _my_live_request_status, reusing the same "live request" rule
    # app/request/router.py already enforces server-side). Lets the
    # frontend disable "Request this offer" and show why, instead of
    # only finding out after a rejected POST.
    my_request_status: str | None = None

    model_config = {"from_attributes": True}
