from datetime import datetime

from pydantic import BaseModel


class ReplyPreview(BaseModel):
    """Enough of the message being answered to draw the quote above a
    reply, and to jump to it."""

    id: int
    sender_id: int
    type: str
    text: str | None


class ReactionOut(BaseModel):
    user_id: int
    emoji: str


class ChatMessageOut(BaseModel):
    id: int
    conversation_id: int
    # Which paid session this was written during; null for a free message.
    chat_session_id: int | None
    sender_id: int
    type: str
    # Set for 'text' only; null otherwise.
    text: str | None
    # Set for 'video'/'voice' only; null otherwise. Never set for
    # 'photo' — a photo has no duration.
    duration_seconds: int | None
    created_at: datetime
    #: This message carried a card number, Sheba, phone number or handle.
    #: The conversation shows its warning under the first one of these.
    flagged_payment: bool = False
    #: The sender's own name for this message (see ChatMessage.client_id).
    #: Lets the sender's phone match the confirmed message to the one it
    #: has been showing with a clock since before it was sent.
    client_id: str | None = None
    #: When the text was last changed, or null. The app shows "edited";
    #: what it said before is for staff only.
    edited_at: datetime | None = None
    reply_to_id: int | None = None
    #: Filled by app/chat_message/actions.py's messages_out; empty where a
    #: route returns plain rows.
    reply_to: ReplyPreview | None = None
    reactions: list[ReactionOut] = []

    # Deliberately no file_path field — never exposed directly (same
    # rule as Content.original_file_path). A 'photo'/'video' message's
    # bytes are fetched separately from
    # GET /chat-sessions/{id}/messages/{message_id}/file, which is
    # access-checked server-side; the frontend can tell whether to call
    # it purely from `type`.

    model_config = {"from_attributes": True}
