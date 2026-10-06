"""
Signing in through our Telegram bot (TECHNICAL_REQUIREMENTS.md section 32):
the page asks, the person taps Start in Telegram, the bot asks "is it you?",
and "yes" from that same account signs the page in.
"""

import pytest
from fastapi.testclient import TestClient

from app.auth import telegram_bot
from app.auth import router as auth_router
from app.core.config import settings
from app.main import app
from app.models.auth_session import AuthIdentity
from app.models.user import User

SECRET = "webhook-secret"


@pytest.fixture
def bot(monkeypatch):
    """The bot set up, and everything it would send to Telegram kept here
    instead."""
    monkeypatch.setattr(settings, "telegram_bot_username", "cosmos_test_bot")
    monkeypatch.setattr(settings, "telegram_webhook_secret", SECRET)
    monkeypatch.setattr(auth_router, "WAIT_HOLD_SECONDS", 1)
    sent = []
    monkeypatch.setattr(telegram_bot, "call", lambda method, payload: sent.append((method, payload)))
    return sent


def _start(page):
    started = page.post("/auth/telegram/start", headers={"user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/120"})
    assert started.status_code == 200
    return started.json()


def _telegram(client, update, secret=SECRET):
    return client.post("/telegram/webhook", json=update, headers={"X-Telegram-Bot-Api-Secret-Token": secret})


def _start_tapped(client, code, who=7001, language="fa", first="Arash"):
    return _telegram(client, {
        "message": {
            "chat": {"id": who},
            "from": {"id": who, "is_bot": False, "first_name": first, "username": "arash_t", "language_code": language},
            "text": f"/start {code}",
        }
    })


def _button(client, code, choice="ok", who=7001):
    return _telegram(client, {
        "callback_query": {
            "id": "cb1",
            "from": {"id": who, "language_code": "fa"},
            "message": {"message_id": 55, "chat": {"id": who}},
            "data": f"{choice}:{code}",
        }
    })


def test_the_whole_way_in_through_the_bot(client, db_session, bot):
    page = TestClient(app)
    asked = _start(page)
    assert asked["link"] == f"https://t.me/cosmos_test_bot?start={asked['code']}"
    secret = {"code": asked["code"], "secret": asked["secret"]}

    assert _start_tapped(client, asked["code"]).status_code == 204
    # The bot asks, naming the device, with yes and no.
    method, payload = bot[-1]
    assert method == "sendMessage" and "Chrome · Windows" in payload["text"]
    assert [b["callback_data"] for b in payload["reply_markup"]["inline_keyboard"][0]] == [f"ok:{asked['code']}", f"no:{asked['code']}"]
    # The page hears that Start was tapped: "now confirm in Telegram".
    assert page.post("/auth/telegram/wait", json=secret).json() == {"status": "pending", "seen": True}
    assert page.post("/auth/telegram/claim", json=secret).status_code == 409  # not before "yes"

    _button(client, asked["code"], "ok")
    assert page.post("/auth/telegram/wait", json={**secret, "seen": True}).json()["status"] == "approved"
    assert page.post("/auth/telegram/claim", json=secret).status_code == 204
    me = page.get("/me").json()
    assert me["first_name"] == "Arash"
    assert db_session.query(AuthIdentity).filter_by(user_id=me["id"], provider="telegram", subject="7001").count() == 1
    # Used once.
    assert page.post("/auth/telegram/claim", json=secret).status_code == 409


def test_somebody_who_came_from_telegram_before_gets_their_own_account_back(client, db_session, bot):
    old = User(telegram_id=7002, first_name="Old")
    db_session.add(old)
    db_session.commit()
    page = TestClient(app)
    asked = _start(page)
    _start_tapped(client, asked["code"], who=7002)
    _button(client, asked["code"], who=7002)
    page.post("/auth/telegram/claim", json={"code": asked["code"], "secret": asked["secret"]})
    assert page.get("/me").json()["id"] == old.id


def test_only_the_account_that_tapped_start_can_say_yes(client, bot):
    """A link sent to somebody else: a different account cannot answer it,
    and cannot take it over by tapping Start too."""
    page = TestClient(app)
    asked = _start(page)
    _start_tapped(client, asked["code"], who=7001)
    _start_tapped(client, asked["code"], who=9999)
    assert "تمام شده" in bot[-1][1]["text"]
    _button(client, asked["code"], "ok", who=9999)
    assert page.post("/auth/telegram/claim", json={"code": asked["code"], "secret": asked["secret"]}).status_code == 409


def test_no_signs_nobody_in(client, bot):
    page = TestClient(app)
    asked = _start(page)
    secret = {"code": asked["code"], "secret": asked["secret"]}
    _start_tapped(client, asked["code"])
    _button(client, asked["code"], "no")
    assert page.post("/auth/telegram/wait", json={**secret, "seen": True}).json()["status"] == "refused"
    assert page.post("/auth/telegram/claim", json=secret).status_code == 409
    # The question is replaced by the outcome, so it cannot be tapped twice.
    assert ("editMessageText", {"chat_id": 7001, "message_id": 55, "text": telegram_bot.WORDS["fa"]["refused"]}) in bot


def test_only_telegram_can_talk_to_the_webhook(client, bot):
    asked = _start(TestClient(app))
    assert _telegram(client, {"message": {}}, secret="guess").status_code == 403
    forged = client.post("/telegram/webhook", json={"message": {"text": f"/start {asked['code']}"}})
    assert forged.status_code == 403


def test_a_plain_start_or_a_stale_link_is_answered_kindly(client, bot):
    _telegram(client, {"message": {"chat": {"id": 1}, "from": {"id": 1, "language_code": "en"}, "text": "/start"}})
    assert bot[-1][1]["text"] == telegram_bot.WORDS["en"]["hello"]
    _start_tapped(client, "no-such-code", language="en")
    assert bot[-1][1]["text"] == telegram_bot.WORDS["en"]["expired"]


def test_the_button_appears_only_when_the_bot_is_set_up(client, monkeypatch, bot):
    assert client.get("/auth/ways").json()["telegram"] is True
    monkeypatch.setattr(settings, "telegram_bot_username", None)
    assert client.get("/auth/ways").json()["telegram"] is False
    assert client.post("/auth/telegram/start").status_code == 404


def test_a_place_that_starts_too_many_bot_sign_ins_is_stopped(client, bot, monkeypatch):
    from app.auth import telegram_router

    # The real limit is two hundred; three makes the same point quickly.
    assert telegram_router.bot_starts.limit == 200
    monkeypatch.setattr(telegram_router.bot_starts, "limit", 3)
    page = TestClient(app)
    for _ in range(3):
        _start(page)
    assert page.post("/auth/telegram/start").json()["detail"]["reason"] == "too_many_tries"


def test_the_bot_answers_after_the_database_place_is_given_back(client, bot, monkeypatch):
    """A slow Telegram must not hold one of the few database places: what the
    bot says goes out only after the webhook's database session has closed."""
    from sqlalchemy.orm import Session

    order = []
    real_close = Session.close

    def close(self):
        order.append("db closed")
        return real_close(self)

    monkeypatch.setattr(Session, "close", close)
    monkeypatch.setattr(telegram_bot, "call", lambda method, payload: order.append(method))
    _telegram(client, {"message": {"from": {"id": 7001}, "chat": {"id": 7001}, "text": "hello"}})
    assert "sendMessage" in order
    assert order.index("db closed") < order.index("sendMessage")
