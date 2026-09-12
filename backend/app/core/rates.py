"""Database-backed rates and transaction-scoped financial serialization."""
from sqlalchemy import update
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.orm import Session
from app.core.config import settings
from app.models.platform_rates import PlatformRates

SINGLETON_ID = 1

def _defaults():
    return dict(id=1, star_to_toman_rate=settings.star_to_toman_rate,
                withdrawal_commission_percent=10, complaint_commission_percent=0,
                minimum_withdrawal_toman=500_000)

def get_rates(db: Session) -> PlatformRates:
    rates = db.get(PlatformRates, SINGLETON_ID)
    if rates is None:
        # Do not commit here: callers may be in the middle of a money operation.
        db.execute(insert(PlatformRates).values(**_defaults()).on_conflict_do_nothing(index_elements=['id']))
        rates = db.get(PlatformRates, SINGLETON_ID)
    return rates

def lock_finances(db: Session) -> None:
    """Serialize money/state changes through one database row until commit/rollback.

    SQLite (the deployed database) has one writer. Acquiring its write lock
    BEFORE reading balances prevents concurrent debits using the same funds.
    The row update is also a row lock on engines that support concurrent writers.
    Never use a process-local mutex: multiple workers must share this lock.
    """
    get_rates(db)
    db.execute(update(PlatformRates).where(PlatformRates.id == 1).values(id=1, updated_at=PlatformRates.updated_at),
               execution_options={'synchronize_session': False})
    db.expire_all()
    # Refresh authenticated actors before callers start assembling constrained rows.
    from app.models.user import User
    for obj in list(db.identity_map.values()):
        if isinstance(obj, User):
            db.refresh(obj)
