from datetime import datetime

from pydantic import BaseModel, Field


class MyAdminAccessOut(BaseModel):
    """What the CALLING user can do, admin-wise — lets the frontend
    decide whether to even show admin UI without guessing from a 403.
    Always 200 (never itself a permission check) — see GET /admin/me."""

    is_owner: bool
    scopes: list[str]


class RoleCreate(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    scopes: list[str] = Field(default_factory=list)


class RoleUpdate(BaseModel):
    """Both fields optional — a real PATCH, only what's sent changes
    (renaming a role doesn't require re-sending its scopes, and vice
    versa)."""

    name: str | None = Field(default=None, min_length=1, max_length=64)
    scopes: list[str] | None = None


class RoleOut(BaseModel):
    id: int
    name: str
    scopes: list[str]
    is_active: bool
    created_at: datetime
    # Denormalized (see app/admin/router.py's list_roles) so the role
    # list — and the "N assistants have this role" confirmation before
    # deleting/deactivating it — never need a second round trip.
    member_count: int


class AdminUserSummaryOut(BaseModel):
    """One row in a user-picker list — the search box in "جستجوی
    اعضا" and the plain "کاربران" browse list both return this shape.
    `is_assistant` only really matters for the former (a checkmark next
    to anyone who already holds at least one role); the Users section
    ignores it."""

    user_id: int
    display_name: str
    username: str | None
    avatar_url: str | None
    is_assistant: bool


class UserRoleOut(BaseModel):
    """One row of a specific user's own role list (GET
    /admin/users/{id}/roles) — id/name/is_active of a role they hold,
    not the role's own scopes (see "نمایش دسترسی‌ها", which is just
    RoleOut itself, fetched separately when that's what's asked for)."""

    role_id: int
    role_name: str
    is_active: bool


class RoleAssign(BaseModel):
    role_id: int


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


class AdminUserDetailOut(BaseModel):
    """The "کاربران" section's per-user page header — profile basics +
    account status + wallet balance in one call; the offers/content/
    requests/chat-sessions/transactions lists below it are each their
    own separate endpoint (see app/admin/router.py), reusing the exact
    same *Out schemas their own normal, non-admin routes already
    return, rather than a second copy of each."""

    user_id: int
    display_name: str
    username: str | None
    avatar_url: str | None
    telegram_id: int
    joined_at: datetime
    status: str  # "active" | "blocked"
    balance_toman: int
    pending_toman: int


class AdminChatSessionOut(BaseModel):
    """A lighter view of one chat session for the "کاربران" detail
    page — just enough to identify and glance at it (who, which offer,
    what state); unlike ChatSessionOut, not meant to actually drive the
    chat screen itself, so it skips that schema's viewer-relative
    my_role/other_participant enrichment in favor of plain,
    admin-relative fields."""

    id: int
    offer_title: str
    other_user_id: int
    other_display_name: str
    status: str
    opened_at: datetime
    closed_at: datetime | None


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
