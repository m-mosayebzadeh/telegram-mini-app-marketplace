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
    price_drops: int | None
    has_spoiler: bool
    audience_type: str
    is_pinned: bool
    created_at: datetime
    # Whether *this* viewer can currently see the real content — computed
    # per-request (see app/content/access.py), not a stored column. Lets
    # the frontend decide what to render (plain image, "tap to reveal",
    # or "tap to unlock for N Drops") without a second request.
    can_see_original: bool
    #: How many people have bought this. Shown to the owner before they delete
    #: it, because deleting is a different act once somebody has paid.
    purchase_count: int = 0
    #: Whether it has been taken down. Only ever true for someone who bought
    #: it — nobody else is shown a deleted item at all.
    is_deleted: bool = False
    like_count: int
    liked_by_me: bool

    model_config = {"from_attributes": True}


class PurchaseResult(BaseModel):
    unlocked: bool
