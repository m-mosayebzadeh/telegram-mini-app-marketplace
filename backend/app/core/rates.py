"""
get_rates(): the one place every call site reads the current platform
financial rates from — see app/models/platform_rates.py's docstring for
why this is a lazily-created singleton row instead of a migration-time
data seed (simpler: works the same on a brand-new database and on every
existing one, with no special-casing).
"""

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.platform_rates import PlatformRates

SINGLETON_ID = 1


def get_rates(db: Session) -> PlatformRates:
    rates = db.get(PlatformRates, SINGLETON_ID)
    if rates is None:
        rates = PlatformRates(
            id=SINGLETON_ID,
            star_to_toman_rate=settings.star_to_toman_rate,
            chat_commission_percent=settings.chat_commission_percent,
            content_commission_percent=settings.content_commission_percent,
        )
        db.add(rates)
        db.commit()
        db.refresh(rates)
    return rates
