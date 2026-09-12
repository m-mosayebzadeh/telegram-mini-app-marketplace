"""
Tests for the real Telegram Stars top-up flow: creating an invoice, and
the webhook Telegram itself calls for pre_checkout_query and
successful_payment updates (see app/topup/router.py's
create_star_invoice and app/telegram_webhook/router.py).

Every outbound call to Telegram's own Bot API (create_star_invoice_link,
answer_pre_checkout_query) is monkeypatched — these tests never touch
the real network, matching this project's existing convention of never
depending on an external service in the test suite.
"""

from app.core.config import settings
from app.models.star_purchase import StarPurchase, StarPurchaseStatus
from app.wallet.service import get_balance_toman
from tests.helpers import sign_init_data

WEBHOOK_HEADERS = {"X-Telegram-Bot-Api-Secret-Token": settings.telegram_webhook_secret}


def _auth_header(telegram_id: int, first_name: str = "Test") -> dict:
    return {"X-Telegram-Init-Data": sign_init_data({"id": telegram_id, "first_name": first_name})}


def _create_pending_purchase(client, db_session, telegram_id: int, stars: int) -> StarPurchase:
    """Creates a real user (via /me) and a pending StarPurchase for
    them, the same way the real /topup/stars/invoice endpoint does —
    used by the webhook tests below, which only care about what happens
    to an EXISTING pending purchase, not about creating one."""
    user_id = client.get("/me", headers=_auth_header(telegram_id)).json()["id"]
    purchase = StarPurchase(user_id=user_id, stars=stars, invoice_payload=f"payload-{telegram_id}-{stars}")
    db_session.add(purchase)
    db_session.commit()
    db_session.refresh(purchase)
    return purchase


# --- POST /topup/stars/invoice ---------------------------------------------


def test_create_star_invoice_records_a_pending_purchase(client, db_session, monkeypatch):
    monkeypatch.setattr(
        "app.topup.router.create_star_invoice_link", lambda **kwargs: "https://t.me/fake-invoice-link"
    )

    response = client.post("/topup/stars/invoice", headers=_auth_header(1), json={"stars": 50})

    assert response.status_code == 201
    assert response.json()["invoice_link"] == "https://t.me/fake-invoice-link"
    assert response.json()["purchase_id"] > 0
    purchase = db_session.query(StarPurchase).one()
    assert purchase.stars == 50
    assert purchase.status == StarPurchaseStatus.PENDING
    assert purchase.invoice_payload  # a real random token was generated


def test_create_star_invoice_rejects_non_positive_stars(client, monkeypatch):
    monkeypatch.setattr("app.topup.router.create_star_invoice_link", lambda **kwargs: "unused")

    response = client.post("/topup/stars/invoice", headers=_auth_header(1), json={"stars": 0})

    assert response.status_code == 400


# --- POST /telegram/webhook: secret verification ----------------------------


def test_webhook_rejects_missing_secret(client):
    response = client.post("/telegram/webhook", json={})
    assert response.status_code == 403


def test_webhook_rejects_wrong_secret(client):
    response = client.post(
        "/telegram/webhook", json={}, headers={"X-Telegram-Bot-Api-Secret-Token": "wrong"}
    )
    assert response.status_code == 403


def test_webhook_ignores_unrecognized_update_types(client):
    response = client.post("/telegram/webhook", json={"some_other_field": {}}, headers=WEBHOOK_HEADERS)
    assert response.status_code == 200


# --- pre_checkout_query ------------------------------------------------------


def test_pre_checkout_approves_a_matching_pending_purchase(client, db_session, monkeypatch):
    purchase = _create_pending_purchase(client, db_session, telegram_id=2, stars=30)
    calls = []
    monkeypatch.setattr(
        "app.telegram_webhook.router.answer_pre_checkout_query",
        lambda **kwargs: calls.append(kwargs),
    )

    response = client.post(
        "/telegram/webhook",
        json={
            "pre_checkout_query": {
                "id": "query-1",
                "currency": "XTR", "from": {"id": 2},
                "invoice_payload": purchase.invoice_payload,
                "total_amount": 30,
            }
        },
        headers=WEBHOOK_HEADERS,
    )

    assert response.status_code == 200
    assert calls == [{"pre_checkout_query_id": "query-1", "ok": True}]


def test_pre_checkout_rejects_unknown_payload(client, monkeypatch):
    calls = []
    monkeypatch.setattr(
        "app.telegram_webhook.router.answer_pre_checkout_query",
        lambda **kwargs: calls.append(kwargs),
    )

    client.post(
        "/telegram/webhook",
        json={"pre_checkout_query": {"id": "query-2", "invoice_payload": "does-not-exist", "total_amount": 10}},
        headers=WEBHOOK_HEADERS,
    )

    assert calls[0]["ok"] is False


def test_pre_checkout_rejects_amount_mismatch(client, db_session, monkeypatch):
    purchase = _create_pending_purchase(client, db_session, telegram_id=3, stars=30)
    calls = []
    monkeypatch.setattr(
        "app.telegram_webhook.router.answer_pre_checkout_query",
        lambda **kwargs: calls.append(kwargs),
    )

    client.post(
        "/telegram/webhook",
        json={
            "pre_checkout_query": {
                "id": "query-3",
                "invoice_payload": purchase.invoice_payload,
                # Someone/something claims this is only 5 stars, not the 30 it was created for.
                "total_amount": 5,
            }
        },
        headers=WEBHOOK_HEADERS,
    )

    assert calls[0]["ok"] is False


# --- successful_payment ------------------------------------------------------


def test_successful_payment_credits_the_wallet_and_marks_purchase_paid(client, db_session):
    purchase = _create_pending_purchase(client, db_session, telegram_id=4, stars=25)

    response = client.post(
        "/telegram/webhook",
        json={
            "message": {
                "from": {"id": 4},
                "successful_payment": {
                    "telegram_payment_charge_id": "charge-1",
                    "currency": "XTR",
                    "invoice_payload": purchase.invoice_payload,
                    "total_amount": 25,
                }
            }
        },
        headers=WEBHOOK_HEADERS,
    )

    assert response.status_code == 200
    db_session.refresh(purchase)
    assert purchase.status == StarPurchaseStatus.PAID
    assert purchase.telegram_payment_charge_id == "charge-1"
    assert purchase.paid_at is not None
    assert get_balance_toman(db_session, purchase.user_id) == 25 * settings.star_to_toman_rate


def test_successful_payment_is_idempotent_on_replay(client, db_session):
    purchase = _create_pending_purchase(client, db_session, telegram_id=5, stars=10)
    payload = {
        "message": {
            "from": {"id": 5},
            "successful_payment": {
                "telegram_payment_charge_id": "charge-2",
                "currency": "XTR",
                "invoice_payload": purchase.invoice_payload,
                "total_amount": 10,
            }
        }
    }

    client.post("/telegram/webhook", json=payload, headers=WEBHOOK_HEADERS)
    # Telegram redelivering the exact same update (e.g. our first 200
    # didn't arrive in time) must never credit the wallet a second time.
    client.post("/telegram/webhook", json=payload, headers=WEBHOOK_HEADERS)

    assert get_balance_toman(db_session, purchase.user_id) == 10 * settings.star_to_toman_rate


def test_successful_payment_for_unknown_purchase_does_not_crash(client):
    response = client.post(
        "/telegram/webhook",
        json={
            "message": {
                "successful_payment": {
                    "telegram_payment_charge_id": "charge-3",
                    "invoice_payload": "no-such-payload",
                    "total_amount": 10,
                }
            }
        },
        headers=WEBHOOK_HEADERS,
    )
    assert response.status_code == 409


def test_successful_payment_rechecks_amount_currency_and_payer(client,db_session):
    purchase=_create_pending_purchase(client,db_session,telegram_id=77,stars=10)
    for currency,amount,payer in [('USD',10,77),('XTR',1,77),('XTR',10,88)]:
        response=client.post('/telegram/webhook',headers=WEBHOOK_HEADERS,json={'message':{'from':{'id':payer},'successful_payment':{
            'telegram_payment_charge_id':'invalid-charge','invoice_payload':purchase.invoice_payload,'currency':currency,'total_amount':amount}}})
        assert response.status_code==409
        assert get_balance_toman(db_session,purchase.user_id)==0
    db_session.refresh(purchase)
    assert purchase.status==StarPurchaseStatus.PENDING
