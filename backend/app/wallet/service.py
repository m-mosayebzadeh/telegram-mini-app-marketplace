"""
Wallet service: the shared logic behind every place money actually
moves in this app (paying for a chat request, buying content). Kept in
one place so "charge the buyer, pay the provider their net share, take
a commission" is implemented exactly once, not copy-pasted into every
router that needs it — see TECHNICAL_REQUIREMENTS.md, "مدل مالی و اعتبار".
"""

from datetime import timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.time import utcnow
from app.models.chat_session import ChatSession, ChatSessionStatus
from app.models.credit_ledger import CreditLedgerEntry, LedgerEntryType
from app.models.transaction import Transaction, TransactionKind, TransactionStatus


class InsufficientBalanceError(Exception):
    """
    Raised when a buyer's wallet doesn't cover the price of what they're
    trying to pay for. Callers (the request/content routers) catch this
    and turn it into an HTTP 402 response.
    """

    def __init__(self, *, needed_toman: int, available_toman: int) -> None:
        self.needed_toman = needed_toman
        self.available_toman = available_toman
        super().__init__(
            f"Insufficient balance: need {needed_toman} Toman, have {available_toman}."
        )


def get_balance_toman(db: Session, user_id: int) -> int:
    """
    A user's spendable wallet balance: the sum of every ledger entry
    that belongs to them. Never stored as a single mutable number — see
    app/models/credit_ledger.py for why. coalesce(..., 0) handles a
    brand-new user with no entries yet (SUM of nothing is NULL, not 0).
    """
    total = (
        db.query(func.coalesce(func.sum(CreditLedgerEntry.amount_toman), 0))
        .filter(CreditLedgerEntry.user_id == user_id)
        .scalar()
    )
    return int(total)


def split_commission(gross_price_stars: int, commission_rate_percent: int) -> tuple[int, int]:
    """
    Splits a Star price into (commission_stars, net_provider_stars).

    Stars are a whole unit — there's no such thing as half a Star — so a
    percentage that doesn't divide evenly (e.g. 10% of 25 Stars = 2.5)
    has to be rounded somehow. We always round the commission DOWN
    (plain integer floor division), so any fractional Star that rounding
    would otherwise lose always ends up on the provider's side, never
    the platform's — a provider is never shortchanged by a rounding rule
    they have no say in. This also guarantees
    commission_stars + net_provider_stars always equals gross_price_stars
    exactly (enforced again at the database level — see Transaction's
    ck_star_split_sums_to_gross).
    """
    commission_stars = (gross_price_stars * commission_rate_percent) // 100
    net_provider_stars = gross_price_stars - commission_stars
    return commission_stars, net_provider_stars


def pay_for_item(
    db: Session,
    *,
    kind: TransactionKind,
    buyer_id: int,
    provider_id: int,
    gross_price_stars: int,
    commission_rate_percent: int,
    request_id: int | None = None,
    content_id: int | None = None,
) -> Transaction:
    """
    Charges `buyer_id` the full price, right now, no matter what `kind`
    is — that part never waits. What happens to the provider's side
    depends on `kind`:

      - CONTENT_PURCHASE: settles immediately. Delivery is instant and
        verifiable (the buyer gets the file right away), so there's
        nothing to wait on — the provider's net share and the platform's
        commission are both credited in the same breath as the charge.
      - CHAT_REQUEST: settles later. The provider's net share and the
        commission are deliberately NOT turned into ledger entries yet —
        the Transaction is created PENDING, holding those amounts, until
        release_transaction() is called (once the chat session this
        paid for actually closes cleanly — not built yet, see that
        function's docstring). This is the "idle money" model from
        TECHNICAL_REQUIREMENTS.md: a provider is never paid out for a
        service nothing has confirmed actually happened.

    Always writes one Transaction row, plus a SPEND ledger entry for the
    buyer; a CONTENT_PURCHASE additionally gets its RECEIVE and COMMISSION
    entries immediately, a CHAT_REQUEST gets them later via
    release_transaction().

    Raises InsufficientBalanceError, without writing anything, if the
    buyer's wallet doesn't cover the price.

    Does NOT commit — the caller commits (and should db.refresh() the
    returned Transaction afterwards), so this can take part in a larger
    unit of work later without an awkward nested transaction.
    """
    commission_stars, net_provider_stars = split_commission(
        gross_price_stars, commission_rate_percent
    )
    rate = settings.star_to_toman_rate
    gross_toman = gross_price_stars * rate
    commission_toman = commission_stars * rate
    net_toman = net_provider_stars * rate

    balance = get_balance_toman(db, buyer_id)
    if balance < gross_toman:
        raise InsufficientBalanceError(needed_toman=gross_toman, available_toman=balance)

    settles_immediately = kind == TransactionKind.CONTENT_PURCHASE

    transaction = Transaction(
        kind=kind,
        buyer_id=buyer_id,
        provider_id=provider_id,
        request_id=request_id,
        content_id=content_id,
        gross_price_stars=gross_price_stars,
        commission_rate_percent=commission_rate_percent,
        commission_stars=commission_stars,
        net_provider_stars=net_provider_stars,
        star_to_toman_rate=rate,
        gross_price_toman=gross_toman,
        commission_toman=commission_toman,
        net_provider_toman=net_toman,
        status=TransactionStatus.SUCCEEDED if settles_immediately else TransactionStatus.PENDING,
    )
    db.add(transaction)
    db.flush()  # assigns transaction.id, without committing yet

    # The buyer is charged the instant they pay, regardless of `kind` —
    # only the PROVIDER's side (and the platform's cut) ever waits.
    db.add(
        CreditLedgerEntry(
            user_id=buyer_id,
            amount_toman=-gross_toman,
            type=LedgerEntryType.SPEND,
            transaction_id=transaction.id,
        )
    )

    if settles_immediately:
        _credit_provider_and_commission(db, transaction)

    return transaction


def _credit_provider_and_commission(db: Session, transaction: Transaction) -> None:
    """
    Writes the two ledger entries that actually pay someone out of a
    Transaction: the provider's net share, and the platform's
    commission. Shared by pay_for_item() (for a CONTENT_PURCHASE, which
    settles immediately) and release_transaction() below (for a
    CHAT_REQUEST, once its session closes) — the money movement itself
    is identical either way, only the timing differs.
    """
    db.add(
        CreditLedgerEntry(
            user_id=transaction.provider_id,
            amount_toman=transaction.net_provider_toman,
            type=LedgerEntryType.RECEIVE,
            transaction_id=transaction.id,
        )
    )
    db.add(
        CreditLedgerEntry(
            # No user: this entry is platform commission revenue, not
            # money owed to anyone's spendable wallet (see
            # ck_commission_entries_have_no_user on CreditLedgerEntry).
            user_id=None,
            amount_toman=transaction.commission_toman,
            type=LedgerEntryType.COMMISSION,
            transaction_id=transaction.id,
        )
    )


def release_transaction(db: Session, transaction: Transaction) -> None:
    """
    Moves a PENDING CHAT_REQUEST transaction's held funds to their final
    destination: the provider's net share becomes spendable, and the
    platform collects its commission — via the exact same
    _credit_provider_and_commission() a CONTENT_PURCHASE gets immediately.

    Does NOT commit (same convention as pay_for_item — caller commits).
    Callers must check transaction.status == PENDING themselves before
    calling this; calling it twice on an already-released transaction
    would double-pay the provider, since there's no guard here against
    that (deliberately — this is an internal building block, not a route
    handler with its own validation). See release_due_chat_transactions()
    below for the actual policy of WHEN a transaction becomes releasable.
    """
    transaction.status = TransactionStatus.SUCCEEDED
    _credit_provider_and_commission(db, transaction)


def release_due_chat_transactions(db: Session, provider_id: int) -> None:
    """
    The grace-period auto-release: a PENDING CHAT_REQUEST transaction
    becomes releasable once its chat session has been CLOSED for at
    least settings.chat_release_grace_hours, as long as nobody flagged
    it (Transaction.disputed_at) in the meantime — mirroring how
    real-world platforms handle this exact situation (e.g. Upwork
    auto-releases if the buyer takes no action; Clarity.fm holds an
    expert's call payment for a fixed window before payout).

    Deliberately NOT a scheduled/background job — there's no cron here,
    and TECHNICAL_REQUIREMENTS.md is explicit that sessions themselves
    never auto-close on a timer. Instead this runs lazily, called from
    GET /wallet/balance (see app/wallet/router.py) every time a provider
    checks their balance, since that's exactly the moment "is this
    actually spendable yet" needs to be accurate. A provider who never
    checks their balance just sees the release happen the next time they
    do — nothing breaks by not calling this promptly.

    Commits its own changes (unlike pay_for_item/release_transaction) —
    this is a self-contained sweep, not a step inside a larger unit of
    work the caller is assembling.
    """
    cutoff = utcnow() - timedelta(hours=settings.chat_release_grace_hours)

    due_transactions = (
        db.query(Transaction)
        .join(ChatSession, ChatSession.transaction_id == Transaction.id)
        .filter(
            Transaction.provider_id == provider_id,
            Transaction.kind == TransactionKind.CHAT_REQUEST,
            Transaction.status == TransactionStatus.PENDING,
            Transaction.disputed_at.is_(None),
            ChatSession.status == ChatSessionStatus.CLOSED,
            ChatSession.closed_at <= cutoff,
        )
        .all()
    )
    for transaction in due_transactions:
        release_transaction(db, transaction)

    if due_transactions:
        db.commit()


def credit_topup(db: Session, *, user_id: int, amount_toman: int) -> CreditLedgerEntry:
    """
    Writes a real TOPUP ledger entry — called only from
    app/topup/router.py's admin-approve endpoint, once an admin has
    confirmed a card-to-card transfer actually happened. Unlike
    pay_for_item(), this doesn't touch a Transaction at all (see
    CreditLedgerEntry's ck_topup_entries_have_no_transaction) — a top-up
    isn't a marketplace purchase, it's money entering the ledger for the
    first time.

    Does NOT commit — the caller (the approve endpoint) commits together
    with the TopUpRequest status change, so the two never happen as two
    separate, out-of-sync writes.
    """
    entry = CreditLedgerEntry(
        user_id=user_id,
        amount_toman=amount_toman,
        type=LedgerEntryType.TOPUP,
    )
    db.add(entry)
    return entry


def get_pending_provider_toman(db: Session, provider_id: int) -> int:
    """
    How much `provider_id` is currently owed from PENDING CHAT_REQUEST
    transactions — earned but not yet released (see
    release_transaction()). Shown alongside the spendable balance (see
    BalanceOut) so a provider can tell "how much can I actually spend
    right now" apart from "how much have I earned that's still waiting."
    """
    total = (
        db.query(func.coalesce(func.sum(Transaction.net_provider_toman), 0))
        .filter(
            Transaction.provider_id == provider_id,
            Transaction.status == TransactionStatus.PENDING,
        )
        .scalar()
    )
    return int(total)
