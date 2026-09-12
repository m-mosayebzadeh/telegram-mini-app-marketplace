"""Bank destinations and immutable withdrawal snapshots; amounts are Toman."""
from datetime import datetime
from sqlalchemy import String, Integer, ForeignKey, CheckConstraint, UniqueConstraint, JSON
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base
from app.core.time import UTCDateTime, utcnow

class BankAccount(Base):
    __tablename__ = 'bank_accounts'
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id'), index=True)
    holder_name: Mapped[str] = mapped_column(String(128))
    card_number: Mapped[str] = mapped_column(String(16))
    iban: Mapped[str] = mapped_column(String(26))
    is_active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

class Withdrawal(Base):
    __tablename__ = 'withdrawals'
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id'), index=True)
    bank_account_id: Mapped[int] = mapped_column(ForeignKey('bank_accounts.id'))
    idempotency_key: Mapped[str] = mapped_column(String(64))
    holder_name: Mapped[str] = mapped_column(String(128))
    card_number: Mapped[str] = mapped_column(String(16))
    iban: Mapped[str] = mapped_column(String(26))
    stars: Mapped[int] = mapped_column(Integer)
    star_rate: Mapped[int] = mapped_column(Integer)
    fee_percent: Mapped[int] = mapped_column(Integer)
    minimum_toman: Mapped[int] = mapped_column(Integer)
    gross_toman: Mapped[int] = mapped_column(Integer)
    fee_toman: Mapped[int] = mapped_column(Integer)
    net_toman: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(24), default='pending', index=True)
    assigned_to_user_id: Mapped[int | None] = mapped_column(ForeignKey('users.id'), nullable=True)
    reference: Mapped[str | None] = mapped_column(String(128), nullable=True)
    reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)
    __table_args__ = (
        UniqueConstraint('user_id', 'idempotency_key', name='uq_withdrawal_retry'),
        CheckConstraint("status IN ('pending','processing','bank_pending','paid','rejected','failed','cancelled')", name='ck_withdrawal_status'),
        CheckConstraint('stars > 0 AND star_rate > 0 AND gross_toman = stars * star_rate AND fee_toman >= 0 AND net_toman > 0 AND fee_toman + net_toman = gross_toman', name='ck_withdrawal_amounts'),
        CheckConstraint("status != 'paid' OR (reference IS NOT NULL AND length(trim(reference)) > 0)", name='ck_withdrawal_paid_reference'),
    )

class WithdrawalEvent(Base):
    __tablename__ = 'withdrawal_events'
    id: Mapped[int] = mapped_column(primary_key=True)
    withdrawal_id: Mapped[int] = mapped_column(ForeignKey('withdrawals.id'), index=True)
    actor_id: Mapped[int] = mapped_column(ForeignKey('users.id'))
    status: Mapped[str] = mapped_column(String(24))
    reference: Mapped[str | None] = mapped_column(String(128), nullable=True)
    reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
