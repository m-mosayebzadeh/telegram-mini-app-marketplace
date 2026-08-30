"""
Transaction: one completed, paid purchase — either a chat request or a
piece of paid content (see TECHNICAL_REQUIREMENTS.md, "تراکنش").

Deliberately independent of Request (per TECHNICAL_REQUIREMENTS.md
section 3): a Request shows WHAT was asked for, a Transaction shows the
financial outcome of paying for it. This also lets one Transaction model
serve both chat requests and content purchases instead of needing two
near-identical tables.

Every number here is computed ONCE, at the moment of payment, and frozen
forever — see split_commission() in app/wallet/service.py. If the
platform's commission percentage or the Star-to-Toman rate changes
later, past transactions must NOT change retroactively; only future
ones use the new values.
"""

import enum
from datetime import datetime

from sqlalchemy import CheckConstraint, Enum, ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.time import UTCDateTime, utcnow


class TransactionKind(str, enum.Enum):
    CHAT_REQUEST = "chat_request"
    CONTENT_PURCHASE = "content_purchase"


class TransactionStatus(str, enum.Enum):
    # A CHAT_REQUEST transaction starts here: the buyer has already been
    # charged (their SPEND ledger entry exists), but the provider's
    # share and the platform's commission are deliberately withheld —
    # not yet turned into CreditLedgerEntry rows — until the chat
    # session this paid for actually closes and its grace period passes
    # undisputed. This is the "idle money" model from
    # TECHNICAL_REQUIREMENTS.md — see release_due_chat_transactions() in
    # app/wallet/service.py for the mechanism that moves a transaction
    # out of this state.
    PENDING = "pending"
    # A CONTENT_PURCHASE transaction is created directly in this state —
    # delivery is instant and immediately verifiable (the buyer gets the
    # file right away), so there's no equivalent "did the service
    # actually happen" question to wait on. A CHAT_REQUEST transaction
    # only reaches this state via release_transaction().
    SUCCEEDED = "succeeded"
    # Reserved for later phases (see TECHNICAL_REQUIREMENTS.md section
    # 7 — dispute resolution isn't designed yet). Added now so this
    # column's set of possible values doesn't need to change shape later.
    FAILED = "failed"
    REFUNDED = "refunded"


class Transaction(Base):
    __tablename__ = "transactions"

    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[TransactionKind] = mapped_column(
        Enum(TransactionKind, values_callable=lambda enum_cls: [e.value for e in enum_cls]),
    )

    buyer_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    provider_id: Mapped[int] = mapped_column(ForeignKey("users.id"))

    # Exactly one of these two is set, matching `kind` — same
    # "CHECK enforces which column is filled in" pattern as Content's
    # audience_user_id / audience_group_id.
    request_id: Mapped[int | None] = mapped_column(ForeignKey("requests.id"), nullable=True)
    content_id: Mapped[int | None] = mapped_column(ForeignKey("contents.id"), nullable=True)

    # --- the Star-denominated split (the authoritative numbers) ---
    # Copied from the Offer/Content's price at the moment of payment, not
    # read live from it later — the source could theoretically change
    # (though business rules already block editing a live offer; this is
    # just extra safety for content, which has no such lock).
    gross_price_stars: Mapped[int] = mapped_column(Integer)
    commission_rate_percent: Mapped[int] = mapped_column(Integer)
    commission_stars: Mapped[int] = mapped_column(Integer)
    net_provider_stars: Mapped[int] = mapped_column(Integer)

    # --- the Toman figures, derived from the Star split above using
    # this frozen rate (see module docstring) — purely for the wallet
    # ledger and for display; never re-derived later from a possibly
    # different current rate ---
    star_to_toman_rate: Mapped[int] = mapped_column(Integer)
    gross_price_toman: Mapped[int] = mapped_column(Integer)
    commission_toman: Mapped[int] = mapped_column(Integer)
    net_provider_toman: Mapped[int] = mapped_column(Integer)

    # No default on purpose: pay_for_item() (app/wallet/service.py)
    # always sets this explicitly, since the correct starting value
    # (PENDING vs SUCCEEDED) depends on `kind` — there isn't one
    # sensible default for both.
    status: Mapped[TransactionStatus] = mapped_column(
        Enum(TransactionStatus, values_callable=lambda enum_cls: [e.value for e in enum_cls]),
    )
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    # Freezes a PENDING CHAT_REQUEST transaction so the grace-period
    # auto-release (see release_due_chat_transactions() in
    # app/wallet/service.py) skips it. Only ever set by the party who did
    # NOT close the chat session, only while it's still within the grace
    # window — see app/chat_session/router.py's dispute endpoint. Nothing
    # in this phase resolves a disputed transaction automatically; that's
    # deferred the same way report/complaint handling is (see
    # TECHNICAL_REQUIREMENTS.md section 7).
    disputed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)

    __table_args__ = (
        CheckConstraint(
            "(kind = 'chat_request' AND request_id IS NOT NULL AND content_id IS NULL) OR "
            "(kind = 'content_purchase' AND content_id IS NOT NULL AND request_id IS NULL)",
            name="ck_transaction_target_matches_kind",
        ),
        # The Star split must always account for the whole gross price —
        # this is what guarantees rounding never creates or destroys a
        # star (see split_commission()'s "rounds in the provider's
        # favor" rule: the commission side loses the fraction, the net
        # side never does, so they always add back up exactly).
        CheckConstraint(
            "commission_stars + net_provider_stars = gross_price_stars",
            name="ck_star_split_sums_to_gross",
        ),
    )
