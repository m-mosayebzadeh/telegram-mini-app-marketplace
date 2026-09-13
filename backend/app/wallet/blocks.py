"""
Block accounting for a chat session: reserving the money at the start, and
working out how much of it was actually used at the end.

The whole design rests on one decision — blocks advance on wall-clock time, not
on who is connected. A session is a booked slot, like an appointment: if either
side walks away, the time was still spent. That single choice is what removes
any need for presence tracking, a metering loop, or a scheduler, and it is why
everything below is plain arithmetic over `started_at`.

Money moves in two steps:

  start   the whole session price leaves the buyer's wallet as a HOLD, so the
          conversation can never die mid-way for lack of funds and the provider
          knows from the first second that the money is really there.
  close   whatever was not used goes straight back to the buyer, with nothing
          to wait for — nobody has a claim on it. What was used becomes a
          PENDING transaction and follows the existing settlement path.

See TECHNICAL_REQUIREMENTS.md section 15 for the product rules this implements.
"""
import math
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.core.config import SESSION_BLOCK_COUNT
from app.core.rates import get_rates, lock_finances
from app.core.time import utcnow
from app.models.chat_session import ChatSession, ChatSessionStatus
from app.models.credit_ledger import CreditLedgerEntry, LedgerEntryType
from app.models.offer import Offer
from app.models.transaction import Transaction, TransactionKind, TransactionStatus
from app.wallet.service import InsufficientBalanceError, get_balance_toman, split_commission


class EndReason:
    """Why a session stopped. The consumed-block rule differs for each, which
    is exactly why this is a stored value and not a free-text note."""

    #: Ran to the end of its last reserved block.
    COMPLETED = "completed"
    #: The buyer stopped early — they used part of the running block, so they
    #: pay for it.
    BUYER_CLOSED = "buyer_closed"
    #: The provider stopped early — they chose to cut the block short, so the
    #: buyer is not charged for it. Without this asymmetry a provider could
    #: take a block's money and leave immediately.
    PROVIDER_CLOSED = "provider_closed"
    #: The provider never arrived, so the clock never started. Fully refunded,
    #: automatically — there is nothing to judge, because no time was sold.
    #: Who closed it tells the two variants apart: empty means it ran out on
    #: its own, otherwise the provider came back and tidied it up.
    NOT_STARTED = "not_started"


def start_session(db: Session, *, request_id: int, offer: Offer, buyer_id: int) -> ChatSession:
    """
    Opens a session and reserves its whole price from the buyer's wallet.

    Reserving everything up front, rather than charging block by block, is a
    deliberate choice: four separate debits would each be a chance to fail, and
    a failure half way through a conversation is the worst possible moment.

    Does NOT commit — the caller does, so this can join a larger unit of work.
    """
    lock_finances(db)
    rate = get_rates(db).drop_to_toman_rate
    reserved_toman = offer.price_drops * rate

    balance = get_balance_toman(db, buyer_id)
    if balance < reserved_toman:
        raise InsufficientBalanceError(needed_toman=reserved_toman, available_toman=balance)

    # opened_at is when the money was reserved. The clock itself does not
    # start until the provider says something (see start_clock below).
    chat_session = ChatSession(
        request_id=request_id,
        reserved_blocks=SESSION_BLOCK_COUNT,
        block_duration_seconds=offer.block_duration_seconds,
        block_price_drops=offer.block_price_drops,
        block_price_toman=offer.block_price_drops * rate,
        reserved_toman=reserved_toman,
        opened_at=utcnow(),
    )
    db.add(chat_session)
    db.flush()

    db.add(
        CreditLedgerEntry(
            user_id=buyer_id,
            amount_toman=-reserved_toman,
            type=LedgerEntryType.SESSION_HOLD,
            chat_session_id=chat_session.id,
        )
    )
    return chat_session


def total_duration_seconds(chat_session: ChatSession) -> int:
    """The whole session's length, as it was sold."""
    return chat_session.block_duration_seconds * chat_session.reserved_blocks


def start_clock(db: Session, chat_session: ChatSession) -> None:
    """Starts the session, on the provider's first message.

    Called from the message route rather than from a timer, which is the whole
    point: the session begins when the provider actually arrives, so the buyer
    never pays for the wait and a provider who never comes costs them nothing.

    Does NOT commit.
    """
    if chat_session.started_at is not None:
        return
    now = utcnow()
    chat_session.started_at = now
    chat_session.scheduled_end_at = now + timedelta(seconds=total_duration_seconds(chat_session))


def elapsed_blocks(chat_session: ChatSession, at: datetime) -> int:
    """How many blocks have been entered by `at` — the running one counted."""
    if chat_session.block_duration_seconds <= 0 or chat_session.started_at is None:
        return 0
    seconds = max(0.0, (at - chat_session.started_at).total_seconds())
    # At least one: the first block starts the instant the session does, so a
    # buyer who closes immediately has still used it.
    return min(
        chat_session.reserved_blocks,
        max(1, math.ceil(seconds / chat_session.block_duration_seconds)),
    )


def completed_blocks(chat_session: ChatSession, at: datetime) -> int:
    """How many blocks have finished by `at` — the running one excluded."""
    if chat_session.block_duration_seconds <= 0 or chat_session.started_at is None:
        return 0
    seconds = max(0.0, (at - chat_session.started_at).total_seconds())
    return min(
        chat_session.reserved_blocks,
        int(seconds // chat_session.block_duration_seconds),
    )


def consumed_blocks_for(chat_session: ChatSession, *, reason: str, at: datetime) -> int:
    """
    The asymmetric rule, in one place.

    A block that finished is always the provider's — whoever closed, that time
    was spent. Only the block still running is decided by WHO stopped it: the
    buyer used part of it and pays; the provider cut it short and does not get
    to keep it.
    """
    if reason == EndReason.NOT_STARTED:
        return 0
    if reason == EndReason.COMPLETED:
        return chat_session.reserved_blocks
    if reason == EndReason.PROVIDER_CLOSED:
        return completed_blocks(chat_session, at)
    return elapsed_blocks(chat_session, at)


def close_and_settle(
    db: Session, chat_session: ChatSession, *, reason: str, closed_by_user_id: int | None, at: datetime
) -> ChatSession:
    """
    Closes a session, hands back everything unused, and records what was used.

    The unused part is returned immediately and unconditionally: nobody has a
    claim on money for time that was never sold, so holding it through a
    settlement window would only punish the buyer for stopping early.

    What WAS used becomes a PENDING transaction, which then follows the same
    settlement path as before — a grace period, either side able to freeze it,
    and release once it passes.

    Does NOT commit.
    """
    lock_finances(db)
    if chat_session.status != ChatSessionStatus.OPEN:
        return chat_session

    request = chat_session.request
    offer = request.offer
    consumed_blocks = consumed_blocks_for(chat_session, reason=reason, at=at)
    consumed_toman = consumed_blocks * chat_session.block_price_toman
    released_toman = chat_session.reserved_toman - consumed_toman

    chat_session.status = ChatSessionStatus.CLOSED
    chat_session.closed_at = at
    chat_session.closed_by_user_id = closed_by_user_id
    chat_session.end_reason = reason
    chat_session.consumed_blocks = consumed_blocks
    chat_session.consumed_toman = consumed_toman
    chat_session.released_toman = released_toman

    if released_toman > 0:
        db.add(
            CreditLedgerEntry(
                user_id=request.buyer_id,
                amount_toman=released_toman,
                type=LedgerEntryType.SESSION_HOLD_RELEASE,
                chat_session_id=chat_session.id,
            )
        )

    if consumed_toman > 0:
        rate = get_rates(db).drop_to_toman_rate
        commission_rate = get_rates(db).chat_commission_percent
        consumed_drops = consumed_blocks * chat_session.block_price_drops
        commission_drops, net_drops = split_commission(consumed_drops, commission_rate)
        transaction = Transaction(
            kind=TransactionKind.CHAT_REQUEST,
            buyer_id=request.buyer_id,
            provider_id=offer.provider_id,
            request_id=request.id,
            gross_price_drops=consumed_drops,
            commission_rate_percent=commission_rate,
            commission_drops=commission_drops,
            net_provider_drops=net_drops,
            drop_to_toman_rate=rate,
            gross_price_toman=consumed_toman,
            commission_toman=commission_drops * rate,
            net_provider_toman=net_drops * rate,
            # The buyer was already debited by the hold, so no SPEND entry is
            # written here; only the provider's side is still outstanding.
            status=TransactionStatus.PENDING,
        )
        db.add(transaction)
        db.flush()
        chat_session.transaction_id = transaction.id

    return chat_session


def due_end(chat_session: ChatSession) -> datetime:
    """
    When this session is due to stop.

    A session that never started still expires — after the length it was sold
    as. Reusing the session's own duration avoids inventing a second number
    nobody has been told about, and it means a forgotten reservation cleans
    itself up instead of sitting on the buyer's money indefinitely.
    """
    if chat_session.started_at is None:
        return chat_session.opened_at + timedelta(seconds=total_duration_seconds(chat_session))
    if chat_session.close_at_block_end_by_user_id is None:
        return chat_session.scheduled_end_at
    block_end = chat_session.started_at + timedelta(
        seconds=chat_session.block_duration_seconds * elapsed_blocks(chat_session, utcnow())
    )
    return min(block_end, chat_session.scheduled_end_at)


def close_if_due(db: Session, chat_session: ChatSession) -> ChatSession:
    """
    Closes a session whose time is up, at the moment someone looks at it.

    This is the lazy sweep that replaces a background job, the same pattern the
    wallet already uses to release due transactions: nothing ticks, and the
    state is simply correct whenever it is next read.
    """
    if chat_session.status != ChatSessionStatus.OPEN:
        return chat_session
    end = due_end(chat_session)
    if utcnow() < end:
        return chat_session

    # Never started means the provider never arrived: nothing was sold, so
    # every Drop goes back to the buyer.
    reason = EndReason.COMPLETED if chat_session.started_at is not None else EndReason.NOT_STARTED
    close_and_settle(db, chat_session, reason=reason, closed_by_user_id=None, at=end)
    db.commit()
    db.refresh(chat_session)
    return chat_session
