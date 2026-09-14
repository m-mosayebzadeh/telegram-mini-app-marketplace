"""Database-backed rates, and the lock every money operation passes through."""
from sqlalchemy import insert, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.platform_rates import PlatformRates

SINGLETON_ID = 1


def _defaults():
    """Seed values for the singleton row, used only when it does not exist yet.

    Purchase commissions come from Settings so a fresh database starts with the
    same numbers the app was configured with; the withdrawal commission starts
    at zero on purpose (see PlatformRates' docstring).
    """
    return dict(id=SINGLETON_ID, drop_to_toman_rate=settings.drop_to_toman_rate,
                chat_commission_percent=settings.chat_commission_percent,
                content_commission_percent=settings.content_commission_percent,
                withdrawal_commission_percent=0, complaint_commission_percent=0,
                minimum_withdrawal_toman=500_000,
                offer_expiry_days=7, request_expiry_hours=24)


def get_rates(db: Session) -> PlatformRates:
    """The current rates, creating the single row the first time it is needed.

    Two requests can reach this at once on an empty database, so the insert is
    allowed to lose that race: the loser rolls back to a savepoint and reads the
    row the winner committed. Written with a savepoint and a caught integrity
    error rather than an "on conflict do nothing", because that clause is
    spelled differently by every database and this code has to run on more than
    one.
    """
    rates = db.get(PlatformRates, SINGLETON_ID)
    if rates is not None:
        return rates

    # A nested transaction, so a failed insert does not poison the caller's —
    # which may well be half way through a money operation.
    try:
        with db.begin_nested():
            db.execute(insert(PlatformRates).values(**_defaults()))
    except IntegrityError:
        pass
    return db.get(PlatformRates, SINGLETON_ID)


def lock_finances(db: Session) -> None:
    """
    Serialise money and state changes through one row, until commit or rollback.

    Every balance is a sum over the ledger rather than a stored number, so two
    requests reading at the same time would both see funds that only one of
    them can have. Taking this lock BEFORE reading is what stops that.

    It is a row lock, not a process-local one: several workers, and several
    machines, have to queue behind the same thing. Whoever holds it keeps it
    until they commit or roll back, so a request cannot read a balance that
    another one is in the middle of spending.
    """
    get_rates(db)
    db.execute(select(PlatformRates.id).where(PlatformRates.id == SINGLETON_ID).with_for_update())

    db.expire_all()
    # Refresh authenticated actors before callers start assembling constrained
    # rows: their in-memory copies predate the lock and may be stale.
    from app.models.user import User

    for obj in list(db.identity_map.values()):
        if isinstance(obj, User):
            db.refresh(obj)
