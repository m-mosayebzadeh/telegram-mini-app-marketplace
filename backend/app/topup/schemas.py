from datetime import datetime

from pydantic import BaseModel


class TopUpCardInfoOut(BaseModel):
    """The destination card to show on the "direct" top-up screen —
    empty strings mean the owner hasn't configured it in .env yet."""

    card_number: str
    card_holder_name: str


class TopUpRequestOut(BaseModel):
    id: int
    user_id: int
    requested_stars: int
    star_rate_at_request: int
    requested_toman_amount: int
    status: str
    final_toman_amount: int | None
    transaction_reference: str | None
    rejection_reason: str | None
    reviewed_by_user_id: int | None
    reviewed_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


class TopUpApproveIn(BaseModel):
    final_toman_amount: int
    transaction_reference: str


class TopUpRejectIn(BaseModel):
    reason: str
