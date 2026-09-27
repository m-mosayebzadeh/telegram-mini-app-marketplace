"""
The payment window: once the offerer confirms, the requester has a limited
time to pay (TECHNICAL_REQUIREMENTS.md section 16, fifteen minutes by
default, editable from the panel).

Before this existed, a request confirmed and never paid held the offerer's
one open slot for ever, and every later confirmation failed — which is how
the owner found it.
"""

from datetime import timedelta

from app.core.rates import get_rates
from app.core.time import utcnow
from app.models.request import UNPAID_REASON, Request, RequestStatus
from tests.helpers import give_wallet_balance, sign_init_data


def _auth(telegram_id: int, name: str = "Test") -> dict:
    return {"X-Telegram-Init-Data": sign_init_data({"id": telegram_id, "first_name": name})}


def _login(client, telegram_id: int, name: str) -> dict:
    return client.get("/me", headers=_auth(telegram_id, name)).json()


def _offer(client, telegram_id: int) -> dict:
    return client.post(
        "/offers",
        headers=_auth(telegram_id),
        json={"price_photons": 40, "session_duration_seconds": 1800, "title": "Talk", "description": "d"},
    ).json()


def _request(client, telegram_id: int, offer: dict) -> dict:
    return client.post("/requests", headers=_auth(telegram_id), json={"offer_id": offer["id"]}).json()


def _age(db_session, request_id: int, minutes: int) -> None:
    """Pretends the confirmation happened `minutes` ago."""
    db_session.expire_all()
    request = db_session.get(Request, request_id)
    request.responded_at = utcnow() - timedelta(minutes=minutes)
    db_session.commit()


def _setup(client):
    _login(client, 9101, "Offerer")
    _login(client, 9102, "Arash")
    _login(client, 9103, "Bob")
    offer = _offer(client, 9101)
    first = _request(client, 9102, offer)
    second = _request(client, 9103, offer)
    assert client.post(f"/requests/{first['id']}/accept", headers=_auth(9101)).status_code == 200
    return offer, first, second


def _activity(client, telegram_id: int) -> list[dict]:
    return client.get("/requests/activity", headers=_auth(telegram_id)).json()


def test_a_confirmed_request_says_when_it_must_be_paid_by(client, db_session):
    _, first, _ = _setup(client)
    row = next(r for r in _activity(client, 9102) if r["id"] == first["id"])
    assert row["pay_by"] is not None
    window = get_rates(db_session).start_window_minutes
    assert window == 15


def test_while_unpaid_the_slot_is_held(client, db_session):
    _, _, second = _setup(client)
    refused = client.post(f"/requests/{second['id']}/accept", headers=_auth(9101))
    assert refused.status_code == 400
    detail = refused.json()["detail"]
    assert detail["reason"] == "provider_has_open_accepted_request"
    # Enough for the app to say who is ahead and until when.
    assert detail["blocking_user_id"] is not None
    assert detail["frees_at"] is not None


def test_a_card_waiting_behind_it_knows_who_is_ahead(client, db_session):
    _, _, second = _setup(client)
    row = next(r for r in _activity(client, 9101) if r["id"] == second["id"])
    assert row["queued_behind_name"] == "Arash"
    assert row["frees_at"] is not None


def test_once_the_window_passes_the_slot_comes_free(client, db_session):
    _, first, second = _setup(client)
    _age(db_session, first["id"], 16)

    accepted = client.post(f"/requests/{second['id']}/accept", headers=_auth(9101))
    assert accepted.status_code == 200

    db_session.expire_all()
    ran_out = db_session.get(Request, first["id"])
    assert ran_out.status == RequestStatus.CANCELLED
    assert ran_out.reason == UNPAID_REASON


def test_it_closes_at_the_deadline_not_when_somebody_looked(client, db_session):
    _, first, _ = _setup(client)
    _age(db_session, first["id"], 60)
    db_session.expire_all()
    confirmed_at = db_session.get(Request, first["id"]).responded_at
    _activity(client, 9102)
    db_session.expire_all()
    closed_at = db_session.get(Request, first["id"]).responded_at
    assert closed_at - confirmed_at == timedelta(minutes=15)


def test_paying_after_the_window_is_refused(client, db_session):
    _, first, _ = _setup(client)
    arash = db_session.query(Request).get(first["id"]).buyer_id
    give_wallet_balance(db_session, arash, 1_000_000)
    _age(db_session, first["id"], 16)
    late = client.post(f"/requests/{first['id']}/pay", headers=_auth(9102))
    assert late.status_code == 409
    assert late.json()["detail"]["reason"] == "pay_window_closed"


def test_paying_in_time_still_works(client, db_session):
    _, first, _ = _setup(client)
    arash = db_session.query(Request).get(first["id"]).buyer_id
    give_wallet_balance(db_session, arash, 1_000_000)
    _age(db_session, first["id"], 14)
    paid = client.post(f"/requests/{first['id']}/pay", headers=_auth(9102))
    assert paid.status_code == 201, paid.text


def test_the_window_comes_from_the_panel(client, db_session):
    _, first, second = _setup(client)
    rates = get_rates(db_session)
    rates.start_window_minutes = 5
    db_session.commit()
    _age(db_session, first["id"], 6)
    assert client.post(f"/requests/{second['id']}/accept", headers=_auth(9101)).status_code == 200


def test_both_people_are_told_when_it_runs_out(client, db_session):
    """The requester's countdown and the offerer's queued card both change
    at once, over the live connection."""
    _, first, _ = _setup(client)
    _age(db_session, first["id"], 16)
    socket = client.websocket_connect("/live")
    live = socket.__enter__()
    try:
        live.send_json({"type": "hello", "credentials": _auth(9101)["X-Telegram-Init-Data"]})
        assert live.receive_json() == {"type": "ready"}
        _activity(client, 9102)
        assert live.receive_json() == {"type": "requests"}
    finally:
        socket.__exit__(None, None, None)
