"""
Note what's deliberately absent here: no field ever carries
original_file_path or blurred_file_path. Clients only ever get a photo
`id` and fetch bytes through the access-checked /photos/{id}/image and
/photos/{id}/original routes — the server disk paths are an internal
implementation detail, never part of the API's contract.
"""

from datetime import datetime

from pydantic import BaseModel


class PhotoOut(BaseModel):
    id: int
    is_paid: bool
    price_stars: int | None
    is_blurred: bool
    audience_type: str
    created_at: datetime
    # Whether *this* viewer can currently see the unblurred version —
    # computed per-request (see app/photo/access.py), not a stored
    # column. Lets the frontend decide what to render (plain image,
    # "tap to reveal", or "tap to unlock for N stars") without a second
    # request.
    can_see_original: bool

    model_config = {"from_attributes": True}


class PurchaseResult(BaseModel):
    unlocked: bool
