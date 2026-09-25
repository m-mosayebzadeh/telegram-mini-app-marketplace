"""
Removing a finished conversation from your own side.

Archiving already keeps the chat list tidy, but an archive fills up too. This
follows the same shape and for the same reason: a conversation two people took
part in is not one of them to erase, so removing is one-sided and the messages
themselves are never touched.
"""
from datetime import timedelta

from app.core.config import settings
from app.core.time import utcnow
from app.models.chat_session import ChatSession
from tests.helpers import give_wallet_balance, sign_init_data

RATE = 1000  # Toman per Photon, the fixed peg


def _auth(telegram_id: int, first_name: str = "Test") -> dict:
    return {"X-Telegram-Init-Data": sign_init_data({"id": telegram_id, "first_name": first_name})}


def _settled_session(client, db_session):
    """A conversation that ran, closed, and whose money has been paid out."""
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
    client.post(f"/chat-sessions/{chat_session.id}/close", headers=buyer)
    # Both sign off, which releases the money and closes the settlement window.
    client.post(f"/chat-sessions/{chat_session.id}/confirm-settlement", headers=buyer)
    client.post(f"/chat-sessions/{chat_session.id}/confirm-settlement", headers=provider)
    db_session.refresh(chat_session)
    return chat_session, provider, buyer


def test_removing_it_is_one_sided(client, db_session):
    """The whole point: the other person still has the conversation, and what
    they do with their copy is their business."""
    chat_session, provider, buyer = _settled_session(client, db_session)

    assert client.delete(f"/chat-sessions/{chat_session.id}", headers=buyer).status_code == 204

    assert client.get(f"/chat-sessions/{chat_session.id}", headers=buyer).status_code == 404
    assert client.get("/chat-sessions/mine", headers=buyer).json() == []
    # Untouched for the provider.
    assert client.get(f"/chat-sessions/{chat_session.id}", headers=provider).status_code == 200
    assert len(client.get("/chat-sessions/mine", headers=provider).json()) == 1


def test_the_messages_survive_for_the_other_person(client, db_session):
    """Nothing is really deleted — the other side is still reading it."""
    chat_session, provider, buyer = _settled_session(client, db_session)

    client.delete(f"/chat-sessions/{chat_session.id}", headers=buyer)

    messages = client.get(f"/chat-sessions/{chat_session.id}/messages", headers=provider).json()
    assert [m["text"] for m in messages] == ["Hello"]


def test_everything_about_it_is_gone_for_whoever_removed_it(client, db_session):
    """Including the messages and their files: one check, in the one place
    every route loads a session through."""
    chat_session, _, buyer = _settled_session(client, db_session)

    client.delete(f"/chat-sessions/{chat_session.id}", headers=buyer)

    assert client.get(f"/chat-sessions/{chat_session.id}/messages", headers=buyer).status_code == 404
    assert client.delete(f"/chat-sessions/{chat_session.id}", headers=buyer).status_code == 404


def test_a_running_conversation_cannot_be_removed(client, db_session):
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

    response = client.delete(f"/chat-sessions/{chat_session.id}", headers=buyer)

    assert response.status_code == 400
    assert response.json()["detail"]["reason"] == "session_still_open"


def test_it_cannot_be_removed_while_the_money_is_unsettled(client, db_session):
    """Tidying a chat list must not quietly cost someone the right to say
    something went wrong — removing it would take away the way back to both
    confirming the settlement and raising a complaint."""
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
    client.post(f"/chat-sessions/{chat_session.id}/close", headers=buyer)

    response = client.delete(f"/chat-sessions/{chat_session.id}", headers=buyer)

    assert response.status_code == 400
    assert response.json()["detail"]["reason"] == "settlement_unfinished"


def test_once_the_window_has_passed_it_can_be_removed(client, db_session):
    """The settlement does not need to be confirmed by hand — letting the
    window run out settles it just as well."""
    chat_session, provider, buyer = _settled_session(client, db_session)
    chat_session.closed_at = utcnow() - timedelta(hours=settings.chat_release_grace_hours + 1)
    db_session.commit()

    assert client.delete(f"/chat-sessions/{chat_session.id}", headers=provider).status_code == 204


def test_both_sides_can_remove_it_independently(client, db_session):
    chat_session, provider, buyer = _settled_session(client, db_session)

    client.delete(f"/chat-sessions/{chat_session.id}", headers=buyer)
    client.delete(f"/chat-sessions/{chat_session.id}", headers=provider)

    db_session.expire_all()
    stored = db_session.get(ChatSession, chat_session.id)
    assert stored.deleted_by_buyer_at is not None
    assert stored.deleted_by_provider_at is not None
    # The row itself stays: the money history still refers to it.
    assert stored is not None
