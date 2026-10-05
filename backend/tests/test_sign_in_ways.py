"""
The ways in (TECHNICAL_REQUIREMENTS.md section 32): Google, and another
phone already signed in. Each ends in the same session cookie.
"""

from datetime import timedelta

from fastapi.testclient import TestClient

from app.auth import google, sessions
from app.auth import router as auth_router
from app.core.time import utcnow
from app.main import app
from app.models.auth_session import AuthIdentity, DeviceSignInRequest
from app.models.user import User
from tests.helpers import sign_in


def _google(monkeypatch, subject="g-123", first="Nika", last="Rahimi", ok=True):
    def fake(credential):
        if not ok:
            raise google.GoogleSignInError("bad")
        return google.GoogleAccount(subject=subject, first_name=first, last_name=last)

    monkeypatch.setattr(google, "verify", fake)


# --- Google ------------------------------------------------------------------


def test_the_first_google_sign_in_makes_an_account_and_signs_in(client, db_session, monkeypatch):
    _google(monkeypatch)
    answer = client.post("/auth/google", json={"credential": "token"})
    assert answer.status_code == 200 and answer.json() == {"new": True}
    me = client.get("/me").json()  # known by the cookie from here on
    assert me["first_name"] == "Nika"
    user = db_session.get(User, me["id"])
    assert user.telegram_id is None
    assert db_session.query(AuthIdentity).filter_by(user_id=user.id, provider="google", subject="g-123").count() == 1


def test_the_same_google_account_is_the_same_person_next_time(client, monkeypatch):
    _google(monkeypatch)
    first = client.post("/auth/google", json={"credential": "t"})
    first_id = client.get("/me").json()["id"]
    client.post("/auth/sign-out")
    again = client.post("/auth/google", json={"credential": "t"})
    assert again.json() == {"new": False}
    assert client.get("/me").json()["id"] == first_id
    assert first.status_code == 200


def test_a_token_google_did_not_sign_is_refused(client, monkeypatch):
    _google(monkeypatch, ok=False)
    refused = client.post("/auth/google", json={"credential": "forged"})
    assert refused.status_code == 401
    assert refused.json()["detail"]["reason"] == "google_refused"
    assert client.get("/me").status_code == 401


def test_google_is_refused_when_not_set_up(monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "google_client_id", None)
    try:
        google.verify("anything")
    except google.GoogleSignInError:
        pass
    else:
        raise AssertionError("should have refused")


def test_the_sign_in_page_learns_which_ways_are_set_up(client, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "google_client_id", "abc.apps.googleusercontent.com")
    assert client.get("/auth/ways").json()["google_client_id"] == "abc.apps.googleusercontent.com"


# --- another phone -------------------------------------------------------------


def _start(device_client):
    started = device_client.post("/auth/device/start", headers={"user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/120"})
    assert started.status_code == 200
    return started.json()


def test_a_phone_signs_a_new_device_in(client, db_session, monkeypatch):
    monkeypatch.setattr(auth_router, "WAIT_HOLD_SECONDS", 1)
    laptop = TestClient(app)
    request = _start(laptop)
    sign_in(client, db_session, 9300)  # the phone, already signed in

    seen = client.get(f"/auth/device/{request['code']}").json()
    assert seen["device"] == "Chrome · Windows" and seen["status"] == "pending"
    assert client.post(f"/auth/device/{request['code']}/approve").status_code == 204

    secret = {"code": request["code"], "secret": request["secret"]}
    assert laptop.post("/auth/device/wait", json=secret).json() == {"status": "approved"}
    assert laptop.post("/auth/device/claim", json=secret).status_code == 204
    me = laptop.get("/me").json()
    assert me["id"] == db_session.query(User).filter_by(telegram_id=9300).one().id
    assert any(s["provider"] == "device" for s in client.get("/auth/sessions").json())
    # Used once: the same request cannot sign anybody else in.
    assert laptop.post("/auth/device/claim", json=secret).status_code == 409


def test_only_the_device_that_asked_can_collect_the_session(client, db_session):
    laptop = TestClient(app)
    request = _start(laptop)
    sign_in(client, db_session, 9310)
    client.post(f"/auth/device/{request['code']}/approve")
    # Somebody who saw the code on the screen, but not the secret.
    stranger = TestClient(app)
    refused = stranger.post("/auth/device/claim", json={"code": request["code"], "secret": "guess"})
    assert refused.status_code == 409
    assert stranger.get("/me").status_code == 401


def test_nothing_happens_before_approval_and_a_refusal_is_told(client, db_session, monkeypatch):
    monkeypatch.setattr(auth_router, "WAIT_HOLD_SECONDS", 1)
    laptop = TestClient(app)
    request = _start(laptop)
    secret = {"code": request["code"], "secret": request["secret"]}
    assert laptop.post("/auth/device/wait", json=secret).json() == {"status": "pending"}
    assert laptop.post("/auth/device/claim", json=secret).status_code == 409
    sign_in(client, db_session, 9320)
    assert client.post(f"/auth/device/{request['code']}/refuse").status_code == 204
    assert laptop.post("/auth/device/wait", json=secret).json() == {"status": "refused"}


def test_a_request_lives_two_minutes(client, db_session):
    laptop = TestClient(app)
    request = _start(laptop)
    row = db_session.query(DeviceSignInRequest).filter_by(code=request["code"]).one()
    row.expires_at = utcnow() - timedelta(seconds=1)
    db_session.commit()
    sign_in(client, db_session, 9330)
    assert client.get(f"/auth/device/{request['code']}").status_code == 404
    assert client.post(f"/auth/device/{request['code']}/approve").status_code == 404


def test_approving_needs_somebody_signed_in(client):
    laptop = TestClient(app)
    request = _start(laptop)
    assert TestClient(app).post(f"/auth/device/{request['code']}/approve").status_code == 401


def test_codes_are_easy_to_type():
    for letter in "O0I1L":
        assert letter not in auth_router.CODE_LETTERS
    assert sessions.hash_token("x") != "x"
