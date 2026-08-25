from datetime import datetime

from pydantic import BaseModel


class ChatMessageOut(BaseModel):
    id: int
    chat_session_id: int
    sender_id: int
    type: str
    # Set for 'text' only; null otherwise.
    text: str | None
    # Set for 'video'/'voice' only; null otherwise. Never set for
    # 'photo' — a photo has no duration.
    duration_seconds: int | None
    created_at: datetime

    # Deliberately no file_path field — never exposed directly (same
    # rule as Content.original_file_path). A 'photo'/'video' message's
    # bytes are fetched separately from
    # GET /chat-sessions/{id}/messages/{message_id}/file, which is
    # access-checked server-side; the frontend can tell whether to call
    # it purely from `type`.

    model_config = {"from_attributes": True}
