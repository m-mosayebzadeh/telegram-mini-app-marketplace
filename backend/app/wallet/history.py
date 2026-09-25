"""
The wallet history, as the person reading it would tell it.

The ledger is the truth, but it is not the story. One conversation writes up to
four ledger rows for its buyer — the reservation, the refund of the blocks they
never used, and the same pair again for an extension — so showing ledger rows
would show a single chat as several unrelated amounts, and put the machinery on
display while it was at it.

So this assembles events instead: one row per thing that actually happened.
A chat is one row whose amount is what it ended up costing, whatever sequence
of holds and releases produced that.

Two rules shape what a row says:

  Identity is left out. A list that reads "25 Photons from Sara" is a problem the
  moment someone glances at the screen, and in this app that matters. What was
  bought or sold is shown, because a history nobody can check against anything
  is not a history; who it was with is one deliberate tap away, on the thing
  itself.

  Money that has not arrived yet is still shown, marked as such. A provider
  whose session ended sees nothing at all for a day otherwise, and concludes
  they were not paid.
"""
import enum
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy.orm import Session

from app.models.chat_session import ChatSession
from app.models.content import Content
from app.models.content_access import ContentPurchase
from app.models.credit_ledger import CreditLedgerEntry, LedgerEntryType
from app.models.offer import Offer
from app.models.request import Request
from app.models.transaction import Transaction, TransactionKind, TransactionStatus
from app.models.withdrawal import Withdrawal


class HistoryKind(str, enum.Enum):
    """What happened, in the reader's terms rather than the ledger's."""

    TOP_UP = "top_up"
    WITHDRAWAL = "withdrawal"
    WITHDRAWAL_REFUND = "withdrawal_refund"
    CHAT_EARNING = "chat_earning"
    CHAT_PAYMENT = "chat_payment"
    CONTENT_SALE = "content_sale"
    CONTENT_PURCHASE = "content_purchase"


class HistoryStatus(str, enum.Enum):
    """Where the money stands. Anything but SETTLED can still change."""

    #: Reserved for a conversation that is still running. How much of it is
    #: actually spent is not known until the session ends.
    IN_PROGRESS = "in_progress"
    #: Spent or earned, waiting out the settlement window.
    AWAITING_SETTLEMENT = "awaiting_settlement"
    #: Held because someone said the session went wrong.
    DISPUTED = "disputed"
    #: Final.
    SETTLED = "settled"


@dataclass
class HistoryRow:
    kind: HistoryKind
    status: HistoryStatus
    #: Positive means it came in, negative means it went out.
    amount_photons: int
    at: datetime
    #: What it was about, with nobody's name in it.
    subject: str | None = None
    #: Where tapping the row goes, when there is somewhere it can go. None
    #: when the thing is gone for THIS reader — a seller's deleted content —
    #: which is why it is decided here and not in the app.
    chat_session_id: int | None = None
    content_id: int | None = None


def _status_of(transaction: Transaction) -> HistoryStatus:
    if transaction.disputed_at is not None:
        return HistoryStatus.DISPUTED
    if transaction.status == TransactionStatus.PENDING:
        return HistoryStatus.AWAITING_SETTLEMENT
    return HistoryStatus.SETTLED


def build_history(db: Session, user_id: int, rate: int) -> list[HistoryRow]:
    """Every money event this user was part of, newest first."""
    rows: list[HistoryRow] = []

    # --- money entering and leaving the platform ---------------------------
    for entry in (
        db.query(CreditLedgerEntry)
        .filter(
            CreditLedgerEntry.user_id == user_id,
            CreditLedgerEntry.type.in_(
                [LedgerEntryType.TOPUP, LedgerEntryType.TOPUP_DEV_STUB]
            ),
        )
        .all()
    ):
        rows.append(
            HistoryRow(
                kind=HistoryKind.TOP_UP,
                status=HistoryStatus.SETTLED,
                amount_photons=entry.amount_toman // rate,
                at=entry.created_at,
            )
        )

    for withdrawal in db.query(Withdrawal).filter(Withdrawal.user_id == user_id).all():
        settled = withdrawal.status in {"paid", "rejected", "failed", "cancelled"}
        returned = withdrawal.status in {"rejected", "failed", "cancelled"}
        rows.append(
            HistoryRow(
                kind=HistoryKind.WITHDRAWAL_REFUND if returned else HistoryKind.WITHDRAWAL,
                status=HistoryStatus.SETTLED if settled else HistoryStatus.AWAITING_SETTLEMENT,
                amount_photons=withdrawal.photons if returned else -withdrawal.photons,
                at=withdrawal.updated_at if returned else withdrawal.created_at,
            )
        )

    # --- conversations -----------------------------------------------------
    #
    # One row each, from the session rather than from its ledger entries: what
    # a chat cost is a property of the chat, not of the four rows that moved
    # the money around.
    sessions = (
        db.query(ChatSession, Request, Offer)
        .join(Request, ChatSession.request_id == Request.id)
        .join(Offer, Request.offer_id == Offer.id)
        .filter((Request.buyer_id == user_id) | (Offer.provider_id == user_id))
        .all()
    )
    for chat_session, request, offer in sessions:
        is_buyer = request.buyer_id == user_id
        transaction = chat_session.transaction

        if transaction is None:
            # Still running, or it ended having cost nothing at all. A session
            # that cost nothing is not an event worth a row; one still running
            # is, because the buyer's money is sitting in it.
            if chat_session.closed_at is not None or not is_buyer:
                continue
            rows.append(
                HistoryRow(
                    kind=HistoryKind.CHAT_PAYMENT,
                    status=HistoryStatus.IN_PROGRESS,
                    amount_photons=-(chat_session.reserved_toman // rate),
                    at=chat_session.opened_at,
                    subject=offer.title,
                    chat_session_id=chat_session.id,
                )
            )
            continue

        rows.append(
            HistoryRow(
                kind=HistoryKind.CHAT_PAYMENT if is_buyer else HistoryKind.CHAT_EARNING,
                status=_status_of(transaction),
                amount_photons=(
                    -transaction.gross_price_photons
                    if is_buyer
                    else transaction.net_provider_photons
                ),
                at=chat_session.closed_at or chat_session.opened_at,
                subject=offer.title,
                chat_session_id=chat_session.id,
            )
        )

    # --- content -----------------------------------------------------------
    for transaction, content in (
        db.query(Transaction, Content)
        .join(Content, Transaction.content_id == Content.id)
        .filter(
            Transaction.kind == TransactionKind.CONTENT_PURCHASE,
            (Transaction.buyer_id == user_id) | (Transaction.provider_id == user_id),
        )
        .all()
    ):
        is_buyer = transaction.buyer_id == user_id
        # A buyer keeps what they paid for, so their row always leads
        # somewhere. A seller who deleted it cannot open it any more, so theirs
        # deliberately leads nowhere rather than to a dead end.
        reachable = is_buyer or content.deleted_at is None
        rows.append(
            HistoryRow(
                kind=HistoryKind.CONTENT_PURCHASE if is_buyer else HistoryKind.CONTENT_SALE,
                status=_status_of(transaction),
                amount_photons=(
                    -transaction.gross_price_photons
                    if is_buyer
                    else transaction.net_provider_photons
                ),
                at=transaction.created_at,
                content_id=content.id if reachable else None,
            )
        )

    rows.sort(key=lambda row: row.at, reverse=True)
    return rows


def purchased_content_ids(db: Session, user_id: int) -> set[int]:
    """Used by callers that need to know what this user already owns."""
    return {
        row.content_id
        for row in db.query(ContentPurchase.content_id)
        .filter(ContentPurchase.user_id == user_id)
        .all()
    }
