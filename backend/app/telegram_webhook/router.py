"""
The single endpoint Telegram itself calls — never the frontend — every
time something happens on a Stars invoice we created (see
app/topup/router.py's create_star_invoice). Registered with Telegram
once via scripts/set_telegram_webhook.py.

Security: this URL is effectively public (Telegram must be able to
reach it with no auth of its own), so every request is required to
carry the exact secret we chose in "X-Telegram-Bot-Api-Secret-Token" —
see Settings.telegram_webhook_secret's docstring for the full reasoning.
A request without it is rejected before its body is even parsed, so
knowing/guessing this URL alone can never fake a payment or credit a
wallet.

Only two update shapes are handled — everything else is accepted (200
OK, so Telegram doesn't keep retrying) and ignored:
  - pre_checkout_query: Telegram asking "should this payment actually
    go through" — must be answered within 10 seconds (see
    app/telegram_bot.py's answer_pre_checkout_query).
  - message.successful_payment: the payment already happened — this is
    the ONLY place a wallet ever actually gets credited for a real
    Stars purchase.
"""

import logging
from starlette.concurrency import run_in_threadpool
from app.models.user import User
from app.core.rates import lock_finances

logger = logging.getLogger(__name__)
from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.rates import get_rates
from app.core.time import utcnow
from app.models.star_purchase import StarPurchase, StarPurchaseStatus
from app.telegram_bot import answer_pre_checkout_query
from app.wallet.service import credit_topup

router = APIRouter(prefix="/telegram", tags=["telegram"])


def _verify_secret(secret_header: str | None) -> None:
    # Constant-time-ish check isn't critical here (this isn't comparing
    # against a per-request-guessable value at high frequency the way a
    # session token would be), but rejecting on ANY mismatch, including
    # a missing header entirely, is what matters.
    if not settings.telegram_webhook_secret or secret_header != settings.telegram_webhook_secret:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Invalid webhook secret.")


@router.post("/webhook", status_code=status.HTTP_200_OK)
async def telegram_webhook(
    request: Request,
    db: Session = Depends(get_db),
    x_telegram_bot_api_secret_token: str | None = Header(default=None),
) -> dict:
    _verify_secret(x_telegram_bot_api_secret_token)
    update = await request.json()

    pre_checkout_query = update.get("pre_checkout_query")
    if pre_checkout_query is not None:
        await run_in_threadpool(_handle_pre_checkout_query, db, pre_checkout_query)
        return {"ok": True}

    successful_payment = (update.get("message") or {}).get("successful_payment")
    if successful_payment is not None:
        await run_in_threadpool(_handle_successful_payment, db, successful_payment, (update.get("message") or {}).get("from", {}).get("id"))
        return {"ok": True}

    # Any other update type (a plain text message, an edited message,
    # ...) — nothing for this bot to do with it, but still 200 so
    # Telegram doesn't interpret "we didn't handle this" as "delivery
    # failed" and keep resending it.
    return {"ok": True}


def _handle_pre_checkout_query(db: Session, query: dict) -> None:
    query_id = query["id"]
    invoice_payload = query.get("invoice_payload", "")

    purchase = db.query(StarPurchase).filter(StarPurchase.invoice_payload == invoice_payload).first()
    if purchase is None or purchase.status != StarPurchaseStatus.PENDING:
        answer_pre_checkout_query(
            pre_checkout_query_id=query_id, ok=False, error_message="This top-up request is no longer valid."
        )
        return

    # Belt-and-suspenders: the star count Telegram says the user is
    # about to pay should be exactly what we asked for when we created
    # this invoice — a mismatch here would mean something is very wrong
    # (a payload collision, a tampered client, ...), not something to
    # silently accept.
    if (query.get("total_amount") != purchase.stars or query.get("currency") != "XTR"
            or query.get("from", {}).get("id") != db.get(User, purchase.user_id).telegram_id):
        answer_pre_checkout_query(
            pre_checkout_query_id=query_id, ok=False, error_message="Amount mismatch — please try again."
        )
        return

    answer_pre_checkout_query(pre_checkout_query_id=query_id, ok=True)


def _handle_successful_payment(db: Session, payment: dict, payer_id: int | None) -> None:
    lock_finances(db)
    charge_id = payment["telegram_payment_charge_id"]
    invoice_payload = payment.get("invoice_payload", "")

    # Idempotency: Telegram can and does redeliver the same update if
    # our earlier 200 response didn't reach it in time — a second
    # delivery of a charge_id we've already recorded must be a pure
    # no-op, never a second wallet credit.
    already_processed = (
        db.query(StarPurchase).filter(StarPurchase.telegram_payment_charge_id == charge_id).first()
    )
    if already_processed is not None:
        return

    purchase = db.query(StarPurchase).filter(StarPurchase.invoice_payload == invoice_payload).first()
    if purchase is None or purchase.status != StarPurchaseStatus.PENDING:
        logger.error("Unmatched Stars payment: charge_id=%s", charge_id)
        raise HTTPException(409, "Unmatched Stars payment; reconciliation required.")

    if (payment.get("currency") != "XTR" or payment.get("total_amount") != purchase.stars
            or payer_id != db.get(User, purchase.user_id).telegram_id):
        logger.error("Mismatched Stars payment: charge_id=%s", charge_id)
        raise HTTPException(409, "Payment mismatch; reconciliation required.")

    purchase.status = StarPurchaseStatus.PAID
    purchase.telegram_payment_charge_id = charge_id
    purchase.paid_at = utcnow()

    # 1 Star bought for real, via Telegram itself, is worth exactly the
    # same as 1 Star bought manually — same rate, same ledger path (see
    # app/wallet/service.py's credit_topup) — so a real purchase and a
    # manually-approved one are indistinguishable in the wallet
    # afterwards, only their own request row remembers which was which.
    rate = get_rates(db).star_to_toman_rate
    entry = credit_topup(db, user_id=purchase.user_id, amount_toman=purchase.stars * rate)
    entry.star_purchase_id = purchase.id

    db.commit()
