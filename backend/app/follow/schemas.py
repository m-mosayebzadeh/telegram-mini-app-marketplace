from datetime import datetime

from pydantic import BaseModel

from app.profile.schemas import FollowListItemOut


class FollowOut(BaseModel):
    id: int
    # Our own internal user ids — never telegram_id (see
    # TECHNICAL_REQUIREMENTS.md section 5: it must never be exposed to
    # other users).
    follower_id: int
    followee_id: int
    status: str
    requested_at: datetime
    responded_at: datetime | None

    model_config = {"from_attributes": True}


class IncomingFollowRequestOut(BaseModel):
    """
    One row of GET /follow/incoming-requests — every follow request
    ever sent TO the current user, pending or already responded to
    (see FollowStatus.REJECTED's docstring for why rejected ones are
    kept instead of deleted). This is the "who has requested to follow
    me" inbox, the Instagram-style screen TECHNICAL_REQUIREMENTS.md's
    follow-back idea (section 9) was always meant to live on.
    """

    follow_id: int
    requester: FollowListItemOut
    status: str  # "pending" | "accepted" | "rejected"
    requested_at: datetime
    responded_at: datetime | None
    # Whether the CURRENT user (the followee here) already follows this
    # requester back — lets the frontend show a "follow back" action
    # only when it's actually still meaningful, per the pre-existing
    # future-idea note this replaces.
    i_follow_them_back: bool
