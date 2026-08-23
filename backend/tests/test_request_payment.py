"""
Integration tests for POST /requests/{id}/pay — the buyer's payment
step, wired to the real wallet ledger (app/wallet/service.py). See
TECHNICAL_REQUIREMENTS.md, "مدل مالی و اعتبار".
"""

from app.core.config import settings
from app.models.transaction import Transaction
from app.wallet.service import release_transaction
from tests.helpers import give_wallet_balance, sign_init_data


def _auth_header(telegram_id: int, first_name: str = "Test") -> dict:
    return {"X-Telegram-Init-Data": sign_init_data({"id": telegram_id, "first_name": first_name})}


def _login(client, telegram_id: int, first_name: str = "Test") -> dict:
    return client.get("/me", headers=_auth_header(telegram_id, first_name)).json()


def _create_offer(client, auth: dict, **overrides):
    payload = {
        "price_stars": 40,
        "display_duration_minutes": 30,
        "description": "A nice chat",
        "terms": "Be nice",
    }
    payload.update(overrides)
    return client.post("/offers", headers=auth, json=payload).json()


def _create_accepted_request(client, auth_provider: dict, auth_buyer: dict, offer: dict) -> dict:
    """Creates a request for `offer` and has the provider accept it —
    the only state pay() is ever reachable from."""
    req = client.post("/requests", headers=auth_buyer, json={"offer_id": offer["id"]}).json()
    client.post(f"/requests/{req['id']}/accept", headers=auth_provider)
    return req


# --- guard rules -------------------------------------------------------


def test_cannot_pay_a_pending_request(client):
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    _login(client, 1, "Alice")
    _login(client, 2, "Bob")
    offer = _create_offer(client, auth_a)
    req = client.post("/requests", headers=auth_b, json={"offer_id": offer["id"]}).json()

    response = client.post(f"/requests/{req['id']}/pay", headers=auth_b)

    assert response.status_code == 400


def test_only_the_buyer_can_pay(client):
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    auth_c = _auth_header(3, "Carol")
    _login(client, 1, "Alice")
    _login(client, 2, "Bob")
    _login(client, 3, "Carol")
    offer = _create_offer(client, auth_a)
    req = _create_accepted_request(client, auth_a, auth_b, offer)

    response = client.post(f"/requests/{req['id']}/pay", headers=auth_c)

    assert response.status_code == 404  # Carol has no idea this request even exists


def test_pay_without_enough_balance_returns_402(client):
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    _login(client, 1, "Alice")
    _login(client, 2, "Bob")
    offer = _create_offer(client, auth_a)
    req = _create_accepted_request(client, auth_a, auth_b, offer)

    # Bob never topped up his wallet.
    response = client.post(f"/requests/{req['id']}/pay", headers=auth_b)

    assert response.status_code == 402
    assert response.json()["detail"]["reason"] == "insufficient_balance"


# --- successful payment -------------------------------------------------


def test_pay_charges_buyer_immediately_but_holds_the_providers_share(client, db_session):
    """
    A CHAT_REQUEST transaction settles later, not immediately (see
    TECHNICAL_REQUIREMENTS.md, "idle money"): the buyer is charged in
    full right away, but the provider's net share only becomes
    spendable once the (not-yet-built) chat session closes cleanly —
    see test_release_transaction_moves_pending_share_to_provider below
    for that second half.
    """
    auth_a = _auth_header(1, "Alice")  # provider
    auth_b = _auth_header(2, "Bob")  # buyer
    alice = _login(client, 1, "Alice")
    bob = _login(client, 2, "Bob")
    offer = _create_offer(client, auth_a, price_stars=40)
    req = _create_accepted_request(client, auth_a, auth_b, offer)

    # Exactly enough for the 40-star offer, nothing more.
    give_wallet_balance(db_session, bob["id"], amount_toman=40 * settings.star_to_toman_rate)

    response = client.post(f"/requests/{req['id']}/pay", headers=auth_b)

    assert response.status_code == 201
    body = response.json()
    # 40 stars at the default 10% chat commission -> 4 stars commission,
    # 36 stars to the provider (see test_wallet.py for the rounding rule
    # itself).
    assert body["gross_price_stars"] == 40
    assert body["commission_stars"] == 4
    assert body["net_provider_stars"] == 36
    assert body["status"] == "pending"
    assert body["request_id"] == req["id"]

    # Bob spent his entire balance immediately...
    bob_wallet = client.get("/wallet/balance", headers=auth_b).json()
    assert bob_wallet["balance_toman"] == 0

    # ...but Alice hasn't actually received anything yet: her spendable
    # balance is still 0, and the 36-star net share shows up as PENDING
    # instead, not as spendable balance.
    alice_wallet = client.get("/wallet/balance", headers=auth_a).json()
    assert alice_wallet["balance_toman"] == 0
    assert alice_wallet["pending_toman"] == 36 * settings.star_to_toman_rate
    assert alice  # just to use the variable


def test_release_transaction_moves_pending_share_to_provider(client, db_session):
    """
    release_transaction() isn't wired to any endpoint yet — chat
    sessions don't exist to trigger it — but its logic is proven
    directly here, ahead of that wiring (see its docstring in
    app/wallet/service.py).
    """
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    _login(client, 1, "Alice")
    bob = _login(client, 2, "Bob")
    offer = _create_offer(client, auth_a, price_stars=40)
    req = _create_accepted_request(client, auth_a, auth_b, offer)
    give_wallet_balance(db_session, bob["id"], amount_toman=40 * settings.star_to_toman_rate)
    client.post(f"/requests/{req['id']}/pay", headers=auth_b)

    transaction = db_session.query(Transaction).filter(Transaction.request_id == req["id"]).one()
    assert transaction.status.value == "pending"

    release_transaction(db_session, transaction)
    db_session.commit()

    assert transaction.status.value == "succeeded"
    alice_wallet = client.get("/wallet/balance", headers=auth_a).json()
    assert alice_wallet["balance_toman"] == 36 * settings.star_to_toman_rate
    assert alice_wallet["pending_toman"] == 0


def test_cannot_pay_the_same_request_twice(client, db_session):
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    _login(client, 1, "Alice")
    bob = _login(client, 2, "Bob")
    offer = _create_offer(client, auth_a, price_stars=40)
    req = _create_accepted_request(client, auth_a, auth_b, offer)
    give_wallet_balance(db_session, bob["id"], amount_toman=200 * settings.star_to_toman_rate)

    first = client.post(f"/requests/{req['id']}/pay", headers=auth_b)
    second = client.post(f"/requests/{req['id']}/pay", headers=auth_b)

    assert first.status_code == 201
    assert second.status_code == 400
    # Only charged once, even though Bob had enough balance to be
    # charged twice.
    remaining = client.get("/wallet/balance", headers=auth_b).json()["balance_toman"]
    assert remaining == 160 * settings.star_to_toman_rate
