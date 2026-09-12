"""Withdrawal quote, wallet reservation, and staff-controlled bank settlement."""
import hashlib
import hmac
import json
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.auth.dependencies import get_current_user, require_admin, is_owner
from app.core.config import settings
from app.core.database import get_db
from app.core.rates import get_rates, lock_finances
from app.models.user import User
from app.models.withdrawal import BankAccount, Withdrawal, WithdrawalEvent
from app.models.credit_ledger import CreditLedgerEntry, LedgerEntryType
from app.wallet.service import get_balance_toman, get_withdrawable_toman
from app.withdrawal.schemas import BankInput, BankOut, QuoteInput, WithdrawalInput, WithdrawalOut, ReviewInput

router = APIRouter(prefix='/wallet', tags=['withdrawals'])
admin_router = APIRouter(prefix='/admin/withdrawals', tags=['admin-withdrawals'])

def fail(reason, code=409, **extra):
    raise HTTPException(code, {'reason': reason, **extra})

def quote(db, stars, user_id):
    """Price one withdrawal, and sign it so the rates cannot drift underneath.

    `withdrawable_toman` rides along purely for display: it is what this user
    may cash out right now (earnings only — see get_withdrawable_toman), and
    it is deliberately NOT part of the signed snapshot, because the ceiling
    moves as money is earned or spent and is re-checked at creation time.
    """
    rates = get_rates(db)
    gross = stars * rates.star_to_toman_rate
    if gross > 9_007_199_254_740_991:
        fail("amount_too_large", 400)
    fee = gross * rates.withdrawal_commission_percent // 100
    values = dict(stars=stars, star_rate=rates.star_to_toman_rate,
                  fee_percent=rates.withdrawal_commission_percent,
                  minimum_toman=rates.minimum_withdrawal_toman,
                  gross_toman=gross, fee_toman=fee, net_toman=gross-fee)
    message = json.dumps([user_id, values], sort_keys=True).encode()
    token = hmac.new(settings.telegram_bot_token.encode(), message, hashlib.sha256).hexdigest()
    return {**values, 'quote_token': token, 'withdrawable_toman': get_withdrawable_toman(db, user_id)}

@router.get('/bank-accounts', response_model=list[BankOut])
def banks(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(BankAccount).filter_by(user_id=user.id, is_active=True).order_by(BankAccount.id.desc()).all()

@router.post('/bank-accounts', response_model=BankOut, status_code=201)
def add_bank(payload: BankInput, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    bank = BankAccount(user_id=user.id, **payload.model_dump())
    db.add(bank)
    db.commit()
    db.refresh(bank)
    return bank

def own_bank(db, bank_id, user_id):
    bank = db.get(BankAccount, bank_id)
    if not bank or bank.user_id != user_id or not bank.is_active:
        fail('bank_not_found', 404)
    return bank

@router.put('/bank-accounts/{bank_id}', response_model=BankOut)
def edit_bank(bank_id: int, payload: BankInput, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    lock_finances(db)
    bank = own_bank(db, bank_id, user.id)
    for key, value in payload.model_dump().items():
        setattr(bank, key, value)
    db.commit()
    db.refresh(bank)
    return bank

@router.delete('/bank-accounts/{bank_id}', status_code=204)
def delete_bank(bank_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    lock_finances(db)
    bank = own_bank(db, bank_id, user.id)
    bank.is_active = False
    db.commit()

@router.post('/withdrawals/quote')
def preview(payload: QuoteInput, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return quote(db, payload.stars, user.id)

@router.post('/withdrawals', response_model=WithdrawalOut, status_code=201)
def create_withdrawal(payload: WithdrawalInput, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    lock_finances(db)
    existing = db.query(Withdrawal).filter_by(user_id=user.id, idempotency_key=payload.idempotency_key).first()
    if existing:
        if existing.stars != payload.stars or existing.bank_account_id != payload.bank_account_id:
            fail('retry_mismatch')
        return existing
    bank = own_bank(db, payload.bank_account_id, user.id)
    values = quote(db, payload.stars, user.id)
    if not hmac.compare_digest(values['quote_token'], payload.quote_token):
        fail('quote_changed', quote=values)
    values.pop('quote_token')
    withdrawable = values.pop('withdrawable_toman')
    if values['gross_toman'] < values['minimum_toman']:
        fail('below_minimum', 400)
    if values['net_toman'] <= 0:
        fail('invalid_net_amount', 400)
    if get_balance_toman(db, user.id) < values['gross_toman']:
        fail('insufficient_balance', 402)
    # Only earned money leaves the platform. The ceiling is re-read here, under
    # the finance lock, rather than trusted from the quote the client sent.
    if values['gross_toman'] > withdrawable:
        fail('exceeds_withdrawable', 400, withdrawable_toman=withdrawable)
    withdrawal = Withdrawal(user_id=user.id, bank_account_id=bank.id,
        idempotency_key=payload.idempotency_key, holder_name=bank.holder_name,
        card_number=bank.card_number, iban=bank.iban, status='pending', **values)
    db.add(withdrawal)
    db.flush()
    db.add(CreditLedgerEntry(user_id=user.id, amount_toman=-withdrawal.gross_toman,
                            type=LedgerEntryType.WITHDRAWAL, withdrawal_id=withdrawal.id))
    db.add(WithdrawalEvent(withdrawal_id=withdrawal.id, actor_id=user.id, status='pending'))
    db.commit()
    db.refresh(withdrawal)
    return withdrawal

@router.get('/withdrawals', response_model=list[WithdrawalOut])
def mine(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(Withdrawal).filter_by(user_id=user.id).order_by(Withdrawal.id.desc()).all()

def release_hold(db, row):
    db.add(CreditLedgerEntry(user_id=row.user_id, amount_toman=row.gross_toman,
                            type=LedgerEntryType.WITHDRAWAL_REFUND, withdrawal_id=row.id))

@router.post('/withdrawals/{withdrawal_id}/cancel', response_model=WithdrawalOut)
def cancel(withdrawal_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    lock_finances(db)
    row = db.get(Withdrawal, withdrawal_id)
    if not row or row.user_id != user.id:
        fail('withdrawal_not_found', 404)
    if row.status != 'pending':
        fail('withdrawal_not_pending')
    row.status = 'cancelled'
    release_hold(db, row)
    db.add(WithdrawalEvent(withdrawal_id=row.id, actor_id=user.id, status='cancelled'))
    db.commit()
    db.refresh(row)
    return row

@admin_router.get('', response_model=list[WithdrawalOut])
def queue(status: str | None = None, user: User = Depends(require_admin('finance.withdrawals')), db: Session = Depends(get_db)):
    query = db.query(Withdrawal)
    if status:
        query = query.filter_by(status=status)
    return query.order_by(Withdrawal.id.desc()).all()

@admin_router.post('/{withdrawal_id}/review', response_model=WithdrawalOut)
def review(withdrawal_id: int, payload: ReviewInput, user: User = Depends(require_admin('finance.withdrawals')), db: Session = Depends(get_db)):
    lock_finances(db)
    row = db.get(Withdrawal, withdrawal_id)
    if not row:
        fail('withdrawal_not_found', 404)
    allowed = {'pending': {'processing', 'rejected'}, 'processing': {'paid', 'bank_pending', 'failed'},
               'bank_pending': {'paid', 'failed'}}
    if payload.action not in allowed.get(row.status, set()):
        fail('invalid_withdrawal_transition')
    if row.assigned_to_user_id and row.assigned_to_user_id != user.id and not is_owner(user):
        fail('assigned_to_other_staff')
    reference = (payload.reference or '').strip() or row.reference
    reason = (payload.reason or '').strip() or None
    if payload.action == 'paid' and not reference:
        fail('reference_required', 400)
    if payload.action in {'rejected', 'failed', 'bank_pending'} and not reason:
        fail('reason_required', 400)
    row.status = payload.action
    row.assigned_to_user_id = user.id
    row.reference = reference
    row.reason = reason
    if row.status in {'rejected', 'failed'}:
        release_hold(db, row)
    elif row.status == 'paid':
        db.add(CreditLedgerEntry(user_id=None, amount_toman=row.fee_toman,
                                type=LedgerEntryType.COMMISSION, withdrawal_id=row.id))
    db.add(WithdrawalEvent(withdrawal_id=row.id, actor_id=user.id, status=row.status,
                           reference=reference, reason=reason))
    db.commit()
    db.refresh(row)
    return row
