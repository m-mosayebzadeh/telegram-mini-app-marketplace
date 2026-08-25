from datetime import datetime

from pydantic import BaseModel


class ChatSessionParticipantOut(BaseModel):
    """The OTHER participant in a session, from the current viewer's
    point of view — never telegram_id (TECHNICAL_REQUIREMENTS.md section
    5), same rule as every other public-facing user reference."""

    user_id: int
    display_name: str
    username: str | None
    avatar_url: str | None


class ChatSessionOut(BaseModel):
    id: int
    request_id: int
    transaction_id: int
    status: str
    opened_at: datetime
    closed_at: datetime | None
    closed_by_user_id: int | None

    # --- everything below is denormalized onto this response so the
    # chat screen never needs a second round trip just to render its own
    # header/session-details panel (same "answer what the screen needs
    # directly" pattern as PublicProfileOut.follow_status) ---

    # Which side of this session the CURRENT caller is on — the frontend
    # already has to know this to decide e.g. whether it can still
    # dispute, so it's simplest to just say so directly.
    my_role: str  # "buyer" | "provider"
    other_participant: ChatSessionParticipantOut

    offer_title: str
    price_stars: int
    # Informational display duration from the Offer — TECHNICAL_REQUIREMENTS.md
    # is explicit this is never an enforced timer; the chat UI shows it
    # as "expected duration", not a countdown.
    display_duration_minutes: int

    # Whether this session's Transaction has been disputed (see
    # app/models/transaction.py's disputed_at) — lets the UI show a
    # "Disputed / under review" state distinctly from a plain "closed"
    # one, using data that already exists rather than inventing a new
    # state nothing backs.
    disputed: bool
    transaction_status: str  # "pending" | "succeeded" | "failed" | "refunded"

    model_config = {"from_attributes": True}
