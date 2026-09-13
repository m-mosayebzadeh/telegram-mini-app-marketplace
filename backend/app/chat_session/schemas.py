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
    # None until the session closes — there is no purchase to record until
    # the consumed amount is known (see app/wallet/blocks.py).
    transaction_id: int | None
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
    price_drops: int
    # The length the session actually runs for. No longer decoration: the
    # session closes itself at the end of its last block.
    session_duration_seconds: int

    # --- the block plan, frozen at the start (see app/wallet/blocks.py) ---
    reserved_blocks: int
    block_duration_seconds: int
    block_price_drops: int
    #: When it will stop on its own, honouring a stop-at-block-end request.
    ends_at: datetime | None
    #: Who asked for it to stop at the end of the running block, if anyone.
    close_at_block_end_by_user_id: int | None
    #: Filled in once it has closed.
    consumed_blocks: int
    end_reason: str | None

    #: Whether the CALLER has signed off on the settlement — once they have,
    #: they can no longer dispute this session.
    i_confirmed_settlement: bool
    #: Whether the other participant has. Both means the money is released
    #: without waiting out the rest of the window.
    they_confirmed_settlement: bool

    # Whether this session's Transaction has been disputed (see
    # app/models/transaction.py's disputed_at) — lets the UI show a
    # "Disputed / under review" state distinctly from a plain "closed"
    # one, using data that already exists rather than inventing a new
    # state nothing backs.
    # Both are None until the session closes: there is no transaction until
    # the consumed amount is known (see app/wallet/blocks.py).
    disputed: bool
    transaction_status: str | None  # "pending" | "succeeded" | "failed" | "refunded"

    # Whether the CURRENT caller has archived this session (see
    # ChatSession.archived_by_buyer/archived_by_provider) — per-viewer,
    # so the same session can be archived for one participant and not
    # the other. Drives the Chats tab's Active/Archived split.
    archived: bool

    model_config = {"from_attributes": True}
