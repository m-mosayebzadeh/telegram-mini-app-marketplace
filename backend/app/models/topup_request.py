"""
TopUpRequest: one manual card-to-card wallet top-up, from submission
through admin review (see TECHNICAL_REQUIREMENTS.md, "شارژ کارت‌به‌کارت").

Deliberately its own entity, separate from CreditLedgerEntry — a request
can sit PENDING for a while (or get REJECTED) without ever touching the
wallet at all; only an APPROVED request produces a real ledger entry
(see app/topup/router.py's approve endpoint). requested_stars/
star_rate_at_request/requested_toman_amount are what the USER asked
for, frozen at submission time (same "freeze the rate" pattern as
Transaction) — purely so the admin has something to cross-check the
actual bank receipt against. The admin's own final_toman_amount at
approval time is the number that actually gets credited, and can
legitimately differ from what was requested (e.g. the user rounded
differently at the bank) — the frontend surfaces that difference back
to the admin as a confirmation step before they can submit it, so a
fat-fingered extra zero doesn't silently become a huge credit.
"""

import enum
from datetime import datetime

from sqlalchemy import CheckConstraint, Enum, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.time import UTCDateTime, utcnow


class TopUpStatus(str, enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class TopUpRequest(Base):
    __tablename__ = "topup_requests"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))

    # Never served publicly — only the requester themselves or an admin
    # with the "wallet_topups" scope can fetch the bytes (see
    # app/topup/router.py), the same access-checked-route pattern
    # Content already uses instead of a plain static mount.
    receipt_file_path: Mapped[str] = mapped_column(String(500))

    requested_stars: Mapped[int] = mapped_column(Integer)
    star_rate_at_request: Mapped[int] = mapped_column(Integer)
    requested_toman_amount: Mapped[int] = mapped_column(Integer)

    status: Mapped[TopUpStatus] = mapped_column(
        Enum(TopUpStatus, values_callable=lambda enum_cls: [e.value for e in enum_cls]),
        default=TopUpStatus.PENDING,
    )

    # Only set once a real admin decision has been made — see the CHECK
    # constraint below for exactly which fields go with which status.
    final_toman_amount: Mapped[int | None] = mapped_column(Integer, nullable=True)
    transaction_reference: Mapped[str | None] = mapped_column(String(100), nullable=True)
    rejection_reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    reviewed_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)

    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    __table_args__ = (
        CheckConstraint(
            "(status = 'pending' AND final_toman_amount IS NULL AND transaction_reference IS NULL "
            " AND rejection_reason IS NULL AND reviewed_by_user_id IS NULL AND reviewed_at IS NULL) OR "
            "(status = 'approved' AND final_toman_amount IS NOT NULL AND transaction_reference IS NOT NULL "
            " AND rejection_reason IS NULL AND reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL) OR "
            "(status = 'rejected' AND final_toman_amount IS NULL AND transaction_reference IS NULL "
            " AND rejection_reason IS NOT NULL AND reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL)",
            name="ck_topup_review_fields_match_status",
        ),
    )
