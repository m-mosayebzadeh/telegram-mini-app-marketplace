"""
Offers and requests running out, with nothing ticking.

Both deadlines are checked when somebody reads the thing, the same lazy pattern
the wallet uses to release due transactions and sessions use to close
themselves. The numbers come from the rates row because the right ones are a
judgement about how busy the market is, and that will change.
"""
from datetime import timedelta

import pytest

from app.core.config import settings
from app.core.rates import get_rates
from app.core.time import utcnow
from app.models.offer import Offer, OfferStatus
from app.models.request import EXPIRED_REASON, Request, RequestStatus
from tests.helpers import sign_init_data


def _auth(telegram_id: int, first_name: str = "Test") -> dict:
    return {"X-Telegram-Init-Data": sign_init_data({"id": telegram_id, "first_name": first_name})}


@pytest.fixture(autouse=True)
def owner(monkeypatch):
    monkeypatch.setattr(settings, "owner_telegram_id", 99)


def _offer(client, provider):
    return client.post(
        "/offers",
        headers=provider,
        json={"price_photons": 40, "session_duration_seconds": 1800, "title": "C", "description": "C"},
    ).json()


def _age_offer(db_session, offer_id, days):
    offer = db_session.get(Offer, offer_id)
    offer.created_at = utcnow() - timedelta(days=days)
    db_session.commit()


# --- offers ----------------------------------------------------------------


def test_a_stale_offer_leaves_the_showcase(client, db_session):
    """An offer from somebody who has since left is worse than no offer: a
    buyer spends one of their requests finding out."""
    provider, buyer = _auth(1, "Alice"), _auth(2, "Bob")
    client.get("/me", headers=provider)
    client.get("/me", headers=buyer)
    offer = _offer(client, provider)
    _age_offer(db_session, offer["id"], days=get_rates(db_session).offer_expiry_days + 1)

    showcase = client.get("/offers", headers=buyer).json()

    assert [row["id"] for row in showcase] == []


def test_an_offer_within_its_time_stays(client, db_session):
    provider, buyer = _auth(1, "Alice"), _auth(2, "Bob")
    client.get("/me", headers=provider)
    client.get("/me", headers=buyer)
    offer = _offer(client, provider)
    _age_offer(db_session, offer["id"], days=get_rates(db_session).offer_expiry_days - 1)

    showcase = client.get("/offers", headers=buyer).json()

    assert [row["id"] for row in showcase] == [offer["id"]]


def test_the_expiry_length_comes_from_the_panel(client, db_session):
    """Not a number buried in the code: how long a listing should last is a
    judgement about the market, and it changes."""
    provider, buyer = _auth(1, "Alice"), _auth(2, "Bob")
    client.get("/me", headers=provider)
    client.get("/me", headers=buyer)
    client.get("/me", headers=_auth(99, "Owner"))
    offer = _offer(client, provider)
    _age_offer(db_session, offer["id"], days=10)

    # Gone under a seven-day rule...
    assert client.get("/offers", headers=buyer).json() == []

    # ...and back under a thirty-day one.
    current = client.get("/admin/rates", headers=_auth(99, "Owner")).json()
    current.pop("updated_at", None)
    client.put(
        "/admin/rates", headers=_auth(99, "Owner"), json={**current, "offer_expiry_days": 30}
    )

    assert len(client.get("/offers", headers=buyer).json()) == 1


# --- requests --------------------------------------------------------------


def test_a_request_nobody_answered_runs_out(client, db_session):
    """Left pending it holds the buyer's one-live-request slot and tells them
    nothing, which is worse than being turned down."""
    provider, buyer = _auth(1, "Alice"), _auth(2, "Bob")
    client.get("/me", headers=provider)
    client.get("/me", headers=buyer)
    offer = _offer(client, provider)
    request = client.post("/requests", headers=buyer, json={"offer_id": offer["id"]}).json()
    stored = db_session.get(Request, request["id"])
    stored.created_at = utcnow() - timedelta(hours=get_rates(db_session).request_expiry_hours + 1)
    db_session.commit()

    rows = client.get("/requests/mine", headers=buyer).json()

    assert rows[0]["status"] == "cancelled"
    db_session.expire_all()
    assert db_session.get(Request, request["id"]).reason == EXPIRED_REASON


def test_running_out_is_told_apart_from_being_turned_down(client, db_session):
    """"Nobody answered" is a different fact about a buyer than "they changed
    their mind" — the trust summary counts only what the buyer actually did."""
    provider, buyer = _auth(1, "Alice"), _auth(2, "Bob")
    client.get("/me", headers=provider)
    client.get("/me", headers=buyer)
    offer = _offer(client, provider)
    request = client.post("/requests", headers=buyer, json={"offer_id": offer["id"]}).json()
    stored = db_session.get(Request, request["id"])
    stored.created_at = utcnow() - timedelta(hours=48)
    db_session.commit()

    client.get("/requests/mine", headers=buyer)

    db_session.expire_all()
    stored = db_session.get(Request, request["id"])
    assert stored.status == RequestStatus.CANCELLED
    assert stored.reason == EXPIRED_REASON  # not the buyer's own cancellation


def test_a_fresh_request_is_left_alone(client, db_session):
    provider, buyer = _auth(1, "Alice"), _auth(2, "Bob")
    client.get("/me", headers=provider)
    client.get("/me", headers=buyer)
    offer = _offer(client, provider)
    client.post("/requests", headers=buyer, json={"offer_id": offer["id"]})

    rows = client.get("/requests/mine", headers=buyer).json()

    assert rows[0]["status"] == "pending"


def test_an_answered_request_is_never_touched(client, db_session):
    """Expiry is only ever about silence."""
    provider, buyer = _auth(1, "Alice"), _auth(2, "Bob")
    client.get("/me", headers=provider)
    client.get("/me", headers=buyer)
    offer = _offer(client, provider)
    request = client.post("/requests", headers=buyer, json={"offer_id": offer["id"]}).json()
    client.post(f"/requests/{request['id']}/accept", headers=provider)
    stored = db_session.get(Request, request["id"])
    stored.created_at = utcnow() - timedelta(days=30)
    db_session.commit()

    client.get("/requests/mine", headers=buyer)

    db_session.expire_all()
    assert db_session.get(Request, request["id"]).status == RequestStatus.ACCEPTED


def test_a_stale_offer_is_not_deleted_only_taken_down(client, db_session):
    """The provider can put it back with one tap, and its requests still point
    at it."""
    provider = _auth(1, "Alice")
    client.get("/me", headers=provider)
    offer = _offer(client, provider)
    _age_offer(db_session, offer["id"], days=30)
    client.get("/offers", headers=_auth(2, "Bob"))

    db_session.expire_all()
    stored = db_session.get(Offer, offer["id"])
    assert stored is not None
    assert stored.deleted_at is None
