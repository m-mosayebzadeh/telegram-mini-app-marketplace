"""
Note what's deliberately absent here: no field ever carries
original_file_path. Clients only ever get a content `id` and fetch bytes
through the access-checked /content/{id}/file route — the server disk
path is an internal implementation detail, never part of the API's
contract.
"""

from datetime import datetime

from pydantic import BaseModel


class ContentOut(BaseModel):
    id: int
    user_id: int
    content_type: str
    duration_seconds: int | None
    is_paid: bool
    price_stars: int | None
    has_spoiler: bool
    audience_type: str
    is_pinned: bool
    created_at: datetime
    # Whether *this* viewer can currently see the real content — computed
    # per-request (see app/content/access.py), not a stored column. Lets
    # the frontend decide what to render (plain image, "tap to reveal",
    # or "tap to unlock for N stars") without a second request.
    can_see_original: bool
    like_count: int
    liked_by_me: bool

    model_config = {"from_attributes": True}


class PurchaseResult(BaseModel):
    unlocked: bool
