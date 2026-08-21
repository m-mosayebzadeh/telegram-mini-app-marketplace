from datetime import datetime

from pydantic import BaseModel


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
