"""
The block model: reserving a session's price, and deciding how much of it was
actually used when it ends.

The rules under test come from TECHNICAL_REQUIREMENTS.md section 15. The one
worth keeping in mind while reading: blocks advance on wall-clock time, not on
who is connected, which is what makes all of this plain arithmetic.
"""
from datetime import timedelta

import pytest

from app.core.time import utcnow
from app.models.chat_session import ChatSession
from app.models.credit_ledger import CreditLedgerEntry, LedgerEntryType
from app.models.transaction import Transaction
from app.wallet.blocks import EndReason, close_and_settle, close_if_due, consumed_blocks_for
from tests.helpers import give_wallet_balance, sign_init_data

RATE = 1000  # Toman per Photon, the fixed peg


def _auth(telegram_id: int, first_name: str = "Test") -> dict:
    return {"X-Telegram-Init-Data": sign_init_data({"id": telegram_id, "first_name": first_name})}


def _running_session(client, db_session, *, price_photons=40, duration=1800, provider_speaks=True):
    """A provider, a buyer, an accepted request, and a session under way."""
    provider, buyer = _auth(1, "Alice"), _auth(2, "Bob")
    client.get("/me", headers=provider)
    buyer_id = client.get("/me", headers=buyer).json()["id"]
    offer = client.post(
        "/offers",
        headers=provider,
        json={
            "price_photons": price_photons,
            "session_duration_seconds": duration,
            "title": "Chat",
            "description": "Chat",
        },
    ).json()
    request = client.post("/requests", headers=buyer, json={"offer_id": offer["id"]}).json()
    client.post(f"/requests/{request['id']}/accept", headers=provider)
    give_wallet_balance(db_session, buyer_id, amount_toman=price_photons * RATE)
    client.post(f"/requests/{request['id']}/pay", headers=buyer)

    chat_session = db_session.query(ChatSession).filter_by(request_id=request["id"]).one()
    if provider_speaks:
        client.post(
            f"/chat-sessions/{chat_session.id}/messages",
            headers=provider,
            data={"type": "text", "text": "Hello"},
        )
        # That message started the clock; pick the new timestamps up.
        db_session.refresh(chat_session)
    return chat_session, provider, buyer, buyer_id


def _start_ago(db_session, chat_session, seconds):
    """Back-dates the moment the provider started it, so the session looks
    that many seconds into its running time."""
    chat_session.started_at = utcnow() - timedelta(seconds=seconds)
    chat_session.scheduled_end_at = chat_session.started_at + timedelta(
        seconds=chat_session.block_duration_seconds * chat_session.reserved_blocks
    )
    db_session.commit()


# --- reserving -------------------------------------------------------------


def test_starting_reserves_the_whole_price_up_front(client, db_session):
    """Not block by block: four separate debits would each be a chance to fail,
    and failing half way through a conversation is the worst possible moment."""
    chat_session, _, buyer, buyer_id = _running_session(client, db_session)

    hold = (
        db_session.query(CreditLedgerEntry)
        .filter_by(chat_session_id=chat_session.id, type=LedgerEntryType.SESSION_HOLD)
        .one()
    )
    assert hold.amount_toman == -40 * RATE
    assert hold.user_id == buyer_id
    assert client.get("/wallet/balance", headers=buyer).json()["balance_toman"] == 0


def test_a_buyer_who_cannot_cover_the_whole_session_cannot_start_it(client, db_session):
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
    # One block short of the full price.
    give_wallet_balance(db_session, buyer_id, amount_toman=30 * RATE)

    response = client.post(f"/requests/{request['id']}/pay", headers=buyer)

    assert response.status_code == 402
    assert db_session.query(ChatSession).count() == 0


# --- the asymmetric rule ---------------------------------------------------


@pytest.mark.parametrize(
    "seconds_in,reason,expected",
    [
        # The buyer pays for the block that is running, including its very
        # first second — they have taken the provider's slot either way.
        (0, EndReason.BUYER_CLOSED, 1),
        (1, EndReason.BUYER_CLOSED, 1),
        (500, EndReason.BUYER_CLOSED, 2),
        (1000, EndReason.BUYER_CLOSED, 3),
        # A provider who stops early does not keep the block they cut short,
        # otherwise they could take a block's money and leave immediately.
        (0, EndReason.PROVIDER_CLOSED, 0),
        (500, EndReason.PROVIDER_CLOSED, 1),
        (1000, EndReason.PROVIDER_CLOSED, 2),
        # Finished blocks belong to the provider no matter who closed.
        (1800, EndReason.BUYER_CLOSED, 4),
        (1800, EndReason.PROVIDER_CLOSED, 4),
        # Never started: nothing is owed at all, whatever the clock says.
        (1800, EndReason.NOT_STARTED, 0),
    ],
)
def test_consumed_blocks_follow_who_stopped_it(client, db_session, seconds_in, reason, expected):
    chat_session, _, _, _ = _running_session(client, db_session)
    at = chat_session.started_at + timedelta(seconds=seconds_in)

    assert consumed_blocks_for(chat_session, reason=reason, at=at) == expected


# --- settling --------------------------------------------------------------


def test_unused_blocks_come_straight_back_with_nothing_to_wait_for(client, db_session):
    """Nobody has a claim on money for time that was never sold, so holding it
    through a settlement window would only punish the buyer for stopping."""
    chat_session, _, buyer, _ = _running_session(client, db_session)
    _start_ago(db_session, chat_session, 500)  # part-way through the second block

    close_and_settle(
        db_session,
        chat_session,
        reason=EndReason.BUYER_CLOSED,
        closed_by_user_id=chat_session.request.buyer_id,
        at=utcnow(),
    )
    db_session.commit()

    assert chat_session.consumed_blocks == 2
    assert chat_session.consumed_toman == 20 * RATE
    assert chat_session.released_toman == 20 * RATE
    # Back in the buyer's spendable balance immediately.
    assert client.get("/wallet/balance", headers=buyer).json()["balance_toman"] == 20 * RATE


def test_what_was_used_becomes_a_pending_transaction_with_its_commission(client, db_session):
    chat_session, provider, _, _ = _running_session(client, db_session)
    _start_ago(db_session, chat_session, 500)

    close_and_settle(
        db_session,
        chat_session,
        reason=EndReason.BUYER_CLOSED,
        closed_by_user_id=chat_session.request.buyer_id,
        at=utcnow(),
    )
    db_session.commit()

    transaction = db_session.query(Transaction).filter_by(request_id=chat_session.request_id).one()
    assert transaction.gross_price_photons == 20  # two blocks of ten
    assert transaction.commission_photons == 2  # the 10% chat commission
    assert transaction.net_provider_photons == 18
    assert transaction.status.value == "pending"  # the settlement window still applies
    # The provider is owed it but cannot spend it yet.
    wallet = client.get("/wallet/balance", headers=provider).json()
    assert wallet["balance_toman"] == 0
    assert wallet["pending_toman"] == 18 * RATE


def test_a_session_the_provider_never_joined_costs_the_buyer_nothing(client, db_session):
    """No judgement is involved: the clock only starts when the provider
    speaks, so a provider who never arrives has sold no time at all."""
    chat_session, _, buyer, _ = _running_session(client, db_session, provider_speaks=False)

    client.post(f"/chat-sessions/{chat_session.id}/close", headers=buyer)

    db_session.refresh(chat_session)
    assert chat_session.end_reason == EndReason.NOT_STARTED
    assert chat_session.consumed_blocks == 0
    assert db_session.query(Transaction).count() == 0
    assert client.get("/wallet/balance", headers=buyer).json()["balance_toman"] == 40 * RATE


# --- closing itself, without a scheduler -----------------------------------


def test_a_session_past_its_end_closes_when_someone_looks_at_it(client, db_session):
    """The lazy sweep that stands in for a background job: nothing ticks, and
    the state is simply correct whenever it is next read."""
    chat_session, _, buyer, _ = _running_session(client, db_session)
    _start_ago(db_session, chat_session, 1801)  # one second past the end

    body = client.get(f"/chat-sessions/{chat_session.id}", headers=buyer).json()

    assert body["status"] == "closed"
    assert body["end_reason"] == EndReason.COMPLETED
    assert body["consumed_blocks"] == 4
    # Every block was used, so nothing came back.
    assert client.get("/wallet/balance", headers=buyer).json()["balance_toman"] == 0


def test_a_session_still_within_its_time_is_left_alone(client, db_session):
    chat_session, _, buyer, _ = _running_session(client, db_session)
    _start_ago(db_session, chat_session, 1799)

    body = client.get(f"/chat-sessions/{chat_session.id}", headers=buyer).json()

    assert body["status"] == "open"


def test_settling_twice_changes_nothing(client, db_session):
    """Two readers hitting the sweep at once must not settle twice."""
    chat_session, _, _, _ = _running_session(client, db_session)
    _start_ago(db_session, chat_session, 1801)

    close_if_due(db_session, chat_session)
    close_if_due(db_session, chat_session)

    assert db_session.query(Transaction).filter_by(request_id=chat_session.request_id).count() == 1
    assert (
        db_session.query(CreditLedgerEntry)
        .filter_by(chat_session_id=chat_session.id, type=LedgerEntryType.SESSION_HOLD)
        .count()
        == 1
    )


# --- when the clock starts -------------------------------------------------
#
# The provider's first message, not the moment the money was reserved. The
# buyer should not pay for the wait, and making the start an act of the
# provider's is what removes any need for a separate no-show rule.


def test_a_reserved_session_has_not_started_yet(client, db_session):
    chat_session, _, buyer, _ = _running_session(client, db_session, provider_speaks=False)

    body = client.get(f"/chat-sessions/{chat_session.id}", headers=buyer).json()

    assert body["status"] == "open"
    assert body["started_at"] is None
    assert body["consumed_blocks"] == 0


def test_the_buyer_writing_first_does_not_start_the_clock(client, db_session):
    """Saying "I am here" while waiting is the natural thing to do, and it
    must not cost anything."""
    chat_session, _, buyer, _ = _running_session(client, db_session, provider_speaks=False)

    client.post(
        f"/chat-sessions/{chat_session.id}/messages",
        headers=buyer,
        data={"type": "text", "text": "Hi, I am here"},
    )

    db_session.refresh(chat_session)
    assert chat_session.started_at is None


def test_the_provider_first_message_starts_the_clock(client, db_session):
    chat_session, provider, _, _ = _running_session(client, db_session, provider_speaks=False)

    client.post(
        f"/chat-sessions/{chat_session.id}/messages",
        headers=provider,
        data={"type": "text", "text": "Hello"},
    )

    db_session.refresh(chat_session)
    assert chat_session.started_at is not None
    assert chat_session.scheduled_end_at == chat_session.started_at + timedelta(seconds=1800)


def test_later_provider_messages_do_not_move_the_start(client, db_session):
    """Otherwise every reply would push the end of the session further out."""
    chat_session, provider, _, _ = _running_session(client, db_session)
    first_start = chat_session.started_at

    client.post(
        f"/chat-sessions/{chat_session.id}/messages",
        headers=provider,
        data={"type": "text", "text": "Still here"},
    )

    db_session.refresh(chat_session)
    assert chat_session.started_at == first_start


def test_a_reservation_nobody_started_expires_on_its_own(client, db_session):
    """After the length it was sold as — reusing a number the buyer already
    knows, so a forgotten reservation cleans itself up rather than sitting on
    their money."""
    chat_session, _, buyer, _ = _running_session(client, db_session, provider_speaks=False)
    chat_session.opened_at = utcnow() - timedelta(seconds=1801)
    db_session.commit()

    body = client.get(f"/chat-sessions/{chat_session.id}", headers=buyer).json()

    assert body["status"] == "closed"
    assert body["end_reason"] == EndReason.NOT_STARTED
    assert body["closed_by_user_id"] is None  # the system, not a person
    assert client.get("/wallet/balance", headers=buyer).json()["balance_toman"] == 40 * RATE


def test_the_provider_can_tidy_up_a_reservation_they_never_joined(client, db_session):
    """Same outcome, and who closed it is what tells the two apart."""
    chat_session, provider, buyer, _ = _running_session(client, db_session, provider_speaks=False)

    client.post(f"/chat-sessions/{chat_session.id}/close", headers=provider)

    db_session.refresh(chat_session)
    assert chat_session.end_reason == EndReason.NOT_STARTED
    assert chat_session.closed_by_user_id is not None
    assert client.get("/wallet/balance", headers=buyer).json()["balance_toman"] == 40 * RATE


# --- finding your way back -------------------------------------------------


def test_the_live_session_is_findable_from_anywhere(client, db_session):
    """The app shows a bar on every screen while a session runs, and it has to
    be right after a close, a reopen, or a crash — so it comes from the server
    each time rather than from anything the client remembers."""
    chat_session, provider, buyer, _ = _running_session(client, db_session)

    for who in (buyer, provider):
        body = client.get("/chat-sessions/live", headers=who).json()
        assert body is not None
        assert body["id"] == chat_session.id
        assert body["ends_at"] is not None


def test_a_reserved_session_still_counts_as_live(client, db_session):
    """Waiting for the provider to arrive is exactly when the buyer most needs
    the way back."""
    chat_session, _, buyer, _ = _running_session(client, db_session, provider_speaks=False)

    body = client.get("/chat-sessions/live", headers=buyer).json()

    assert body is not None
    assert body["started_at"] is None


def test_there_is_no_live_session_once_it_has_closed(client, db_session):
    chat_session, _, buyer, _ = _running_session(client, db_session)
    client.post(f"/chat-sessions/{chat_session.id}/close", headers=buyer)

    assert client.get("/chat-sessions/live", headers=buyer).json() is None


def test_a_session_past_its_time_is_not_reported_as_live(client, db_session):
    """It is swept on the way past, so the bar disappears by itself rather
    than pointing at something already over."""
    chat_session, _, buyer, _ = _running_session(client, db_session)
    _start_ago(db_session, chat_session, 1801)

    assert client.get("/chat-sessions/live", headers=buyer).json() is None
