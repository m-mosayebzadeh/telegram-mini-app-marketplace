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


class IncomingRequestOut(RequestOut):
    """
    One row in a PROVIDER's own "incoming requests for this offer" list
    (GET /requests?offer_id=..., see app/request/router.py's
    list_requests_for_offer) — adds the buyer's own display info,
    denormalized onto each row the same "answer what the screen needs
    directly" way ChatSessionOut and RequestActivityOut already do, so
    the row can show the requester's avatar/name without a second round
    trip per request.
    """

    buyer_display_name: str
    buyer_username: str | None
    buyer_avatar_url: str | None


class RequestActivityOut(BaseModel):
    """
    One row in the Activity tab's unified Requests feed — every request
    the current user is part of, sent (as buyer) or received (as
    provider on one of their own offers), together in one list sorted
    newest-first. Denormalizes the offer's own title/price and the
    OTHER party's own display info onto each row (same "answer what the
    screen needs directly" pattern as ChatSessionOut/IncomingRequestOut)
    so the feed never needs a second round trip per row just to render
    it as a single avatar+name+offer row (the frontend only ever
    actually renders the "sent" ones — see Activity.tsx — but the
    endpoint itself still returns both directions in one call, since
    opening it is also what clears the buyer-side unseen-updates badge
    regardless of which rows get shown).
    """

    id: int
    offer_id: int
    offer_title: str
    offer_price_stars: int
    status: str
    reason: str | None
    created_at: datetime
    responded_at: datetime | None

    # "sent": current user is the buyer who requested someone else's
    # offer. "received": current user is the provider whose own offer
    # someone else requested.
    direction: str  # "sent" | "received"
    counterpart_user_id: int
    counterpart_display_name: str
    counterpart_username: str | None
    counterpart_avatar_url: str | None

    model_config = {"from_attributes": True}
