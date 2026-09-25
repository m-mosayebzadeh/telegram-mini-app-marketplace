"""
The wallet history: what happened to this wallet, as the reader would tell it.

The ledger is the truth but not the story. A single conversation writes up to
four ledger rows for its buyer, so showing ledger rows would show one chat as
several unrelated amounts and put the machinery on display. These tests pin the
telling, not the bookkeeping.
"""
import pytest

from app.core.config import settings
from tests.helpers import give_wallet_balance, sign_init_data
from tests.test_content_endpoints import _upload

RATE = 1000  # Toman per Photon, the fixed peg


@pytest.fixture(autouse=True)
def owner(monkeypatch):
    """The withdrawal helpers borrowed below act as staff, which needs an
    owner to exist — the same fixture their own module uses."""
    monkeypatch.setattr(settings, "owner_telegram_id", 99)


def _auth(telegram_id: int, first_name: str = "Test") -> dict:
    return {"X-Telegram-Init-Data": sign_init_data({"id": telegram_id, "first_name": first_name})}


def _history(client, who):
    return client.get("/wallet/history", headers=who).json()


def _running_chat(client, db_session, *, price_photons=40):
    provider, buyer = _auth(1, "Alice"), _auth(2, "Bob")
    client.get("/me", headers=provider)
    buyer_id = client.get("/me", headers=buyer).json()["id"]
    offer = client.post(
        "/offers",
        headers=provider,
        json={
            "price_photons": price_photons,
            "session_duration_seconds": 1800,
            "title": "Evening chat",
            "description": "C",
        },
    ).json()
    request = client.post("/requests", headers=buyer, json={"offer_id": offer["id"]}).json()
    client.post(f"/requests/{request['id']}/accept", headers=provider)
    give_wallet_balance(db_session, buyer_id, amount_toman=price_photons * RATE)
    client.post(f"/requests/{request['id']}/pay", headers=buyer)
    session_id = client.get("/chat-sessions/mine", headers=buyer).json()[0]["id"]
    client.post(
        f"/chat-sessions/{session_id}/messages",
        headers=provider,
        data={"type": "text", "text": "Hello"},
    )
    return session_id, provider, buyer


def test_a_top_up_reads_as_one_row(client, db_session):
    buyer = _auth(2, "Bob")
    buyer_id = client.get("/me", headers=buyer).json()["id"]
    give_wallet_balance(db_session, buyer_id, amount_toman=50 * RATE)

    rows = _history(client, buyer)

    assert len(rows) == 1
    assert rows[0]["kind"] == "top_up"
    assert rows[0]["amount_photons"] == 50
    assert rows[0]["amount_toman"] == 50 * RATE
    assert rows[0]["status"] == "settled"


def test_one_conversation_is_one_row_not_four(client, db_session):
    """The reason this layer exists: a chat writes a reservation and a refund
    and possibly two more, and none of that is the reader's business."""
    session_id, _, buyer = _running_chat(client, db_session)
    client.post(f"/chat-sessions/{session_id}/close", headers=buyer)

    rows = [row for row in _history(client, buyer) if row["kind"] == "chat_payment"]

    assert len(rows) == 1
    # One block of four was used, so that is what it cost — not the 40 that
    # were reserved, and not the 30 that came back.
    assert rows[0]["amount_photons"] == -10


def test_a_running_conversation_shows_what_is_reserved(client, db_session):
    """The buyer's money has left their wallet; without this it looks lost."""
    _, _, buyer = _running_chat(client, db_session)

    row = [r for r in _history(client, buyer) if r["kind"] == "chat_payment"][0]

    assert row["status"] == "in_progress"
    assert row["amount_photons"] == -40  # all of it, until it is known


def test_the_provider_sees_money_that_has_not_arrived_yet(client, db_session):
    """Otherwise a provider whose session just ended sees nothing at all for a
    day and concludes they were not paid."""
    session_id, provider, buyer = _running_chat(client, db_session)
    client.post(f"/chat-sessions/{session_id}/close", headers=buyer)

    row = [r for r in _history(client, provider) if r["kind"] == "chat_earning"][0]

    assert row["status"] == "awaiting_settlement"
    assert row["amount_photons"] == 9  # one block of ten, less the commission


def test_settling_moves_the_same_row_to_settled(client, db_session):
    session_id, provider, buyer = _running_chat(client, db_session)
    client.post(f"/chat-sessions/{session_id}/close", headers=buyer)
    client.post(f"/chat-sessions/{session_id}/confirm-settlement", headers=buyer)
    client.post(f"/chat-sessions/{session_id}/confirm-settlement", headers=provider)

    rows = [r for r in _history(client, provider) if r["kind"] == "chat_earning"]

    assert len(rows) == 1  # still one row, not a second one for the release
    assert rows[0]["status"] == "settled"


def test_a_dispute_is_visible_as_such(client, db_session):
    session_id, provider, buyer = _running_chat(client, db_session)
    client.post(f"/chat-sessions/{session_id}/close", headers=buyer)
    client.post(f"/chat-sessions/{session_id}/dispute", headers=provider)

    row = [r for r in _history(client, buyer) if r["kind"] == "chat_payment"][0]

    assert row["status"] == "disputed"


def test_no_row_ever_names_the_other_person(client, db_session):
    """A list that reads "25 Photons from Sara" is a problem the moment somebody
    glances at the screen."""
    session_id, provider, buyer = _running_chat(client, db_session)
    client.post(f"/chat-sessions/{session_id}/close", headers=buyer)

    for who in (buyer, provider):
        for row in _history(client, who):
            assert "Alice" not in str(row)
            assert "Bob" not in str(row)


def test_a_chat_row_says_what_it_was_about_and_leads_there(client, db_session):
    """A history nobody can check against anything is not a history — but who
    it was with stays one deliberate tap away."""
    session_id, _, buyer = _running_chat(client, db_session)

    row = [r for r in _history(client, buyer) if r["kind"] == "chat_payment"][0]

    assert row["subject"] == "Evening chat"
    assert row["chat_session_id"] == session_id


# --- content ---------------------------------------------------------------


def _sold_content(client, db_session, *, price_photons=20):
    seller, buyer = _auth(1, "Alice"), _auth(2, "Bob")
    client.get("/me", headers=seller)
    buyer_id = client.get("/me", headers=buyer).json()["id"]
    item = _upload(client, seller, is_paid=True, price_photons=price_photons).json()
    give_wallet_balance(db_session, buyer_id, amount_toman=price_photons * RATE)
    client.post(f"/content/{item['id']}/purchase", headers=buyer)
    return item, seller, buyer


def test_a_sale_and_a_purchase_are_the_same_event_seen_from_two_sides(client, db_session):
    item, seller, buyer = _sold_content(client, db_session)

    sale = [r for r in _history(client, seller) if r["kind"] == "content_sale"][0]
    purchase = [r for r in _history(client, buyer) if r["kind"] == "content_purchase"][0]

    assert purchase["amount_photons"] == -20  # what the buyer paid
    assert sale["amount_photons"] == 19  # what the seller kept, after commission
    assert sale["status"] == purchase["status"] == "settled"


def test_a_buyers_purchase_always_leads_somewhere(client, db_session):
    """Even after the seller takes it down — they keep what they paid for."""
    item, seller, buyer = _sold_content(client, db_session)
    client.delete(f"/content/{item['id']}", headers=seller)

    row = [r for r in _history(client, buyer) if r["kind"] == "content_purchase"][0]

    assert row["content_id"] == item["id"]


def test_a_sellers_deleted_item_leads_nowhere_rather_than_to_a_dead_end(client, db_session):
    """They cannot open it any more, so the row deliberately does not offer to
    take them there."""
    item, seller, _ = _sold_content(client, db_session)
    client.delete(f"/content/{item['id']}", headers=seller)

    row = [r for r in _history(client, seller) if r["kind"] == "content_sale"][0]

    assert row["content_id"] is None


# --- money entering and leaving --------------------------------------------


def test_a_withdrawal_shows_while_it_is_still_being_paid_out(client, db_session):
    from tests.test_withdrawals import BANK, auth, create, payload, setup

    user_id, bank = setup(client, db_session)
    create(client, payload(client, bank))

    row = [r for r in _history(client, auth(1)) if r["kind"] == "withdrawal"][0]

    assert row["status"] == "awaiting_settlement"
    assert row["amount_photons"] < 0
    assert row["chat_session_id"] is None and row["content_id"] is None


def test_a_cancelled_withdrawal_reads_as_money_coming_back(client, db_session):
    from tests.test_withdrawals import auth, create, payload, setup

    _, bank = setup(client, db_session)
    withdrawal_id = create(client, payload(client, bank)).json()["id"]
    client.post(f"/wallet/withdrawals/{withdrawal_id}/cancel", headers=auth(1))

    rows = [r for r in _history(client, auth(1)) if "withdrawal" in r["kind"]]

    assert len(rows) == 1
    assert rows[0]["kind"] == "withdrawal_refund"
    assert rows[0]["amount_photons"] > 0


def test_the_newest_thing_is_first(client, db_session):
    item, _, buyer = _sold_content(client, db_session)

    rows = _history(client, buyer)

    assert [row["at"] for row in rows] == sorted((row["at"] for row in rows), reverse=True)
