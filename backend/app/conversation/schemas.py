from datetime import datetime

from pydantic import BaseModel


class ConversationParticipantOut(BaseModel):
    """Someone else in a conversation, from the caller's point of view —
    never telegram_id (TECHNICAL_REQUIREMENTS.md section 5), the same rule
    as every other public-facing user reference."""

    user_id: int
    display_name: str
    username: str | None
    avatar_url: str | None


class ConversationOut(BaseModel):
    id: int
    kind: str
    created_at: datetime
    last_message_at: datetime | None

    #: Everyone except the caller. A direct thread has exactly one; an
    #: event room has many, which is why this is a list even though the
    #: common case is one — a screen written against a single "other
    #: person" would have to be rewritten the day groups arrive.
    others: list[ConversationParticipantOut]

    #: What may be sent right now: the thread's own baseline plus whatever
    #: a running paid session adds. The composer is built from this rather
    #: than from its own copy of the rules, so the two can never disagree.
    capabilities: list[str]

    #: The paid session running in this thread right now, if any. The chat
    #: screen uses it to show the block bar and the remaining time.
    active_session_id: int | None

    #: This person's own view of the thread.
    archived: bool
    unread: bool

    #: A short preview for the list. Null when the last thing said was not
    #: text, or when there is nothing to show yet.
    last_text: str | None


class OpenConversationIn(BaseModel):
    user_id: int
