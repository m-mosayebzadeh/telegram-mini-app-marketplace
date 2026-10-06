"""
"Settings -> ways in" (TECHNICAL_REQUIREMENTS.md section 36): seeing the
ways into the account, connecting, swapping and taking them away, under the
owner's three rules — never the last one, only right after confirming
through one of them, and the owner told through the bot every time.
"""

from datetime import timedelta
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi.testclient import TestClient

from app.auth import google, sessions, telegram_bot
from app.auth import router as auth_router
from app.core.config import settings
from app.core.time import utcnow
from app.main import app
from app.models.auth_session import AuthIdentity, AuthSession
from app.models.user import User

SECRET = "webhook-secret"


@pytest.fixture
def ways(monkeypatch):
    """Google and the bot set up; Google's check faked (it accepts
    "<subject>|<nonce>" and vouches for <subject>@gmail.com); everything
    the bot would send kept here instead."""
    monkeypatch.setattr(settings, "google_client_id", "abc.apps.googleusercontent.com")
    monkeypatch.setattr(settings, "google_redirect_uri", "http://localhost:5174/api/auth/google/callback")
    monkeypatch.setattr(settings, "telegram_bot_username", "cosmos_test_bot")
    monkeypatch.setattr(settings, "telegram_webhook_secret", SECRET)
    monkeypatch.setattr(auth_router, "WAIT_HOLD_SECONDS", 1)

    def fake(credential, nonce):
        subject, _, said_nonce = credential.partition("|")
        if said_nonce != nonce:
            raise google.GoogleSignInError("bad")
        return google.GoogleAccount(
            subject=subject, first_name="Nika", last_name=None, label=sessions.mask_email(f"{subject}.person@gmail.com")
        )

    monkeypatch.setattr(google, "verify", fake)
    sent = []
    monkeypatch.setattr(telegram_bot, "call", lambda method, payload: sent.append((method, payload)))
    return sent


def _google_trip(page, subject, purpose=None, lang="fa"):
    """Off to Google and back as `subject`; returns where it lands."""
    went = page.get("/auth/google/start", params={"lang": lang, **({"purpose": purpose} if purpose else {})}, follow_redirects=False)
    assert went.status_code == 302, went.headers.get("location")
    query = {k: v[0] for k, v in parse_qs(urlparse(went.headers["location"]).query).items()}
    page.cookies.set(auth_router.GOOGLE_COOKIE, went.cookies.get(auth_router.GOOGLE_COOKIE))
    back = page.post(
        "/auth/google/callback", data={"id_token": f"{subject}|{query['nonce']}", "state": query["state"]}, follow_redirects=False
    )
    assert back.status_code == 303
    return back.headers["location"]


def _google_person(subject="g-1"):
    """A page signed in through Google, freshly (so: confirmed)."""
    page = TestClient(app)
    assert _google_trip(page, subject) == "/"
    return page


def _age(db_session, page, minutes=11):
    """This page's session, signed in a while ago: no longer confirmed."""
    row = db_session.query(AuthSession).filter_by(token_hash=sessions.hash_token(page.cookies.get(sessions.COOKIE))).one()
    row.confirmed_at = utcnow() - timedelta(minutes=minutes)
    db_session.commit()


def _telegram(client, update):
    return client.post("/telegram/webhook", json=update, headers={"X-Telegram-Bot-Api-Secret-Token": SECRET})


def _start_tapped(client, code, who):
    return _telegram(client, {"message": {"chat": {"id": who}, "from": {"id": who, "first_name": "Arash", "username": "arash_t", "language_code": "fa"}, "text": f"/start {code}"}})


def _yes(client, code, who):
    return _telegram(client, {"callback_query": {"id": "cb", "from": {"id": who, "language_code": "fa"}, "message": {"message_id": 5, "chat": {"id": who}}, "data": f"ok:{code}"}})


def _said(sent):
    return [payload.get("text", "") for method, payload in sent if method == "sendMessage"]


# --- the half-hidden address --------------------------------------------------


def test_an_address_is_kept_only_half_hidden():
    assert sessions.mask_email("m.mosaiebzadeh@gmail.com") == "m.m***h@gmail.com"
    assert sessions.mask_email("sara@gmail.com") == "s***a@gmail.com"
    assert sessions.mask_email("ab@gmail.com") == "a***@gmail.com"
    assert sessions.mask_email(None) is None


def test_signing_in_with_google_shows_which_account_it_was(client, db_session, ways):
    page = _google_person("g-1")
    listed = page.get("/auth/doors").json()
    assert listed["doors"] == [{"provider": "google", "label": "g-1***n@gmail.com"}]
    # The whole address is nowhere in the database.
    assert all("g-1.person@" not in (d.label or "") for d in db_session.query(AuthIdentity).all())


# --- rule 2: only right after confirming ----------------------------------------


def test_a_fresh_sign_in_is_confirmed_and_it_wears_off(client, db_session, ways):
    page = _google_person()
    assert page.get("/auth/doors").json()["confirmed"] is True
    _age(db_session, page)
    assert page.get("/auth/doors").json()["confirmed"] is False


def test_being_let_in_by_another_phone_does_not_count_as_confirming(db_session):
    user = User(first_name="Lea")
    db_session.add(user)
    db_session.commit()
    sessions.start_session(db_session, user, provider="device", user_agent="x")
    row = db_session.query(AuthSession).filter_by(user_id=user.id).one()
    assert not sessions.is_confirmed(row)


def test_confirming_through_the_connected_google_account(client, db_session, ways):
    page = _google_person("g-1")
    _age(db_session, page)
    assert _google_trip(page, "g-1", "confirm") == "/settings/ways?google=confirmed"
    assert page.get("/auth/doors").json()["confirmed"] is True


def test_another_google_account_cannot_confirm(client, db_session, ways):
    page = _google_person("g-1")
    _age(db_session, page)
    assert _google_trip(page, "g-other", "confirm") == "/settings/ways?google=not_yours"
    assert page.get("/auth/doors").json()["confirmed"] is False


# --- connecting and swapping Google -----------------------------------------------


def test_swapping_google_needs_confirming_first(client, db_session, ways):
    page = _google_person("g-1")
    _age(db_session, page)
    assert _google_trip(page, "g-2", "link") == "/settings/ways?google=confirm_first"


def test_swapping_google_for_another_account(client, db_session, ways):
    page = _google_person("g-1")
    assert _google_trip(page, "g-2", "link") == "/settings/ways?google=linked"
    me = page.get("/me").json()["id"]
    doors = db_session.query(AuthIdentity).filter_by(user_id=me, provider="google").all()
    assert [d.subject for d in doors] == ["g-2"]
    # The old account no longer leads here: it would make a new account.
    other = TestClient(app)
    _google_trip(other, "g-1")
    assert other.get("/me").json()["id"] != me


def test_a_google_account_that_is_somebody_elses_is_not_taken(client, db_session, ways):
    _google_person("g-taken")
    page = _google_person("g-1")
    assert _google_trip(page, "g-taken", "link") == "/settings/ways?google=taken"


# --- connecting Telegram through the bot ------------------------------------------


def test_connecting_telegram_through_the_bot_and_the_owner_is_told(client, db_session, ways):
    page = _google_person("g-1")
    asked = page.post("/auth/doors/telegram/start", json={"purpose": "link"}).json()
    _start_tapped(client, asked["code"], who=7001)
    assert "می‌خواهد این حسابِ تلگرام" in _said(ways)[-1]
    _yes(client, asked["code"], who=7001)
    claimed = page.post("/auth/doors/telegram/claim", json={"code": asked["code"], "secret": asked["secret"]})
    assert claimed.json() == {"done": "linked"}
    listed = page.get("/auth/doors").json()["doors"]
    assert {"provider": "telegram", "label": "@arash_t"} in listed
    me = db_session.get(User, page.get("/me").json()["id"])
    db_session.refresh(me)
    assert me.telegram_id == 7001
    # Rule 3: told, at the Telegram account now connected.
    assert any("وصل شد" in text for text in _said(ways))
    # And signing in through the bot with it now comes to this account.
    other = TestClient(app)
    again = other.post("/auth/telegram/start").json()
    _start_tapped(client, again["code"], who=7001)
    _yes(client, again["code"], who=7001)
    other.post("/auth/telegram/claim", json={"code": again["code"], "secret": again["secret"]})
    assert other.get("/me").json()["id"] == me.id


def test_a_telegram_account_that_is_somebody_elses_is_refused_by_the_bot(client, db_session, ways):
    taken = TestClient(app)
    first = taken.post("/auth/telegram/start").json()
    _start_tapped(client, first["code"], who=7001)
    _yes(client, first["code"], who=7001)
    taken.post("/auth/telegram/claim", json={"code": first["code"], "secret": first["secret"]})

    page = _google_person("g-1")
    asked = page.post("/auth/doors/telegram/start", json={"purpose": "link"}).json()
    _start_tapped(client, asked["code"], who=7001)
    assert _said(ways)[-1] == telegram_bot.WORDS["fa"]["taken"]
    waited = page.post("/auth/telegram/wait", json={"code": asked["code"], "secret": asked["secret"]}).json()
    assert waited == {"status": "refused", "seen": True, "problem": "taken"}


def test_a_yes_to_connecting_is_not_a_way_to_sign_in(client, db_session, ways):
    """Somebody makes a "connect" link and sends it to you; your "yes"
    connects your Telegram to THEIR account at most — it must never sign
    them in to yours."""
    victim = TestClient(app)
    mine = victim.post("/auth/telegram/start").json()
    _start_tapped(client, mine["code"], who=7001)
    _yes(client, mine["code"], who=7001)
    victim.post("/auth/telegram/claim", json={"code": mine["code"], "secret": mine["secret"]})

    attacker = _google_person("g-attacker")
    asked = attacker.post("/auth/doors/telegram/start", json={"purpose": "confirm"})
    assert asked.status_code == 409  # no Telegram to confirm with
    asked = attacker.post("/auth/doors/telegram/start", json={"purpose": "link"}).json()
    # Through the sign-in claim, the request is worth nothing.
    stranger = TestClient(app)
    assert stranger.post("/auth/telegram/claim", json={"code": asked["code"], "secret": asked["secret"]}).status_code == 409


def test_confirming_with_telegram_only_works_with_this_accounts_telegram(client, db_session, ways):
    page = TestClient(app)
    first = page.post("/auth/telegram/start").json()
    _start_tapped(client, first["code"], who=7001)
    _yes(client, first["code"], who=7001)
    page.post("/auth/telegram/claim", json={"code": first["code"], "secret": first["secret"]})
    _age(db_session, page)

    asked = page.post("/auth/doors/telegram/start", json={"purpose": "confirm"}).json()
    _start_tapped(client, asked["code"], who=8888)
    assert _said(ways)[-1] == telegram_bot.WORDS["fa"]["not_yours"]

    asked = page.post("/auth/doors/telegram/start", json={"purpose": "confirm"}).json()
    _start_tapped(client, asked["code"], who=7001)
    _yes(client, asked["code"], who=7001)
    assert page.post("/auth/doors/telegram/claim", json={"code": asked["code"], "secret": asked["secret"]}).json() == {"done": "confirmed"}
    assert page.get("/auth/doors").json()["confirmed"] is True


# --- taking a way away ----------------------------------------------------------


def test_the_last_way_in_cannot_be_taken_away(client, db_session, ways):
    page = _google_person("g-1")
    answer = page.delete("/auth/doors/google")
    assert answer.status_code == 409 and answer.json()["detail"]["reason"] == "last_way"


def test_taking_telegram_away_needs_confirming_and_tells_the_owner(client, db_session, ways):
    page = _google_person("g-1")
    asked = page.post("/auth/doors/telegram/start", json={"purpose": "link"}).json()
    _start_tapped(client, asked["code"], who=7001)
    _yes(client, asked["code"], who=7001)
    page.post("/auth/doors/telegram/claim", json={"code": asked["code"], "secret": asked["secret"]})

    _age(db_session, page)
    refused = page.delete("/auth/doors/telegram")
    assert refused.status_code == 403 and refused.json()["detail"]["reason"] == "confirm_first"

    _google_trip(page, "g-1", "confirm")
    ways.clear()
    assert page.delete("/auth/doors/telegram").status_code == 204
    assert [d["provider"] for d in page.get("/auth/doors").json()["doors"]] == ["google"]
    me = db_session.get(User, page.get("/me").json()["id"])
    db_session.refresh(me)
    assert me.telegram_id is None
    # Told at the Telegram account just taken away, which may be the real owner's.
    assert [(p["chat_id"], "برداشته شد" in p["text"]) for m, p in ways if m == "sendMessage"] == [(7001, True)]
