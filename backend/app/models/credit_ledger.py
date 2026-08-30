"""
CreditLedgerEntry: one row of the platform's internal credit ledger (see
TECHNICAL_REQUIREMENTS.md, "دفترکل اعتباری").

A user's spendable wallet balance is never stored as a single mutable
number — it's always the SUM of that user's own ledger entries. This
means every Toman that ever moves is individually recorded and
auditable: "where did this balance come from?" always has a real,
traceable answer, instead of just trusting a number nobody can explain.

The ledger's accounting unit is Toman, not Stars — see
TECHNICAL_REQUIREMENTS.md for why the wallet and offer/content pricing
deliberately use different units.
"""

import enum
from datetime import datetime

from sqlalchemy import CheckConstraint, Enum, ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.time import UTCDateTime, utcnow


class LedgerEntryType(str, enum.Enum):
    # A real top-up, credited only after an admin approves a
    # TopUpRequest (see app/topup/router.py) — the manual card-to-card
    # flow from TECHNICAL_REQUIREMENTS.md's "شارژ کارت‌به‌کارت".
    TOPUP = "topup"
    # Phase 1 only: a way to credit a wallet for local testing, without
    # any real payment. Gated behind settings.enable_dev_tools wherever
    # it's used (see app/dev/router.py) — never reachable in production.
    TOPUP_DEV_STUB = "topup_dev_stub"
    # A buyer paying the full (gross) price of a chat request or a piece
    # of content.
    SPEND = "spend"
    # A provider receiving their net share (gross minus commission) of a
    # completed transaction.
    RECEIVE = "receive"
    # The platform's commission cut. Not tied to any particular user's
    # spendable balance — see user_id below.
    COMMISSION = "commission"


class CreditLedgerEntry(Base):
    __tablename__ = "credit_ledger_entries"

    id: Mapped[int] = mapped_column(primary_key=True)

    # Nullable ONLY for COMMISSION entries. A commission entry represents
    # platform revenue, not money owed to any one user's wallet, so it
    # deliberately isn't attached to a user — enforced by the CHECK
    # constraint below, the same "flag <-> matching column" pattern used
    # throughout this codebase (see Content, Request).
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    # Positive = money added to the wallet, negative = money removed.
    # Toman, per the module docstring above.
    amount_toman: Mapped[int] = mapped_column(Integer)

    type: Mapped[LedgerEntryType] = mapped_column(
        Enum(LedgerEntryType, values_callable=lambda enum_cls: [e.value for e in enum_cls]),
    )

    # Which Transaction this entry belongs to. Nullable only for
    # TOPUP_DEV_STUB, which isn't a marketplace transaction at all — see
    # the CHECK constraint below.
    transaction_id: Mapped[int | None] = mapped_column(
        ForeignKey("transactions.id"), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    __table_args__ = (
        CheckConstraint(
            "(type = 'commission' AND user_id IS NULL) OR "
            "(type != 'commission' AND user_id IS NOT NULL)",
            name="ck_commission_entries_have_no_user",
        ),
        CheckConstraint(
            "(type IN ('topup_dev_stub', 'topup') AND transaction_id IS NULL) OR "
            "(type NOT IN ('topup_dev_stub', 'topup') AND transaction_id IS NOT NULL)",
            name="ck_topup_entries_have_no_transaction",
        ),
    )
