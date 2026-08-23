from datetime import datetime

from pydantic import BaseModel


class ChatSessionOut(BaseModel):
    id: int
    request_id: int
    transaction_id: int
    status: str
    opened_at: datetime
    closed_at: datetime | None
    closed_by_user_id: int | None

    model_config = {"from_attributes": True}
