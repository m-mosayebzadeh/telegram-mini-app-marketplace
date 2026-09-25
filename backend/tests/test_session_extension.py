"""
Extending a running session by one more block.

Two rules shape all of this. The buyer asks and the provider answers — never
the other way round, because a provider able to offer more time would turn a
conversation into a sales pitch and bring back the incentive to stretch things
out that selling in blocks exists to remove. And the block is paid for at the
moment it is asked for, so the provider's tap can never land on a wallet that
has emptied in the meantime.
"""
from datetime import timedelta

from app.core.time import utcnow
from app.models.chat_session import ChatSession
from app.models.credit_ledger import CreditLedgerEntry, LedgerEntryType
from tests.helpers import give_wallet_balance, sign_init_data

RATE = 1000  # Toman per Photon, the fixed peg


def _auth(telegram_id: int, first_name: str = "Test") -> dict:
    return {"X-Telegram-Init-Data": sign_init_data({"id": telegram_id, "first_name": first_name})}


def _running_session(client, db_session, *, extra_balance=0):
    """A started session, optionally with room in the buyer's wallet to extend."""
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
    give_wallet_balance(db_session, buyer_id, amount_toman=(40 + extra_balance) * RATE)
    client.post(f"/requests/{request['id']}/pay", headers=buyer)

    chat_session = db_session.query(ChatSession).filter_by(request_id=request["id"]).one()
    client.post(
        f"/chat-sessions/{chat_session.id}/messages",
        headers=provider,
        data={"type": "text", "text": "Hello"},
    )
    db_session.refresh(chat_session)
    return chat_session, provider, buyer


def _into_last_block(db_session, chat_session, *, seconds_spare=400):
    """Winds the session forward to its final block, which is the only place
    more time can be asked for."""
    total = chat_session.block_duration_seconds * chat_session.reserved_blocks
    chat_session.started_at = utcnow() - timedelta(seconds=total - seconds_spare)
    chat_session.scheduled_end_at = chat_session.started_at + timedelta(seconds=total)
    db_session.commit()


def test_asking_holds_the_block_before_the_provider_answers(client, db_session):
    """So an acceptance is always safe: the money is already there."""
    chat_session, _, buyer = _running_session(client, db_session, extra_balance=10)
    _into_last_block(db_session, chat_session)

    body = client.post(f"/chat-sessions/{chat_session.id}/extension", headers=buyer).json()

    assert body["extension_pending"] is True
    assert body["reserved_blocks"] == 4  # not yet — the provider has not agreed
    assert client.get("/wallet/balance", headers=buyer).json()["balance_toman"] == 0


def test_accepting_adds_the_block_and_the_time_that_goes_with_it(client, db_session):
    chat_session, provider, buyer = _running_session(client, db_session, extra_balance=10)
    _into_last_block(db_session, chat_session)
    before = client.get(f"/chat-sessions/{chat_session.id}", headers=buyer).json()["ends_at"]
    client.post(f"/chat-sessions/{chat_session.id}/extension", headers=buyer)

    body = client.post(f"/chat-sessions/{chat_session.id}/extension/accept", headers=provider).json()

    assert body["extension_pending"] is False
    assert body["reserved_blocks"] == 5
    assert body["ends_at"] > before


def test_declining_gives_the_block_straight_back(client, db_session):
    """And the session carries on to the end it already had — saying no to
    more time is not ending early."""
    chat_session, provider, buyer = _running_session(client, db_session, extra_balance=10)
    _into_last_block(db_session, chat_session)
    client.post(f"/chat-sessions/{chat_session.id}/extension", headers=buyer)

    body = client.post(
        f"/chat-sessions/{chat_session.id}/extension/decline", headers=provider
    ).json()

    assert body["extension_pending"] is False
    assert body["status"] == "open"
    assert body["reserved_blocks"] == 4
    assert client.get("/wallet/balance", headers=buyer).json()["balance_toman"] == 10 * RATE


def test_a_buyer_can_keep_extending_one_block_at_a_time(client, db_session):
    chat_session, provider, buyer = _running_session(client, db_session, extra_balance=20)

    for expected in (5, 6):
        # Each new block moves the end along, so the buyer has to reach the
        # last one again before they can ask for another.
        _into_last_block(db_session, chat_session)
        client.post(f"/chat-sessions/{chat_session.id}/extension", headers=buyer)
        body = client.post(
            f"/chat-sessions/{chat_session.id}/extension/accept", headers=provider
        ).json()
        assert body["reserved_blocks"] == expected
        db_session.refresh(chat_session)


def test_only_one_request_can_be_waiting_at_a_time(client, db_session):
    chat_session, _, buyer = _running_session(client, db_session, extra_balance=20)
    _into_last_block(db_session, chat_session)
    client.post(f"/chat-sessions/{chat_session.id}/extension", headers=buyer)

    second = client.post(f"/chat-sessions/{chat_session.id}/extension", headers=buyer)

    assert second.status_code == 400
    # Only one block was ever held.
    held = (
        db_session.query(CreditLedgerEntry)
        .filter_by(chat_session_id=chat_session.id, type=LedgerEntryType.SESSION_HOLD)
        .count()
    )
    assert held == 2  # the session itself, plus the one extension


def test_a_provider_cannot_offer_more_time(client, db_session):
    """The rule that keeps a conversation from becoming a sales pitch."""
    chat_session, provider, _ = _running_session(client, db_session, extra_balance=10)
    _into_last_block(db_session, chat_session)

    response = client.post(f"/chat-sessions/{chat_session.id}/extension", headers=provider)

    assert response.status_code == 403


def test_a_buyer_cannot_answer_their_own_request(client, db_session):
    chat_session, _, buyer = _running_session(client, db_session, extra_balance=10)
    _into_last_block(db_session, chat_session)
    client.post(f"/chat-sessions/{chat_session.id}/extension", headers=buyer)

    response = client.post(f"/chat-sessions/{chat_session.id}/extension/accept", headers=buyer)

    assert response.status_code == 403


def test_a_buyer_who_cannot_pay_for_a_block_cannot_ask_for_one(client, db_session):
    """Better to say so now than to have the provider accept into thin air."""
    chat_session, _, buyer = _running_session(client, db_session)  # nothing spare
    _into_last_block(db_session, chat_session)

    response = client.post(f"/chat-sessions/{chat_session.id}/extension", headers=buyer)

    assert response.status_code == 402


def test_an_unanswered_request_is_refunded_when_the_session_ends(client, db_session):
    """A question nobody answered is not part of what was sold."""
    chat_session, _, buyer = _running_session(client, db_session, extra_balance=10)
    _into_last_block(db_session, chat_session)
    client.post(f"/chat-sessions/{chat_session.id}/extension", headers=buyer)
    # Run it out: the session ends with the question still open.
    chat_session.started_at = utcnow() - timedelta(seconds=1801)
    chat_session.scheduled_end_at = chat_session.started_at + timedelta(seconds=1800)
    db_session.commit()

    body = client.get(f"/chat-sessions/{chat_session.id}", headers=buyer).json()

    assert body["status"] == "closed"
    assert body["extension_pending"] is False
    # All four blocks were used, so only the held extension comes back.
    assert client.get("/wallet/balance", headers=buyer).json()["balance_toman"] == 10 * RATE


def test_a_session_that_has_not_started_cannot_be_extended(client, db_session):
    """There is nothing to extend until the provider has arrived."""
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
    give_wallet_balance(db_session, buyer_id, amount_toman=50 * RATE)
    client.post(f"/requests/{request['id']}/pay", headers=buyer)
    chat_session = db_session.query(ChatSession).filter_by(request_id=request["id"]).one()

    response = client.post(f"/chat-sessions/{chat_session.id}/extension", headers=buyer)

    assert response.status_code == 400


def test_more_time_cannot_be_asked_for_at_the_start(client, db_session):
    """Asking is a question about what happens next, so it belongs at the end.
    Allowing it from the first block would let someone stack up reservations
    long before they know whether they want more."""
    chat_session, _, buyer = _running_session(client, db_session, extra_balance=10)

    response = client.post(f"/chat-sessions/{chat_session.id}/extension", headers=buyer)

    assert response.status_code == 400
    assert response.json()["detail"]["reason"] == "not_in_last_block"


def test_the_screen_is_told_when_the_button_should_appear(client, db_session):
    """So the chat screen shows it only when pressing it would work — and
    never to a provider, who may not ask at all."""
    chat_session, provider, buyer = _running_session(client, db_session, extra_balance=10)

    early = client.get(f"/chat-sessions/{chat_session.id}", headers=buyer).json()
    assert early["can_request_extension"] is False

    _into_last_block(db_session, chat_session)
    assert client.get(f"/chat-sessions/{chat_session.id}", headers=buyer).json()[
        "can_request_extension"
    ] is True
    # Never for the provider, whatever the clock says.
    assert client.get(f"/chat-sessions/{chat_session.id}", headers=provider).json()[
        "can_request_extension"
    ] is False

    # And not while one is already waiting for an answer.
    client.post(f"/chat-sessions/{chat_session.id}/extension", headers=buyer)
    assert client.get(f"/chat-sessions/{chat_session.id}", headers=buyer).json()[
        "can_request_extension"
    ] is False
