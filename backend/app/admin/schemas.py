from datetime import datetime

from pydantic import BaseModel, Field


class MyAdminAccessOut(BaseModel):
    """What the CALLING user can do, admin-wise — lets the frontend
    decide whether to even show admin UI without guessing from a 403.
    Always 200 (never itself a permission check) — see GET /admin/me."""

    is_owner: bool
    scopes: list[str]


class AdminGrantCreate(BaseModel):
    # The target person's real Telegram id (something the owner asks
    # them for directly, e.g. via @userinfobot) — not our internal user
    # id, which nobody outside the database would know to give the
    # owner. The person must have opened the mini app at least once
    # already (so a User row exists) — see app/admin/router.py.
    telegram_id: int
    scopes: list[str]


class AdminGrantOut(BaseModel):
    id: int
    user_id: int
    display_name: str
    username: str | None
    scopes: list[str]
    granted_by_user_id: int
    created_at: datetime


class TopUpRequesterOut(BaseModel):
    """Just enough about the requester for the admin review list to be
    readable — not the full PublicProfileOut."""

    user_id: int
    display_name: str
    username: str | None


class AdminTopUpRequestOut(BaseModel):
    id: int
    requester: TopUpRequesterOut
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


class PlatformRatesOut(BaseModel):
    star_to_toman_rate: int
    chat_commission_percent: int
    content_commission_percent: int
    updated_at: datetime


class PlatformRatesUpdate(BaseModel):
    # Percentages are 0-100 (whole numbers, see split_commission() in
    # app/wallet/service.py); the rate just has to stay positive — a
    # zero or negative Toman-per-Star rate would make every price
    # nonsensical.
    star_to_toman_rate: int = Field(gt=0)
    chat_commission_percent: int = Field(ge=0, le=100)
    content_commission_percent: int = Field(ge=0, le=100)
