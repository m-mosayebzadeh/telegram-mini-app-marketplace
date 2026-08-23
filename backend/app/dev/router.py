"""
Developer-only routes. NEVER include this router unless
settings.enable_dev_tools is True (see app/main.py) — see the warning in
app/core/config.py for why.

Right now this only holds one endpoint: a way to mint a validly-signed
fake Telegram initData string, so we can test auth-protected endpoints
(via Bruno, curl, etc.) without a real Telegram client. It replaces what
used to be a standalone script (scripts/generate_test_init_data.py) —
as an endpoint, tools like Bruno can call it directly and use the result,
instead of us copy-pasting a value by hand.
"""

import hashlib
import hmac
import json
import time
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.core.config import settings
from app.core.database import get_db
from app.models.credit_ledger import CreditLedgerEntry, LedgerEntryType
from app.models.user import User
from app.wallet.service import get_balance_toman

router = APIRouter(prefix="/dev", tags=["dev-tools (local only)"])


def _require_localhost(request: Request) -> None:
    """
    Extra safety net on top of the enable_dev_tools flag: even when dev
    tools are on, only allow this from the machine running the server.

    We return 404 (not 403) so a probing outsider can't even tell this
    route exists.
    """
    client_host = request.client.host if request.client else None
    if client_host not in {"127.0.0.1", "::1"}:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)


class TestInitDataResponse(BaseModel):
    init_data: str


@router.get("/test-init-data", response_model=TestInitDataResponse)
def generate_test_init_data(
    request: Request,
    telegram_id: int = 111222333,
    first_name: str = "Sara",
    username: str | None = "sara_dev",
) -> TestInitDataResponse:
    _require_localhost(request)

    user = {"id": telegram_id, "first_name": first_name}
    if username:
        user["username"] = username

    fields = {
        "auth_date": str(int(time.time())),
        "query_id": "AAFakeQueryId",
        "user": json.dumps(user, separators=(",", ":")),
    }

    # Same signing steps as validate_init_data in app/auth/telegram.py,
    # just run in reverse: there we check a signature, here we produce
    # one. Kept as a self-contained copy (not imported from telegram.py)
    # so the production auth module has zero knowledge of test-data
    # generation.
    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(fields.items()))
    secret_key = hmac.new(
        b"WebAppData", settings.telegram_bot_token.encode(), hashlib.sha256
    ).digest()
    fields["hash"] = hmac.new(
        secret_key, data_check_string.encode(), hashlib.sha256
    ).hexdigest()

    # urlencode percent-encodes each value (the "user" field is JSON, full
    # of characters like { " : that aren't safe raw in a query string) —
    # this matches how real Telegram initData is actually formatted.
    init_data = urlencode(fields)
    return TestInitDataResponse(init_data=init_data)


class WalletTopUpRequest(BaseModel):
    amount_toman: int = Field(gt=0)


class WalletTopUpResponse(BaseModel):
    balance_toman: int


@router.post("/wallet-topup", response_model=WalletTopUpResponse, status_code=status.HTTP_201_CREATED)
def dev_wallet_topup(
    payload: WalletTopUpRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> WalletTopUpResponse:
    """
    Credits the CALLING user's own wallet with an arbitrary amount — no
    real payment behind this at all. This is the "شارژ آزمایشی" path
    from TECHNICAL_REQUIREMENTS.md: the only way to get wallet balance
    until real Stars payment / manual card-to-card top-up (both phase 2)
    exist. Never reachable in production — see the module docstring.
    """
    _require_localhost(request)
    db.add(
        CreditLedgerEntry(
            user_id=current_user.id,
            amount_toman=payload.amount_toman,
            type=LedgerEntryType.TOPUP_DEV_STUB,
        )
    )
    db.commit()
    return WalletTopUpResponse(balance_toman=get_balance_toman(db, current_user.id))
