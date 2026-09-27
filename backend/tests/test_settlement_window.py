"""
The settlement window: the day between a session ending and its money reaching
the provider, and the two ways that wait can end early.

The window exists to give an unhappy BUYER time to freeze the money — the only
money anybody could want back is theirs. So the buyer's word alone ends it
(TECHNICAL_REQUIREMENTS.md section 30.18); the provider confirming is recorded
and gives up their own right to complain, but releases nothing by itself.
"""
from datetime import timedelta

from app.core.config import settings
from app.core.time import utcnow
from app.models.chat_session import ChatSession
from app.models.transaction import Transaction
from tests.helpers import give_wallet_balance, sign_init_data

RATE = 1000  # Toman per Photon, the fixed peg


def _auth(telegram_id: int, first_name: str = "Test") -> dict:
    return {"X-Telegram-Init-Data": sign_init_data({"id": telegram_id, "first_name": first_name})}


def _closed_session(client, db_session, *, closed_by="buyer"):
    """A session run to its end and closed, with money waiting to settle."""
    provider, buyer = _auth(1, "Alice"), _auth(2, "Bob")
    client.get("/me", headers=provider)
    buyer_id = client.get("/me", headers=buyer).json()["id"]
    offer = client.post(
        "/offers",
        headers=provider,
        json={"price_photons": 40, "session_duration_seconds": 1800, "title": "C", "description": "C"},
    ).json()
    request = client.post("/requests", headers=buyer, json={"offer_id": offer["id"]}).json()
    client.post(f"/requests/{request['id']}/accept", headers=provider)
    give_wallet_balance(db_session, buyer_id, amount_toman=40 * RATE)
    client.post(f"/requests/{request['id']}/pay", headers=buyer)

    chat_session = db_session.query(ChatSession).filter_by(request_id=request["id"]).one()
    client.post(
        f"/chat-sessions/{chat_session.id}/messages",
        headers=provider,
        data={"type": "text", "text": "Hello"},
    )
    closer = buyer if closed_by == "buyer" else provider
    client.post(f"/chat-sessions/{chat_session.id}/close", headers=closer)
    db_session.refresh(chat_session)
    return chat_session, provider, buyer


def _age(db_session, chat_session, hours):
    chat_session.closed_at = utcnow() - timedelta(hours=hours)
    db_session.commit()


def test_the_buyer_confirming_alone_pays_the_provider_at_once(client, db_session):
    """The buyer is the only side with money to protect, so their word is
    enough — there is nothing left to wait for."""
    chat_session, provider, buyer = _closed_session(client, db_session)

    body = client.post(f"/chat-sessions/{chat_session.id}/confirm-settlement", headers=buyer).json()

    assert body["i_confirmed_settlement"] is True
    assert body["they_confirmed_settlement"] is False
    wallet = client.get("/wallet/balance", headers=provider).json()
    assert wallet["balance_toman"] == 9 * RATE  # one block, less the commission
    assert wallet["pending_toman"] == 0


def test_the_provider_confirming_alone_releases_nothing(client, db_session):
    """The provider cannot sign off their own pay: that would leave the buyer
    no window at all."""
    chat_session, provider, buyer = _closed_session(client, db_session)

    body = client.post(f"/chat-sessions/{chat_session.id}/confirm-settlement", headers=provider).json()

    assert body["i_confirmed_settlement"] is True
    wallet = client.get("/wallet/balance", headers=provider).json()
    assert wallet["balance_toman"] == 0
    assert wallet["pending_toman"] == 9 * RATE


def test_both_sides_confirming_pays_the_provider_at_once(client, db_session):
    """Nothing is left to protect against, so there is nothing left to wait
    for — no grace period, no clock."""
    chat_session, provider, buyer = _closed_session(client, db_session)

    client.post(f"/chat-sessions/{chat_session.id}/confirm-settlement", headers=buyer)
    client.post(f"/chat-sessions/{chat_session.id}/confirm-settlement", headers=provider)

    wallet = client.get("/wallet/balance", headers=provider).json()
    assert wallet["balance_toman"] == 9 * RATE
    assert wallet["pending_toman"] == 0
    transaction = db_session.query(Transaction).filter_by(request_id=chat_session.request_id).one()
    assert transaction.status.value == "succeeded"


def test_confirming_gives_up_your_own_right_to_dispute(client, db_session):
    chat_session, provider, buyer = _closed_session(client, db_session, closed_by="provider")

    client.post(f"/chat-sessions/{chat_session.id}/confirm-settlement", headers=buyer)
    response = client.post(f"/chat-sessions/{chat_session.id}/dispute", headers=buyer)

    assert response.status_code == 400


def test_the_provider_confirming_leaves_the_decision_with_the_buyer(client, db_session):
    """The provider signing off changes nothing about the buyer's window: the
    money waits until the buyer says so, and is paid exactly once."""
    chat_session, provider, buyer = _closed_session(client, db_session, closed_by="buyer")

    client.post(f"/chat-sessions/{chat_session.id}/confirm-settlement", headers=provider)
    assert client.get("/wallet/balance", headers=provider).json()["balance_toman"] == 0

    client.post(f"/chat-sessions/{chat_session.id}/confirm-settlement", headers=buyer)
    assert client.get("/wallet/balance", headers=provider).json()["balance_toman"] == 9 * RATE


def test_released_money_cannot_be_disputed(client, db_session):
    """Once the buyer has released it there is no held money left for a
    dispute to freeze; conduct goes to reports instead."""
    chat_session, provider, buyer = _closed_session(client, db_session, closed_by="buyer")

    client.post(f"/chat-sessions/{chat_session.id}/confirm-settlement", headers=buyer)
    response = client.post(f"/chat-sessions/{chat_session.id}/dispute", headers=provider)

    assert response.status_code == 400


def test_a_disputed_session_cannot_be_confirmed_away(client, db_session):
    """Once frozen, it is for support to resolve — not for either party to
    quietly wave through."""
    chat_session, provider, buyer = _closed_session(client, db_session, closed_by="buyer")
    client.post(f"/chat-sessions/{chat_session.id}/dispute", headers=provider)

    response = client.post(f"/chat-sessions/{chat_session.id}/confirm-settlement", headers=buyer)

    assert response.status_code == 400


def test_confirming_twice_is_harmless(client, db_session):
    chat_session, provider, buyer = _closed_session(client, db_session)

    client.post(f"/chat-sessions/{chat_session.id}/confirm-settlement", headers=buyer)
    again = client.post(
        f"/chat-sessions/{chat_session.id}/confirm-settlement", headers=buyer
    ).json()

    assert again["i_confirmed_settlement"] is True
    # Paid exactly once: pressing it a second time released nothing more.
    assert client.get("/wallet/balance", headers=provider).json()["balance_toman"] == 9 * RATE


def test_a_session_that_cost_nothing_has_nothing_to_confirm(client, db_session):
    """The provider never spoke, so the buyer already has every Photon back."""
    provider, buyer = _auth(1, "Alice"), _auth(2, "Bob")
    client.get("/me", headers=provider)
    buyer_id = client.get("/me", headers=buyer).json()["id"]
    offer = client.post(
        "/offers",
        headers=provider,
        json={"price_photons": 40, "session_duration_seconds": 1800, "title": "C", "description": "C"},
    ).json()
    request = client.post("/requests", headers=buyer, json={"offer_id": offer["id"]}).json()
    client.post(f"/requests/{request['id']}/accept", headers=provider)
    give_wallet_balance(db_session, buyer_id, amount_toman=40 * RATE)
    client.post(f"/requests/{request['id']}/pay", headers=buyer)
    chat_session = db_session.query(ChatSession).filter_by(request_id=request["id"]).one()
    client.post(f"/chat-sessions/{chat_session.id}/close", headers=buyer)

    response = client.post(f"/chat-sessions/{chat_session.id}/confirm-settlement", headers=buyer)

    assert response.status_code == 400
    assert client.get("/wallet/balance", headers=buyer).json()["balance_toman"] == 40 * RATE


def test_the_window_still_expires_on_its_own_when_nobody_confirms(client, db_session):
    """The default has to favour release: otherwise either side could hold the
    money hostage forever simply by never answering."""
    chat_session, provider, buyer = _closed_session(client, db_session)
    _age(db_session, chat_session, hours=settings.chat_release_grace_hours + 1)

    wallet = client.get("/wallet/balance", headers=provider).json()

    assert wallet["balance_toman"] == 9 * RATE
    assert wallet["pending_toman"] == 0


# ------------------------------------------------------------------ thanks

def test_the_provider_can_thank_after_release(client, db_session):
    chat_session, provider, buyer = _closed_session(client, db_session)
    client.post(f"/chat-sessions/{chat_session.id}/confirm-settlement", headers=buyer)

    body = client.post(
        f"/chat-sessions/{chat_session.id}/thanks", headers=provider, json={"reaction": "heart"}
    ).json()

    assert body["thanks_reaction"] == "heart"
    # And the buyer sees it on the same session.
    seen = client.get(f"/chat-sessions/{chat_session.id}", headers=buyer).json()
    assert seen["thanks_reaction"] == "heart"


def test_no_thanks_before_the_money_arrives(client, db_session):
    """Before release a thank-you would read as a nudge to pay."""
    chat_session, provider, buyer = _closed_session(client, db_session)

    response = client.post(
        f"/chat-sessions/{chat_session.id}/thanks", headers=provider, json={"reaction": "heart"}
    )

    assert response.status_code == 400


def test_only_the_provider_thanks_and_only_once(client, db_session):
    chat_session, provider, buyer = _closed_session(client, db_session)
    client.post(f"/chat-sessions/{chat_session.id}/confirm-settlement", headers=buyer)

    by_buyer = client.post(
        f"/chat-sessions/{chat_session.id}/thanks", headers=buyer, json={"reaction": "pray"}
    )
    first = client.post(
        f"/chat-sessions/{chat_session.id}/thanks", headers=provider, json={"reaction": "pray"}
    )
    second = client.post(
        f"/chat-sessions/{chat_session.id}/thanks", headers=provider, json={"reaction": "heart"}
    )

    assert by_buyer.status_code == 403
    assert first.status_code == 200
    assert second.status_code == 400


def test_only_the_fixed_reactions_exist(client, db_session):
    chat_session, provider, buyer = _closed_session(client, db_session)
    client.post(f"/chat-sessions/{chat_session.id}/confirm-settlement", headers=buyer)

    response = client.post(
        f"/chat-sessions/{chat_session.id}/thanks", headers=provider, json={"reaction": "star"}
    )

    assert response.status_code == 400
