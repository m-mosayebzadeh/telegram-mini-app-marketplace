"""
Wallet endpoints: checking your own balance.

The actual charge/pay logic lives in app/wallet/service.py and is used
by the request router (paying for a chat request) and the content router
(buying paid content). Adding balance for real happens through the
card-to-card top-up flow (see app/topup/router.py); credit_topup() in
app/wallet/service.py is the only thing that writes a real TOPUP ledger
entry.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.core.database import get_db
from app.core.rates import get_rates
from app.models.user import User
from app.wallet.schemas import BalanceOut
from app.wallet.service import (
    get_balance_toman,
    get_pending_provider_toman,
    release_due_chat_transactions,
)

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
    return BalanceOut(
        balance_toman=balance_toman,
        balance_stars_equivalent=balance_toman // get_rates(db).star_to_toman_rate,
        pending_toman=get_pending_provider_toman(db, current_user.id),
    )
