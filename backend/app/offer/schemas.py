from datetime import datetime

from pydantic import BaseModel, Field


class OfferCreate(BaseModel):
    price_stars: int = Field(gt=0)
    display_duration_minutes: int = Field(gt=0)
    description: str = Field(min_length=1, max_length=2000)
    terms: str = Field(min_length=1, max_length=2000)


class OfferUpdate(BaseModel):
    """
    All fields optional — a real PATCH: only the fields actually sent
    get changed, everything else stays as-is. Only reachable at all when
    the offer has no live (pending/accepted) request, per
    TECHNICAL_REQUIREMENTS.md section 4.
    """

    price_stars: int | None = Field(default=None, gt=0)
    display_duration_minutes: int | None = Field(default=None, gt=0)
    description: str | None = Field(default=None, min_length=1, max_length=2000)
    terms: str | None = Field(default=None, min_length=1, max_length=2000)


class OfferOut(BaseModel):
    id: int
    provider_id: int
    service_type: str
    price_stars: int
    display_duration_minutes: int
    description: str
    terms: str
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}
