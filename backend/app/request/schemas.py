from datetime import datetime

from pydantic import BaseModel, Field


class RequestCreate(BaseModel):
    offer_id: int


class RequestReject(BaseModel):
    reason: str = Field(min_length=1, max_length=500)


class RequestOut(BaseModel):
    id: int
    buyer_id: int
    offer_id: int
    status: str
    reason: str | None
    created_at: datetime
    responded_at: datetime | None

    model_config = {"from_attributes": True}
