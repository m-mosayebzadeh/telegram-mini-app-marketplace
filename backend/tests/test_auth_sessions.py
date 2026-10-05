"""
Sessions (app/auth/sessions.py; TECHNICAL_REQUIREMENTS.md section 32):
every way in ends in a session of our own, kept in a cookie the page cannot
read, lasting ninety days from its last use, and closable from any other
device — after which that device is told it is signed out.
"""

from datetime import timedelta

from fastapi.testclient import TestClient

from app.auth import sessions
from app.core.time import utcnow
from app.main import app
from app.models.auth_session import AuthIdentity, AuthSession
from app.models.user import User
from tests.helpers import sign_in


def _sign_in(client, db_session, telegram_id: int) -> None:
    sign_in(client, db_session, telegram_id)
    assert sessions.COOKIE in client.cookies


def test_a_session_alone_says_who_this_is(client, db_session):
    _sign_in(client, db_session, 9100)
    me = client.get("/me")  # no Telegram header any more: the cookie is enough
    assert me.status_code == 200
    user = db_session.query(User).filter_by(telegram_id=9100).one()
    assert me.json()["id"] == user.id
    # The door is remembered, and only a hash of the token is stored.
    assert db_session.query(AuthIdentity).filter_by(user_id=user.id, provider="telegram").count() == 1
    row = db_session.query(AuthSession).filter_by(user_id=user.id).one()
    assert row.token_hash != client.cookies[sessions.COOKIE]
    assert len(row.token_hash) == 64


def test_nobody_signed_in_is_told_so(client):
    response = client.get("/me")
    assert response.status_code == 401
    assert response.json()["detail"]["reason"] == "signed_out"


def test_the_list_of_sessions_marks_this_device_first(client, db_session):
    _sign_in(client, db_session, 9110)
    other = TestClient(app)
    _sign_in(other, db_session, 9110)
    listed = client.get("/auth/sessions", headers={"user-agent": "x"}).json()
    assert len(listed) == 2
    assert listed[0]["current"] is True and listed[1]["current"] is False
    assert listed[0]["provider"] == "telegram"


def test_closing_another_device_signs_it_out_at_once(client, db_session):
    _sign_in(client, db_session, 9120)
    phone = TestClient(app)
    _sign_in(phone, db_session, 9120)
    assert phone.get("/me").status_code == 200
    closed = client.post("/auth/sessions/close-others").json()["closed"]
    assert closed == 1
    refused = phone.get("/me")
    assert refused.status_code == 401
    assert refused.json()["detail"]["reason"] == "signed_out"
    assert client.get("/me").status_code == 200  # this device stays in


def test_closing_one_session_from_the_list(client, db_session):
    _sign_in(client, db_session, 9125)
    phone = TestClient(app)
    _sign_in(phone, db_session, 9125)
    theirs = next(s for s in client.get("/auth/sessions").json() if not s["current"])
    assert client.delete(f"/auth/sessions/{theirs['id']}").status_code == 204
    assert phone.get("/me").status_code == 401
    # Nobody can close somebody else's session.
    stranger = TestClient(app)
    _sign_in(stranger, db_session, 9126)
    mine = next(s for s in client.get("/auth/sessions").json() if s["current"])
    assert stranger.delete(f"/auth/sessions/{mine['id']}").status_code == 404


def test_signing_out_clears_the_cookie_and_cannot_fail(client, db_session):
    _sign_in(client, db_session, 9130)
    assert client.post("/auth/sign-out").status_code == 204
    assert client.get("/me").status_code == 401
    # Again, with nothing left to close: still fine.
    assert client.post("/auth/sign-out").status_code == 204


def test_a_session_lasts_ninety_days_from_its_last_use(client, db_session):
    _sign_in(client, db_session, 9140)
    row = db_session.query(AuthSession).one()
    row.last_used_at = utcnow() - timedelta(days=89)
    db_session.commit()
    assert client.get("/me").status_code == 200  # used: the ninety days start again
    db_session.expire_all()
    assert utcnow() - db_session.query(AuthSession).one().last_used_at < timedelta(minutes=1)
    row = db_session.query(AuthSession).one()
    row.last_used_at = utcnow() - timedelta(days=91)
    db_session.commit()
    assert client.get("/me").status_code == 401


def test_a_closed_session_is_told_on_its_live_connection(client, db_session):
    _sign_in(client, db_session, 9150)
    phone = TestClient(app)
    _sign_in(phone, db_session, 9150)
    with phone.websocket_connect("/live") as socket:
        socket.send_json({"type": "hello"})
        assert socket.receive_json()["type"] == "ready"
        client.post("/auth/sessions/close-others")
        assert socket.receive_json() == {"type": "signed_out"}


def test_a_socket_with_a_closed_session_hears_signed_out(client, db_session):
    _sign_in(client, db_session, 9155)
    client.post("/auth/sign-out")
    # The cookie was cleared by signing out; send an old one by hand.
    stale = TestClient(app)
    _sign_in(stale, db_session, 9155)
    token = stale.cookies[sessions.COOKIE]
    stale.post("/auth/sign-out")
    stale.cookies.set(sessions.COOKIE, token)
    with stale.websocket_connect("/live") as socket:
        socket.send_json({"type": "hello"})
        assert socket.receive_json() == {"type": "signed_out"}


def test_deleting_an_account_signs_it_out_everywhere(client, db_session):
    _sign_in(client, db_session, 9160)
    phone = TestClient(app)
    _sign_in(phone, db_session, 9160)
    user_id = db_session.query(User).filter_by(telegram_id=9160).one().id
    assert client.delete("/me?sure=true").status_code == 204
    assert phone.get("/me").status_code == 401
    assert db_session.query(AuthIdentity).filter_by(user_id=user_id).count() == 0


def test_the_device_name_is_short_and_readable():
    ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Version/17.0 Mobile Safari/604.1"
    assert sessions.device_name(ua) == "Safari · iPhone"
    assert sessions.device_name("Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537") == "Chrome · Windows"
    assert sessions.device_name(None) == "?"


def test_development_sign_in_uses_a_real_session(client, monkeypatch):
    from app.core.config import settings
    from app.dev import router as dev

    if not any(r.path == "/dev/sign-in" for r in app.routes):
        # The development routes exist only with dev tools on.
        assert settings.enable_dev_tools is False
        return
    monkeypatch.setattr(dev, "_require_localhost", lambda request: None)
    assert client.post("/dev/sign-in", json={"telegram_id": 9170, "first_name": "Dev"}).status_code == 204
    assert client.get("/me").status_code == 200
    assert client.get("/auth/sessions").json()[0]["provider"] == "dev"
