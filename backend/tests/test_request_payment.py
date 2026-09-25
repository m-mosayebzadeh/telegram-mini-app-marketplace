"""
Integration tests for POST /requests/{id}/pay — the buyer's payment
step, wired to the real wallet ledger (app/wallet/service.py). See
TECHNICAL_REQUIREMENTS.md, "مدل مالی و اعتبار".
"""

from app.core.config import settings
from app.core.time import utcnow
from app.models.chat_session import ChatSession
from app.models.transaction import Transaction
from app.wallet.blocks import EndReason, close_and_settle
from app.wallet.service import release_transaction
from tests.helpers import give_wallet_balance, sign_init_data


def _auth_header(telegram_id: int, first_name: str = "Test") -> dict:
    return {"X-Telegram-Init-Data": sign_init_data({"id": telegram_id, "first_name": first_name})}


def _login(client, telegram_id: int, first_name: str = "Test") -> dict:
    return client.get("/me", headers=_auth_header(telegram_id, first_name)).json()


def _create_offer(client, auth: dict, **overrides):
    payload = {
        "price_photons": 40,
        "session_duration_seconds": 1800,
        "title": "Chat with me",
        "description": "A nice chat",
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


def test_paying_reserves_the_whole_price_and_buys_nothing_yet(client, db_session):
    """
    Paying for an accepted request no longer buys a fixed thing — it opens the
    session and RESERVES its whole price. The buyer is debited immediately, so
    the conversation can never die for lack of funds mid-way and the provider
    knows the money is really there; but nobody is owed anything until the
    session ends and it is known how many blocks were actually used.
    """
    auth_a = _auth_header(1, "Alice")  # provider
    auth_b = _auth_header(2, "Bob")  # buyer
    alice = _login(client, 1, "Alice")
    bob = _login(client, 2, "Bob")
    offer = _create_offer(client, auth_a, price_photons=40)
    req = _create_accepted_request(client, auth_a, auth_b, offer)

    # Exactly enough for the 40-star offer, nothing more.
    give_wallet_balance(db_session, bob["id"], amount_toman=40 * settings.photon_to_toman_rate)

    response = client.post(f"/requests/{req['id']}/pay", headers=auth_b)

    assert response.status_code == 201
    body = response.json()
    assert body["request_id"] == req["id"]
    assert body["status"] == "open"
    # Four blocks of 10 Photons, and no purchase recorded yet.
    assert body["reserved_blocks"] == 4
    assert body["block_price_photons"] == 10
    assert body["transaction_id"] is None

    # Bob's whole balance is reserved: neither spendable nor gone, it shows as
    # money in progress.
    bob_wallet = client.get("/wallet/balance", headers=auth_b).json()
    assert bob_wallet["balance_toman"] == 0
    assert bob_wallet["in_flight_toman"] == 40 * settings.photon_to_toman_rate

    # Alice is owed nothing yet either, not even provisionally: a session that
    # has only just started has sold no time at all.
    alice_wallet = client.get("/wallet/balance", headers=auth_a).json()
    assert alice_wallet["balance_toman"] == 0
    assert alice_wallet["pending_toman"] == 0
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
    offer = _create_offer(client, auth_a, price_photons=40)
    req = _create_accepted_request(client, auth_a, auth_b, offer)
    give_wallet_balance(db_session, bob["id"], amount_toman=40 * settings.photon_to_toman_rate)
    client.post(f"/requests/{req['id']}/pay", headers=auth_b)

    # Run the session out so all four blocks are consumed — only a finished
    # session has a transaction to release.
    chat_session = db_session.query(ChatSession).filter_by(request_id=req["id"]).one()
    close_and_settle(
        db_session, chat_session, reason=EndReason.COMPLETED, closed_by_user_id=None, at=utcnow()
    )
    db_session.commit()

    transaction = db_session.query(Transaction).filter(Transaction.request_id == req["id"]).one()
    assert transaction.status.value == "pending"

    release_transaction(db_session, transaction)
    db_session.commit()

    assert transaction.status.value == "succeeded"
    alice_wallet = client.get("/wallet/balance", headers=auth_a).json()
    assert alice_wallet["balance_toman"] == 36 * settings.photon_to_toman_rate
    assert alice_wallet["pending_toman"] == 0


def test_cannot_pay_the_same_request_twice(client, db_session):
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    _login(client, 1, "Alice")
    bob = _login(client, 2, "Bob")
    offer = _create_offer(client, auth_a, price_photons=40)
    req = _create_accepted_request(client, auth_a, auth_b, offer)
    give_wallet_balance(db_session, bob["id"], amount_toman=200 * settings.photon_to_toman_rate)

    first = client.post(f"/requests/{req['id']}/pay", headers=auth_b)
    second = client.post(f"/requests/{req['id']}/pay", headers=auth_b)

    assert first.status_code == 201
    assert second.status_code == 400
    # Only charged once, even though Bob had enough balance to be
    # charged twice.
    remaining = client.get("/wallet/balance", headers=auth_b).json()["balance_toman"]
    assert remaining == 160 * settings.photon_to_toman_rate
