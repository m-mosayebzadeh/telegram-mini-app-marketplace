"""
PlatformRates: the database-backed home for the financial constants that
used to live only in Settings (see app/core/config.py's "financial
settings" comment, which already predicted this move) — star-to-toman
rate and the two commission percentages. An admin with the
"finance.rates" scope can now edit these at runtime (see
app/admin/router.py) instead of needing a code change + redeploy.

Deliberately a SINGLETON table: exactly one row, always id=1, holding
every rate together — there's only ever one "current" set of platform
rates, not one per something else, so a single row is simpler to read
and update than a key/value table would be. get_rates() below creates
that row (from the old Settings defaults) the first time it's needed,
so existing databases don't need a data migration to keep working.

Editing a row here only changes what NEW transactions/top-ups use going
forward — every past Transaction/CreditLedgerEntry/TopUpRequest already
stored its own frozen rate/commission at the time it was created (see
each of those models), and that never changes retroactively.
"""

from datetime import datetime

from sqlalchemy import Integer
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.time import UTCDateTime, utcnow


class PlatformRates(Base):
    __tablename__ = "platform_rates"

    id: Mapped[int] = mapped_column(primary_key=True)

    star_to_toman_rate: Mapped[int] = mapped_column(Integer)
    chat_commission_percent: Mapped[int] = mapped_column(Integer)
    content_commission_percent: Mapped[int] = mapped_column(Integer)

    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)
