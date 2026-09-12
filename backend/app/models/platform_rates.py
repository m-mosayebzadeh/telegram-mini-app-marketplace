"""Current financial settings. Historical operations retain their own snapshots.

A deliberate singleton (always id=1): there is only ever one "current" set of
platform rates, so one row is simpler to read and update than a key/value table.

Two families of rates live here, and they are charged at different moments:

- `chat_commission_percent` / `content_commission_percent` — the platform's
  actual revenue, taken out of a purchase. For a chat that happens only when
  the transaction is RELEASED (after the session closed cleanly and the grace
  period passed), never before the service was delivered; for content, which is
  delivered instantly, it happens at purchase time.
- `withdrawal_commission_percent` — charged when a provider cashes out to a
  bank account. Intentionally kept at 0: the lever exists so it can be turned
  on later without a schema change, but charging a user at the moment they
  collect their own earnings is a deliberately rejected product decision.

`complaint_commission_percent` is currently stored and editable but is not read
by any money calculation — a placeholder for a dispute-handling fee that has
not been designed yet.

Editing a row here only changes what NEW transactions/top-ups use going
forward — every past Transaction/CreditLedgerEntry/TopUpRequest already stored
its own frozen rate/commission at the time it was created (see each of those
models), and that never changes retroactively.
"""
from datetime import datetime
from sqlalchemy import Integer, CheckConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base
from app.core.time import UTCDateTime, utcnow

class PlatformRates(Base):
    __tablename__ = 'platform_rates'
    id: Mapped[int] = mapped_column(primary_key=True)
    star_to_toman_rate: Mapped[int] = mapped_column(Integer)
    chat_commission_percent: Mapped[int] = mapped_column(Integer, default=10)
    content_commission_percent: Mapped[int] = mapped_column(Integer, default=5)
    withdrawal_commission_percent: Mapped[int] = mapped_column(Integer, default=0)
    complaint_commission_percent: Mapped[int] = mapped_column(Integer, default=0)
    minimum_withdrawal_toman: Mapped[int] = mapped_column(Integer, default=500_000)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)
    __table_args__ = (
        CheckConstraint('star_to_toman_rate > 0 AND minimum_withdrawal_toman > 0', name='ck_positive_financial_rates'),
        CheckConstraint(
            'withdrawal_commission_percent BETWEEN 0 AND 100 AND complaint_commission_percent BETWEEN 0 AND 100',
            name='ck_financial_percentages',
        ),
        CheckConstraint(
            'chat_commission_percent BETWEEN 0 AND 100 AND content_commission_percent BETWEEN 0 AND 100',
            name='ck_purchase_commission_percentages',
        ),
    )
