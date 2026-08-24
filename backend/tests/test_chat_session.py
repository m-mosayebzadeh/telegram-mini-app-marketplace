"""
Integration tests for chat sessions: auto-creation on payment, viewing,
closing, disputing, and the grace-period auto-release
(app/wallet/service.py's release_due_chat_transactions()).
"""

from datetime import timedelta

from app.core.config import settings
from app.core.time import utcnow
from app.models.chat_session import ChatSession
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
    }
    payload.update(overrides)
    return client.post("/offers", headers=auth, json=payload).json()


def _open_paid_session(client, db_session, auth_provider, auth_buyer, buyer_id, offer) -> dict:
    """Full happy path up to a freshly-opened chat session: request,
    accept, fund the buyer's wallet, pay. Returns the session as JSON."""
    req = client.post("/requests", headers=auth_buyer, json={"offer_id": offer["id"]}).json()
    client.post(f"/requests/{req['id']}/accept", headers=auth_provider)
    give_wallet_balance(
        db_session, buyer_id, amount_toman=offer["price_stars"] * settings.star_to_toman_rate
    )
    client.post(f"/requests/{req['id']}/pay", headers=auth_buyer)

    return client.get("/chat-sessions/mine", headers=auth_buyer).json()[0]


def _age_session(db_session, session_id: int, hours: int) -> None:
    """Back-dates a session's closed_at, simulating time having passed
    since it closed — without needing a real clock or a sleep()."""
    chat_session = db_session.get(ChatSession, session_id)
    chat_session.closed_at = utcnow() - timedelta(hours=hours)
    db_session.commit()


# --- auto-creation on payment ---------------------------------------------


def test_paying_for_a_request_opens_a_session(client, db_session):
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    _login(client, 1, "Alice")
    bob = _login(client, 2, "Bob")
    offer = _create_offer(client, auth_a)

    session = _open_paid_session(client, db_session, auth_a, auth_b, bob["id"], offer)

    assert session["status"] == "open"
    assert session["closed_at"] is None


def test_both_participants_see_the_session_in_mine(client, db_session):
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    _login(client, 1, "Alice")
    bob = _login(client, 2, "Bob")
    offer = _create_offer(client, auth_a)
    session = _open_paid_session(client, db_session, auth_a, auth_b, bob["id"], offer)

    provider_view = client.get("/chat-sessions/mine", headers=auth_a).json()
    buyer_view = client.get("/chat-sessions/mine", headers=auth_b).json()

    assert [s["id"] for s in provider_view] == [session["id"]]
    assert [s["id"] for s in buyer_view] == [session["id"]]


def test_a_stranger_cannot_view_someone_elses_session(client, db_session):
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    auth_c = _auth_header(3, "Carol")
    _login(client, 1, "Alice")
    bob = _login(client, 2, "Bob")
    _login(client, 3, "Carol")
    offer = _create_offer(client, auth_a)
    session = _open_paid_session(client, db_session, auth_a, auth_b, bob["id"], offer)

    response = client.get(f"/chat-sessions/{session['id']}", headers=auth_c)

    assert response.status_code == 404


# --- closing -----------------------------------------------------------


def test_either_participant_can_close(client, db_session):
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    alice = _login(client, 1, "Alice")
    bob = _login(client, 2, "Bob")
    offer = _create_offer(client, auth_a)
    session = _open_paid_session(client, db_session, auth_a, auth_b, bob["id"], offer)

    response = client.post(f"/chat-sessions/{session['id']}/close", headers=auth_b)

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "closed"
    assert body["closed_by_user_id"] == bob["id"]
    assert alice  # just to use the variable


def test_cannot_close_an_already_closed_session(client, db_session):
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    _login(client, 1, "Alice")
    bob = _login(client, 2, "Bob")
    offer = _create_offer(client, auth_a)
    session = _open_paid_session(client, db_session, auth_a, auth_b, bob["id"], offer)
    client.post(f"/chat-sessions/{session['id']}/close", headers=auth_b)

    response = client.post(f"/chat-sessions/{session['id']}/close", headers=auth_a)

    assert response.status_code == 400


def test_closing_does_not_release_funds_immediately(client, db_session):
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    _login(client, 1, "Alice")
    bob = _login(client, 2, "Bob")
    offer = _create_offer(client, auth_a, price_stars=40)
    session = _open_paid_session(client, db_session, auth_a, auth_b, bob["id"], offer)

    client.post(f"/chat-sessions/{session['id']}/close", headers=auth_b)

    alice_wallet = client.get("/wallet/balance", headers=auth_a).json()
    assert alice_wallet["balance_toman"] == 0
    assert alice_wallet["pending_toman"] == 36 * settings.star_to_toman_rate  # 40 - 10% commission


# --- grace-period auto-release ------------------------------------------


def test_balance_check_before_grace_period_keeps_funds_pending(client, db_session):
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    _login(client, 1, "Alice")
    bob = _login(client, 2, "Bob")
    offer = _create_offer(client, auth_a, price_stars=40)
    session = _open_paid_session(client, db_session, auth_a, auth_b, bob["id"], offer)
    client.post(f"/chat-sessions/{session['id']}/close", headers=auth_b)
    _age_session(db_session, session["id"], hours=settings.chat_release_grace_hours - 1)

    alice_wallet = client.get("/wallet/balance", headers=auth_a).json()

    assert alice_wallet["balance_toman"] == 0
    assert alice_wallet["pending_toman"] == 36 * settings.star_to_toman_rate


def test_balance_check_after_grace_period_releases_funds(client, db_session):
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    _login(client, 1, "Alice")
    bob = _login(client, 2, "Bob")
    offer = _create_offer(client, auth_a, price_stars=40)
    session = _open_paid_session(client, db_session, auth_a, auth_b, bob["id"], offer)
    client.post(f"/chat-sessions/{session['id']}/close", headers=auth_b)
    _age_session(db_session, session["id"], hours=settings.chat_release_grace_hours + 1)

    alice_wallet = client.get("/wallet/balance", headers=auth_a).json()

    assert alice_wallet["balance_toman"] == 36 * settings.star_to_toman_rate
    assert alice_wallet["pending_toman"] == 0


# --- disputing -----------------------------------------------------------


def test_only_the_non_closer_can_dispute(client, db_session):
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    _login(client, 1, "Alice")
    bob = _login(client, 2, "Bob")
    offer = _create_offer(client, auth_a)
    session = _open_paid_session(client, db_session, auth_a, auth_b, bob["id"], offer)
    client.post(f"/chat-sessions/{session['id']}/close", headers=auth_b)  # Bob closes

    # Bob (the closer) can't dispute his own close.
    self_dispute = client.post(f"/chat-sessions/{session['id']}/dispute", headers=auth_b)
    assert self_dispute.status_code == 400

    # Alice (the other participant) can.
    other_dispute = client.post(f"/chat-sessions/{session['id']}/dispute", headers=auth_a)
    assert other_dispute.status_code == 200


def test_cannot_dispute_a_still_open_session(client, db_session):
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    _login(client, 1, "Alice")
    bob = _login(client, 2, "Bob")
    offer = _create_offer(client, auth_a)
    session = _open_paid_session(client, db_session, auth_a, auth_b, bob["id"], offer)

    response = client.post(f"/chat-sessions/{session['id']}/dispute", headers=auth_a)

    assert response.status_code == 400


def test_disputing_prevents_the_grace_period_release(client, db_session):
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    _login(client, 1, "Alice")
    bob = _login(client, 2, "Bob")
    offer = _create_offer(client, auth_a, price_stars=40)
    session = _open_paid_session(client, db_session, auth_a, auth_b, bob["id"], offer)
    client.post(f"/chat-sessions/{session['id']}/close", headers=auth_b)
    client.post(f"/chat-sessions/{session['id']}/dispute", headers=auth_a)
    _age_session(db_session, session["id"], hours=settings.chat_release_grace_hours + 1)

    alice_wallet = client.get("/wallet/balance", headers=auth_a).json()

    assert alice_wallet["balance_toman"] == 0
    assert alice_wallet["pending_toman"] == 36 * settings.star_to_toman_rate


def test_cannot_dispute_the_same_session_twice(client, db_session):
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    _login(client, 1, "Alice")
    bob = _login(client, 2, "Bob")
    offer = _create_offer(client, auth_a)
    session = _open_paid_session(client, db_session, auth_a, auth_b, bob["id"], offer)
    client.post(f"/chat-sessions/{session['id']}/close", headers=auth_b)
    client.post(f"/chat-sessions/{session['id']}/dispute", headers=auth_a)

    response = client.post(f"/chat-sessions/{session['id']}/dispute", headers=auth_a)

    assert response.status_code == 400


def test_cannot_dispute_after_the_grace_window_has_passed(client, db_session):
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    _login(client, 1, "Alice")
    bob = _login(client, 2, "Bob")
    offer = _create_offer(client, auth_a)
    session = _open_paid_session(client, db_session, auth_a, auth_b, bob["id"], offer)
    client.post(f"/chat-sessions/{session['id']}/close", headers=auth_b)
    _age_session(db_session, session["id"], hours=settings.chat_release_grace_hours + 1)

    response = client.post(f"/chat-sessions/{session['id']}/dispute", headers=auth_a)

    assert response.status_code == 400


# --- interaction with offer deletion ------------------------------------


def test_offer_cannot_be_deleted_while_session_is_open(client, db_session):
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    _login(client, 1, "Alice")
    bob = _login(client, 2, "Bob")
    offer = _create_offer(client, auth_a)
    _open_paid_session(client, db_session, auth_a, auth_b, bob["id"], offer)

    response = client.delete(f"/offers/{offer['id']}", headers=auth_a)

    assert response.status_code == 400


def test_offer_can_be_deleted_once_its_session_is_closed(client, db_session):
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    _login(client, 1, "Alice")
    bob = _login(client, 2, "Bob")
    offer = _create_offer(client, auth_a)
    session = _open_paid_session(client, db_session, auth_a, auth_b, bob["id"], offer)
    client.post(f"/chat-sessions/{session['id']}/close", headers=auth_a)

    response = client.delete(f"/offers/{offer['id']}", headers=auth_a)

    assert response.status_code == 204


# --- interaction with the "one open request/accept" rules ----------------
# Regression tests: Request.status stays ACCEPTED forever even after its
# chat session closes (it's a historical record) — accept/re-request
# checks must look at the session too, or a provider's very first
# accepted request would silently block every future one forever.


def test_provider_can_accept_a_new_request_after_the_first_sessions_closed(client, db_session):
    auth_a = _auth_header(1, "Alice")  # provider
    auth_b = _auth_header(2, "Bob")
    auth_c = _auth_header(3, "Carol")
    _login(client, 1, "Alice")
    bob = _login(client, 2, "Bob")
    _login(client, 3, "Carol")
    offer1 = _create_offer(client, auth_a)
    offer2 = _create_offer(client, auth_a)
    session1 = _open_paid_session(client, db_session, auth_a, auth_b, bob["id"], offer1)
    client.post(f"/chat-sessions/{session1['id']}/close", headers=auth_a)

    req2 = client.post("/requests", headers=auth_c, json={"offer_id": offer2["id"]}).json()
    response = client.post(f"/requests/{req2['id']}/accept", headers=auth_a)

    assert response.status_code == 200


def test_provider_still_blocked_while_first_session_is_open(client, db_session):
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    auth_c = _auth_header(3, "Carol")
    _login(client, 1, "Alice")
    bob = _login(client, 2, "Bob")
    _login(client, 3, "Carol")
    offer1 = _create_offer(client, auth_a)
    offer2 = _create_offer(client, auth_a)
    _open_paid_session(client, db_session, auth_a, auth_b, bob["id"], offer1)  # stays open

    req2 = client.post("/requests", headers=auth_c, json={"offer_id": offer2["id"]}).json()
    response = client.post(f"/requests/{req2['id']}/accept", headers=auth_a)

    assert response.status_code == 400


def test_buyer_can_request_the_same_provider_again_after_session_closes(client, db_session):
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    _login(client, 1, "Alice")
    bob = _login(client, 2, "Bob")
    offer1 = _create_offer(client, auth_a)
    offer2 = _create_offer(client, auth_a)
    session1 = _open_paid_session(client, db_session, auth_a, auth_b, bob["id"], offer1)
    client.post(f"/chat-sessions/{session1['id']}/close", headers=auth_a)

    response = client.post("/requests", headers=auth_b, json={"offer_id": offer2["id"]})

    assert response.status_code == 201
