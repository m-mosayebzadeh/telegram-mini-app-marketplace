"""Current financial settings. Historical operations retain their own snapshots."""
from datetime import datetime
from sqlalchemy import Integer, CheckConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base
from app.core.time import UTCDateTime, utcnow

class PlatformRates(Base):
    __tablename__ = 'platform_rates'
    id: Mapped[int] = mapped_column(primary_key=True)
    star_to_toman_rate: Mapped[int] = mapped_column(Integer)
    withdrawal_commission_percent: Mapped[int] = mapped_column(Integer, default=10)
    complaint_commission_percent: Mapped[int] = mapped_column(Integer, default=0)
    minimum_withdrawal_toman: Mapped[int] = mapped_column(Integer, default=500_000)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)
    __table_args__ = (
        CheckConstraint('star_to_toman_rate > 0 AND minimum_withdrawal_toman > 0', name='ck_positive_financial_rates'),
        CheckConstraint('withdrawal_commission_percent BETWEEN 0 AND 100 AND complaint_commission_percent BETWEEN 0 AND 100', name='ck_financial_percentages'),
    )
