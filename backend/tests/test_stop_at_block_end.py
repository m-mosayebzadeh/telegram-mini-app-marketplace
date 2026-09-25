"""
Stopping a session at the end of the block that is running.

It costs exactly what closing immediately costs — the running block is paid for
either way. What it buys is the rest of the time already paid for, and, more
importantly, protection from an accident: without it, anyone who does not want
the next block has to watch the clock and press close before the boundary, and
being a few seconds late costs a whole block.
"""
from datetime import timedelta

from app.core.time import utcnow
from app.models.chat_session import ChatSession
from app.wallet.blocks import EndReason
from tests.helpers import give_wallet_balance, sign_init_data

RATE = 1000  # Toman per Photon, the fixed peg


def _auth(telegram_id: int, first_name: str = "Test") -> dict:
    return {"X-Telegram-Init-Data": sign_init_data({"id": telegram_id, "first_name": first_name})}


def _running_session(client, db_session, *, seconds_in=0):
    """A started session, optionally wound forward into its running time."""
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
    client.post(
        f"/chat-sessions/{chat_session.id}/messages",
        headers=provider,
        data={"type": "text", "text": "Hello"},
    )
    db_session.refresh(chat_session)
    if seconds_in:
        chat_session.started_at = utcnow() - timedelta(seconds=seconds_in)
        chat_session.scheduled_end_at = chat_session.started_at + timedelta(seconds=1800)
        db_session.commit()
    return chat_session, provider, buyer


def _wind_past(db_session, chat_session, seconds):
    """Moves the whole session back by the same amount, which is time passing
    without a clock to move. Every timestamp shifts together, so the distances
    between them — and therefore the block arithmetic — stay honest."""
    db_session.refresh(chat_session)
    chat_session.started_at -= timedelta(seconds=seconds)
    chat_session.scheduled_end_at -= timedelta(seconds=seconds)
    if chat_session.close_at_block_end_at is not None:
        chat_session.close_at_block_end_at -= timedelta(seconds=seconds)
    db_session.commit()


def test_the_session_stops_at_the_boundary_and_the_rest_comes_back(client, db_session):
    """Part-way through the second block: two blocks are paid for, and the two
    that never started go back to the buyer."""
    chat_session, _, buyer = _running_session(client, db_session, seconds_in=500)

    client.post(f"/chat-sessions/{chat_session.id}/stop-at-block-end", headers=buyer)
    _wind_past(db_session, chat_session, 500)  # the boundary is now behind us

    body = client.get(f"/chat-sessions/{chat_session.id}", headers=buyer).json()

    assert body["status"] == "closed"
    assert body["consumed_blocks"] == 2
    assert body["end_reason"] == EndReason.BUYER_CLOSED
    # 50 Photons in the wallet, 40 reserved, 20 consumed.
    assert client.get("/wallet/balance", headers=buyer).json()["balance_toman"] == 30 * RATE


def test_it_costs_the_same_as_closing_now_but_keeps_the_time(client, db_session):
    """The point of the feature: identical money, more conversation."""
    chat_session, _, buyer = _running_session(client, db_session, seconds_in=500)

    client.post(f"/chat-sessions/{chat_session.id}/stop-at-block-end", headers=buyer)

    # Still open, still usable, right up to the boundary.
    body = client.get(f"/chat-sessions/{chat_session.id}", headers=buyer).json()
    assert body["status"] == "open"
    assert body["close_at_block_end_by_user_id"] is not None
    assert body["i_asked_to_stop"] is True


def test_the_boundary_does_not_slide_into_the_next_block(client, db_session):
    """The failure this design avoids: a target worked out fresh each time
    would move forward with every new block, and the session would never
    actually stop."""
    # Asked for early in the FIRST block, so the boundary is the end of it.
    chat_session, _, buyer = _running_session(client, db_session, seconds_in=100)
    client.post(f"/chat-sessions/{chat_session.id}/stop-at-block-end", headers=buyer)

    # Enough time passes to be well inside what would have been block two.
    _wind_past(db_session, chat_session, 500)

    body = client.get(f"/chat-sessions/{chat_session.id}", headers=buyer).json()
    assert body["status"] == "closed"
    assert body["consumed_blocks"] == 1  # not two, and not still running


def test_changing_your_mind_puts_it_back_to_the_full_session(client, db_session):
    chat_session, _, buyer = _running_session(client, db_session, seconds_in=500)
    client.post(f"/chat-sessions/{chat_session.id}/stop-at-block-end", headers=buyer)

    body = client.delete(
        f"/chat-sessions/{chat_session.id}/stop-at-block-end", headers=buyer
    ).json()

    assert body["close_at_block_end_by_user_id"] is None
    assert body["status"] == "open"
    # And it now runs to the end it always had.
    _wind_past(db_session, chat_session, 500)
    assert client.get(f"/chat-sessions/{chat_session.id}", headers=buyer).json()["status"] == "open"


def test_only_whoever_asked_can_take_it_back(client, db_session):
    """The other participant cannot quietly overrule a decision to stop."""
    chat_session, provider, buyer = _running_session(client, db_session, seconds_in=500)
    client.post(f"/chat-sessions/{chat_session.id}/stop-at-block-end", headers=buyer)

    response = client.delete(
        f"/chat-sessions/{chat_session.id}/stop-at-block-end", headers=provider
    )

    assert response.status_code == 403


def test_the_provider_can_ask_to_stop_too(client, db_session):
    """And then the block that was running is still theirs — they did not cut
    it short, they let it finish."""
    chat_session, provider, buyer = _running_session(client, db_session, seconds_in=500)

    client.post(f"/chat-sessions/{chat_session.id}/stop-at-block-end", headers=provider)
    _wind_past(db_session, chat_session, 500)

    body = client.get(f"/chat-sessions/{chat_session.id}", headers=buyer).json()
    assert body["status"] == "closed"
    assert body["end_reason"] == EndReason.PROVIDER_CLOSED
    assert body["consumed_blocks"] == 2


def test_asking_twice_is_refused(client, db_session):
    chat_session, _, buyer = _running_session(client, db_session, seconds_in=500)
    client.post(f"/chat-sessions/{chat_session.id}/stop-at-block-end", headers=buyer)

    second = client.post(f"/chat-sessions/{chat_session.id}/stop-at-block-end", headers=buyer)

    assert second.status_code == 400


def test_the_two_controls_belong_to_different_parts_of_the_session(client, db_session):
    """Stopping early and asking for more are opposites, and they never appear
    together — not because anything forbids it, but because each belongs to a
    different moment. Stopping is pointless in the last block, where the
    session ends anyway; asking for more is premature before it."""
    # Part-way through: stopping is the one that makes sense.
    chat_session, _, buyer = _running_session(client, db_session, seconds_in=500)
    body = client.get(f"/chat-sessions/{chat_session.id}", headers=buyer).json()
    assert body["can_stop_at_block_end"] is True
    assert body["can_request_extension"] is False

    # In the last block, they swap over.
    _wind_past(db_session, chat_session, 900)
    body = client.get(f"/chat-sessions/{chat_session.id}", headers=buyer).json()
    assert body["can_stop_at_block_end"] is False
    assert body["can_request_extension"] is True


def test_stopping_in_the_last_block_is_refused_rather_than_ignored(client, db_session):
    """It would change nothing, and accepting it would leave a stored
    intention that has to be explained on screen without ever mattering."""
    chat_session, _, buyer = _running_session(client, db_session, seconds_in=1400)

    response = client.post(f"/chat-sessions/{chat_session.id}/stop-at-block-end", headers=buyer)

    assert response.status_code == 400
    assert response.json()["detail"]["reason"] == "already_last_block"


def test_the_server_refuses_the_combination_even_so(client, db_session):
    """A safety net under the screen's own logic: while a session is set to
    stop, more time cannot be bought for it."""
    chat_session, _, buyer = _running_session(client, db_session, seconds_in=500)
    client.post(f"/chat-sessions/{chat_session.id}/stop-at-block-end", headers=buyer)

    refused = client.post(f"/chat-sessions/{chat_session.id}/extension", headers=buyer)

    assert refused.status_code == 400
    assert refused.json()["detail"]["reason"] == "stopping_at_block_end"


def test_a_session_that_has_not_started_cannot_be_stopped_this_way(client, db_session):
    """There is no running block to stop at the end of."""
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

    response = client.post(f"/chat-sessions/{chat_session.id}/stop-at-block-end", headers=buyer)

    assert response.status_code == 400
