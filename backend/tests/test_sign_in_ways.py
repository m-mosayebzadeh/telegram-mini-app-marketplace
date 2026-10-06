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
    """Google's check, faked: the real one asks Google for its keys. It
    still insists on the nonce the browser started with."""
    from app.core.config import settings

    monkeypatch.setattr(settings, "google_client_id", "abc.apps.googleusercontent.com")
    monkeypatch.setattr(settings, "google_redirect_uri", "http://localhost:5174/api/auth/google/callback")

    def fake(credential, nonce):
        if not ok or credential != f"token-for-{nonce}":
            raise google.GoogleSignInError("bad")
        return google.GoogleAccount(subject=subject, first_name=first, last_name=last)

    monkeypatch.setattr(google, "verify", fake)


def _go_to_google(client, lang="fa"):
    """The button's link: off to Google. Returns the state and nonce of
    this sign-in, as Google would see them."""
    from urllib.parse import parse_qs, urlparse

    went = client.get(f"/auth/google/start?lang={lang}", follow_redirects=False)
    assert went.status_code == 302
    query = {k: v[0] for k, v in parse_qs(urlparse(went.headers["location"]).query).items()}
    # The cookie is Secure (it must be, to come back from Google's site), and
    # the test client speaks plain http, so it is carried by hand.
    kept = went.cookies.get(auth_router.GOOGLE_COOKIE)
    assert kept == f"{query['state']}.{query['nonce']}"
    client.cookies.set(auth_router.GOOGLE_COOKIE, kept)
    return query


def _come_back(client, form):
    return client.post("/auth/google/callback", data=form, follow_redirects=False)


# --- Google ------------------------------------------------------------------


def test_the_button_leads_to_googles_chooser_asking_only_who_you_are(client, monkeypatch):
    _google(monkeypatch)
    query = _go_to_google(client)
    assert query["client_id"] == "abc.apps.googleusercontent.com"
    assert query["redirect_uri"] == "http://localhost:5174/api/auth/google/callback"
    assert query["scope"] == "openid profile email"  # the address, to show it half hidden; never mail
    assert query["response_mode"] == "form_post"  # the token never sits in an address
    assert query["hl"] == "fa"


def test_the_first_google_sign_in_makes_an_account_and_signs_in(client, db_session, monkeypatch):
    _google(monkeypatch)
    query = _go_to_google(client)
    back = _come_back(client, {"id_token": f"token-for-{query['nonce']}", "state": query["state"]})
    assert back.status_code == 303 and back.headers["location"] == "/"
    me = client.get("/me").json()  # known by the cookie from here on
    assert me["first_name"] == "Nika"
    user = db_session.get(User, me["id"])
    assert user.telegram_id is None
    assert db_session.query(AuthIdentity).filter_by(user_id=user.id, provider="google", subject="g-123").count() == 1


def test_the_same_google_account_is_the_same_person_next_time(client, monkeypatch):
    _google(monkeypatch)
    query = _go_to_google(client)
    _come_back(client, {"id_token": f"token-for-{query['nonce']}", "state": query["state"]})
    first_id = client.get("/me").json()["id"]
    client.post("/auth/sign-out")
    query = _go_to_google(client)
    _come_back(client, {"id_token": f"token-for-{query['nonce']}", "state": query["state"]})
    assert client.get("/me").json()["id"] == first_id


def test_an_answer_this_browser_did_not_ask_for_is_refused(client, monkeypatch):
    """Somebody else's Google sign-in, slipped into this browser, must not
    sign it in to their account."""
    _google(monkeypatch)
    query = _go_to_google(client)
    wrong_state = _come_back(client, {"id_token": f"token-for-{query['nonce']}", "state": "someone-elses"})
    assert wrong_state.headers["location"] == "/?signin=google_failed"
    client.cookies.clear()
    no_cookie = _come_back(client, {"id_token": f"token-for-{query['nonce']}", "state": query["state"]})
    assert no_cookie.headers["location"] == "/?signin=google_failed"
    assert client.get("/me").status_code == 401


def test_a_token_google_did_not_sign_is_refused(client, monkeypatch):
    _google(monkeypatch, ok=False)
    query = _go_to_google(client)
    back = _come_back(client, {"id_token": "forged", "state": query["state"]})
    assert back.headers["location"] == "/?signin=google_failed"
    assert client.get("/me").status_code == 401


def test_closing_googles_chooser_just_goes_back_quietly(client, monkeypatch):
    _google(monkeypatch)
    query = _go_to_google(client)
    back = _come_back(client, {"error": "access_denied", "state": query["state"]})
    assert back.headers["location"] == "/?signin=google_cancelled"


def test_google_is_refused_when_not_set_up(client, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "google_client_id", None)
    assert not google.ready()
    went = client.get("/auth/google/start", follow_redirects=False)
    assert went.headers["location"] == "/?signin=google_off"
    try:
        google.verify("anything", "n")
    except google.GoogleSignInError:
        pass
    else:
        raise AssertionError("should have refused")


def test_a_real_check_needs_no_email_since_none_is_asked_for(monkeypatch):
    """The scope is only "openid profile", so Google's token carries no
    address. Asking for a confirmed address refused every sign-in once."""
    from google.oauth2 import id_token

    from app.core.config import settings

    monkeypatch.setattr(settings, "google_client_id", "abc.apps.googleusercontent.com")
    claims = {"iss": "https://accounts.google.com", "sub": "g-9", "nonce": "n1", "given_name": "Nika"}
    monkeypatch.setattr(id_token, "verify_oauth2_token", lambda token, request, audience: claims)
    assert google.verify("t", "n1").subject == "g-9"
    try:
        google.verify("t", "another-sign-in")
    except google.GoogleSignInError:
        pass
    else:
        raise AssertionError("a token from another sign-in must be refused")


def test_the_sign_in_page_learns_which_ways_are_set_up(client, monkeypatch):
    _google(monkeypatch)
    assert client.get("/auth/ways").json()["google"] is True


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
    assert laptop.post("/auth/device/wait", json=secret).json()["status"] == "approved"
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
    assert laptop.post("/auth/device/wait", json=secret).json()["status"] == "pending"
    assert laptop.post("/auth/device/claim", json=secret).status_code == 409
    sign_in(client, db_session, 9320)
    assert client.post(f"/auth/device/{request['code']}/refuse").status_code == 204
    assert laptop.post("/auth/device/wait", json=secret).json()["status"] == "refused"


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


def test_the_waiting_device_hears_once_that_its_code_was_scanned(client, db_session, monkeypatch):
    monkeypatch.setattr(auth_router, "WAIT_HOLD_SECONDS", 1)
    laptop = TestClient(app)
    request = _start(laptop)
    secret = {"code": request["code"], "secret": request["secret"]}
    assert laptop.post("/auth/device/wait", json=secret).json() == {"status": "pending", "seen": False}
    sign_in(client, db_session, 9330)
    client.get(f"/auth/device/{request['code']}")  # the phone opened it
    # Told at once, not after the whole hold...
    assert laptop.post("/auth/device/wait", json=secret).json() == {"status": "pending", "seen": True}
    # ...and only once: a device that knows waits for the answer itself.
    assert laptop.post("/auth/device/wait", json={**secret, "seen": True}).json() == {"status": "pending", "seen": True}


def test_the_phone_wakes_the_waiting_device_instead_of_it_asking_every_second(monkeypatch):
    """The wait reads the database when it starts and when the hub wakes
    it, never on a clock: an approval arriving mid-wait ends it at once."""
    import asyncio

    from app.live.hub import hub

    states = iter(["pending", "approved"])
    looks = []

    def fake_look(db, payload, model=None):
        looks.append(1)
        return None

    monkeypatch.setattr(auth_router, "_own_request", fake_look)
    monkeypatch.setattr(auth_router, "_status", lambda row: next(states))
    monkeypatch.setattr(auth_router, "WAIT_HOLD_SECONDS", 20)

    class FakeDb:
        def expire_all(self):
            pass

        def close(self):
            pass

    async def scenario():
        payload = auth_router.DeviceWaitIn(code="ABCD2345", secret="s")
        waiting = asyncio.create_task(auth_router.wait_for_approval(payload, FakeDb()))
        await asyncio.sleep(0.2)
        hub.device_request_changed("ABCD2345")  # the phone approved
        return await asyncio.wait_for(waiting, 2)

    assert asyncio.run(scenario()) == {"status": "approved", "seen": False}
    assert len(looks) == 2  # once at the start, once when woken — not twenty times


def test_a_place_that_makes_too_many_codes_is_stopped(client, monkeypatch):
    # The real limit is two hundred; three makes the same point quickly.
    assert auth_router.device_starts.limit == 200
    monkeypatch.setattr(auth_router.device_starts, "limit", 3)
    laptop = TestClient(app)
    for _ in range(3):
        _start(laptop)
    refused = laptop.post("/auth/device/start")
    assert refused.status_code == 429
    assert refused.json()["detail"]["reason"] == "too_many_tries"


def test_tries_are_forgotten_as_the_window_passes(monkeypatch):
    from app.core import attempts

    clock = [1000.0]
    monkeypatch.setattr(attempts.time, "monotonic", lambda: clock[0])
    limit = attempts.Attempts(limit=2, window_seconds=600)
    assert limit.allow("a") and limit.allow("a")
    assert not limit.allow("a")
    assert limit.allow("b")  # somebody else is not held back
    clock[0] += 601
    assert limit.allow("a")
    assert list(limit._seen) == ["a"]  # "b" forgotten: memory stays bounded
