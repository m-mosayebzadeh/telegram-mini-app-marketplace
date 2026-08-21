from datetime import datetime

from pydantic import BaseModel, Field


class AudienceGroupCreate(BaseModel):
    name: str = Field(min_length=1, max_length=64)


class AudienceGroupMemberOut(BaseModel):
    user_id: int
    added_at: datetime

    model_config = {"from_attributes": True}


class AudienceGroupOut(BaseModel):
    id: int
    name: str
    created_at: datetime
    members: list[AudienceGroupMemberOut]

    model_config = {"from_attributes": True}
