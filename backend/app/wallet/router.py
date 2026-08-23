"""
Wallet endpoints: checking your own balance.

The actual charge/pay logic lives in app/wallet/service.py and is used
by the request router (paying for a chat request) and the photo router
(buying a paid photo) — there is no generic "top up for real" endpoint
here yet; that's the manual card-to-card + admin review flow, deferred
to phase 2 (see TECHNICAL_REQUIREMENTS.md). The only way to add balance
right now is the dev-only stub in app/dev/router.py.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.core.config import settings
from app.core.database import get_db
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
        balance_stars_equivalent=balance_toman // settings.star_to_toman_rate,
        pending_toman=get_pending_provider_toman(db, current_user.id),
    )
