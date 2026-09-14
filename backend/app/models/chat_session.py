"""
ChatSession: the open conversation between a buyer and provider, tied to
one paid Request (see TECHNICAL_REQUIREMENTS.md, "نشست چت").

Created automatically the moment payment succeeds (see
app/request/router.py's pay_for_request) — never a separate "open the
session" action, so a paid request can never be left without one.

Deliberately just two states, OPEN/CLOSED, matching
TECHNICAL_REQUIREMENTS.md section 3: a session NEVER closes itself based
on elapsed time, only a manual action by either party. What happens to
the money after closing (the grace-period auto-release, or a dispute
freezing it) lives on Transaction / app/wallet/service.py, not here —
this model only tracks the conversation's own open/closed state.
"""

import enum
from datetime import datetime

from sqlalchemy import Boolean, Enum, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.core.time import UTCDateTime, utcnow


class ChatSessionStatus(str, enum.Enum):
    OPEN = "open"
    CLOSED = "closed"


class ChatSession(Base):
    __tablename__ = "chat_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    # One-to-one: every paid Request gets exactly one session, and vice
    # versa — enforced by unique=True, not just convention.
    request_id: Mapped[int] = mapped_column(ForeignKey("requests.id"), unique=True)
    # Set only once the session has closed and its consumed amount is known.
    # A session no longer buys a fixed thing up front — it reserves money and
    # then settles for however much of it was actually used — so the immutable
    # record of the purchase cannot exist until there is a final number to
    # record (see TECHNICAL_REQUIREMENTS.md section 15).
    transaction_id: Mapped[int | None] = mapped_column(
        ForeignKey("transactions.id"), unique=True, nullable=True
    )

    # --- the block plan, frozen when the session starts -------------------
    #
    # Copied from the offer rather than read through it, so editing or
    # deleting an offer can never change what a session already running was
    # sold as.
    reserved_blocks: Mapped[int] = mapped_column(Integer, default=0)
    block_duration_seconds: Mapped[int] = mapped_column(Integer, default=0)
    block_price_drops: Mapped[int] = mapped_column(Integer, default=0)
    block_price_toman: Mapped[int] = mapped_column(Integer, default=0)

    # --- the money, in Toman, which is what the ledger speaks -------------
    #
    # reserved is taken from the buyer at the start; released goes straight
    # back to them at the end for whatever was never used; consumed is what
    # remains and goes on to settlement.
    reserved_toman: Mapped[int] = mapped_column(Integer, default=0)
    released_toman: Mapped[int] = mapped_column(Integer, default=0)
    consumed_toman: Mapped[int] = mapped_column(Integer, default=0)
    consumed_blocks: Mapped[int] = mapped_column(Integer, default=0)

    # When the clock actually started: the provider's first message, not the
    # moment the money was reserved. A buyer should not pay for the seconds
    # spent waiting for the other person to arrive — and making the start an
    # act of the provider's removes the need for any separate rule about a
    # provider who never turns up. NULL means the session is reserved and
    # waiting; the buyer may write in the meantime without starting anything.
    started_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)

    # When the session is due to close on its own: the real start plus every
    # reserved block. Storing the end rather than recomputing it is what lets
    # "has this finished?" be one comparison, with no scheduler anywhere.
    scheduled_end_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)

    # Either side can ask for the session to stop at the end of the block that
    # is running, instead of stopping mid-block or running to the end.
    #
    # Its real value is protecting someone from an accident: without it, anyone
    # who does not want the next block has to watch the clock and press close
    # before the boundary, and being ten seconds late costs a whole block.
    # Changing your mind simply clears both fields again.
    close_at_block_end_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    # The boundary itself, fixed when the request is made rather than worked
    # out later: recomputing it would let the target slide forward into every
    # new block, and the session would never actually stop.
    close_at_block_end_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)

    # Why it ended, as a value rather than prose — the settlement rules differ
    # per reason (see app/wallet/blocks.py).
    end_reason: Mapped[str | None] = mapped_column(String(32), nullable=True)

    # --- extension --------------------------------------------------------
    #
    # Only the buyer asks, and only ever for ONE more block at a time. The
    # provider has to accept, because it is their time; but they can never
    # offer it, which would turn a conversation into a sales pitch and bring
    # back the very incentive to stretch things out that the block model
    # exists to remove.
    #
    # The block's price is held the moment it is asked for, so an acceptance
    # can never land on a wallet that cannot cover it. NULL means no request
    # is outstanding.
    extension_requested_at: Mapped[datetime | None] = mapped_column(
        UTCDateTime, nullable=True
    )

    # --- the settlement window --------------------------------------------
    #
    # Either side can say "this was fine" once the session has closed. When
    # BOTH have, the money is released at once instead of waiting out the
    # grace period — there is nothing left to protect against.
    #
    # Confirming also gives up your own right to complain about this session,
    # which is why it is recorded per side: the other participant keeps theirs
    # either way.
    settlement_confirmed_by_buyer_at: Mapped[datetime | None] = mapped_column(
        UTCDateTime, nullable=True
    )
    settlement_confirmed_by_provider_at: Mapped[datetime | None] = mapped_column(
        UTCDateTime, nullable=True
    )

    status: Mapped[ChatSessionStatus] = mapped_column(
        Enum(ChatSessionStatus, values_callable=lambda enum_cls: [e.value for e in enum_cls], native_enum=False),
        default=ChatSessionStatus.OPEN,
    )
    opened_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    closed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    closed_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )

    # Per-viewer "archived" state — moves a session out of the Chats
    # tab's main list into its Archived segment (see app/chat_session/router.py's
    # /archive, /unarchive) without touching the other participant's
    # view of the same session, and without deleting anything: the
    # session (and the Transaction it's tied to) always stays exactly
    # where it is, for both parties' financial/dispute history. Two
    # plain booleans rather than a join table, since a session only ever
    # has exactly two possible viewers (buyer, provider).
    archived_by_buyer: Mapped[bool] = mapped_column(Boolean, default=False)
    archived_by_provider: Mapped[bool] = mapped_column(Boolean, default=False)

    # Removing a conversation is one-sided, like archiving above it: each
    # participant decides what to do with their own copy, and the other side's
    # view is untouched. The messages themselves are never deleted — the other
    # person is still reading them.
    #
    # Deliberately not one shared flag: a conversation both people took part in
    # is not one person's to erase.
    deleted_by_buyer_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    deleted_by_provider_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)

    # Lets code reach `session.request.buyer_id` /
    # `session.request.offer.provider_id` instead of separate queries.
    request: Mapped["Request"] = relationship()
    transaction: Mapped["Transaction"] = relationship()
