"""
Wallet endpoints: checking your own balance.

The actual charge/pay logic lives in app/wallet/service.py and is used
by the request router (paying for a chat request) and the content router
(buying paid content). Adding balance for real happens through the
card-to-card top-up flow (see app/topup/router.py); credit_topup() in
app/wallet/service.py is the only thing that writes a real TOPUP ledger
entry.
"""

from sqlalchemy import func
from app.models.withdrawal import Withdrawal

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.core.database import get_db
from app.core.rates import get_rates
from app.models.user import User
from app.wallet.history import build_history
from app.wallet.schemas import BalanceOut, WalletHistoryOut
from app.wallet.service import (
    get_balance_toman,
    get_buyer_in_flight_toman,
    get_pending_provider_toman,
    get_withdrawable_toman,
    release_due_chat_transactions,
)

def pending_withdrawals(db, user_id):
    return int(db.query(func.coalesce(func.sum(Withdrawal.gross_toman), 0)).filter(Withdrawal.user_id == user_id, Withdrawal.status.in_(["pending", "processing", "bank_pending"])).scalar())


router = APIRouter(prefix="/wallet", tags=["wallet"])


@router.get("/balance", response_model=BalanceOut)
def get_my_balance(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> BalanceOut:
    # Sweep first, so a balance check is what actually turns "earned but
    # held" into "spendable" once the grace period has passed — see
    # release_due_chat_transactions()'s docstring for why this replaces a
    # background job.
    release_due_chat_transactions(db, current_user.id)

    balance_toman = get_balance_toman(db, current_user.id)
    # The three kinds of "not available right now" are summed into one figure
    # for the UI; each is still individually visible in the wallet history.
    earned_but_held = get_pending_provider_toman(db, current_user.id)
    queued_withdrawals = pending_withdrawals(db, current_user.id)
    paid_but_unsettled = get_buyer_in_flight_toman(db, current_user.id)
    return BalanceOut(
        balance_toman=balance_toman,
        balance_photons_equivalent=balance_toman // get_rates(db).photon_to_toman_rate,
        pending_toman=earned_but_held,
        withdrawal_pending_toman=queued_withdrawals,
        in_flight_toman=earned_but_held + queued_withdrawals + paid_but_unsettled,
        withdrawable_toman=get_withdrawable_toman(db, current_user.id),
    )


@router.get("/history", response_model=list[WalletHistoryOut])
def wallet_history(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[WalletHistoryOut]:
    """
    What happened to this wallet, told as events rather than as ledger rows.

    See app/wallet/history.py for why those are not the same thing, and for the
    two rules behind what a row says: no names in it, and money that has not
    arrived yet still appears, marked as such.

    Filtering is left to the app: the list is small enough per person to send
    at once, and filtering it there costs nothing while a round trip per tap
    costs a visible pause.
    """
    # Reading the history is also a moment to let anything due settle, the
    # same lazy sweep the balance does.
    release_due_chat_transactions(db, current_user.id)
    rate = get_rates(db).photon_to_toman_rate
    return [
        WalletHistoryOut(
            kind=row.kind.value,
            status=row.status.value,
            amount_photons=row.amount_photons,
            amount_toman=row.amount_photons * rate,
            at=row.at,
            subject=row.subject,
            chat_session_id=row.chat_session_id,
            content_id=row.content_id,
        )
        for row in build_history(db, current_user.id, rate)
    ]
