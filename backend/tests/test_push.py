"""
Notifications when the app is closed (TECHNICAL_REQUIREMENTS.md section 38):
who is told, what they are told, and which devices stop being told.
"""

import json
from datetime import timedelta

import pytest

from app.auth import sessions
from app.core.config import settings
from app.core.time import utcnow
from app.models.auth_session import AuthSession
from app.models.chat_message import ChatMessage, ChatMessageType
from app.models.conversation import Conversation, ConversationParticipant
from app.models.push import PushSubscription
from app.models.user import User
from app.push import sender
from tests.helpers import sign_in


@pytest.fixture
def sent(monkeypatch):
    """Push set up, and every notification kept here instead of sent."""
    monkeypatch.setattr(settings, "vapid_public_key", "public")
    monkeypatch.setattr(settings, "vapid_private_key", "private")
    out = []

    class NowPool:
        def submit(self, fn, subscription_id, endpoint, p256dh, auth, data):
            out.append((endpoint, json.loads(data)))

    monkeypatch.setattr(sender, "_pool", NowPool())
    return out


def _subscribe(client, endpoint):
    return client.post("/push/subscribe", json={"endpoint": endpoint, "keys": {"p256dh": "k", "auth": "a"}})


def _away(db_session, user_id):
    user = db_session.get(User, user_id)
    user.last_seen_at = utcnow() - timedelta(minutes=10)
    db_session.commit()


def _people(client, other_client, db_session):
    """Two people with a conversation; the second has notifications on and
    has gone away. Returns (thread id, first id, second id)."""
    sign_in(client, db_session, 9701, "Sara")
    sign_in(other_client, db_session, 9702, "Bardia")
    first = client.get("/me").json()["id"]
    second = other_client.get("/me").json()["id"]
    assert _subscribe(other_client, "https://push.example/bardia").status_code == 204
    thread = client.post("/conversations", json={"user_id": second}).json()["id"]
    _away(db_session, second)
    return thread, first, second


@pytest.fixture
def other_client(client):
    """A second person, through the same test database."""
    from fastapi.testclient import TestClient

    from app.main import app

    return TestClient(app)


def test_somebody_away_is_told_of_a_message_with_its_words(client, other_client, db_session, sent):
    thread, _, _ = _people(client, other_client, db_session)
    client.post(f"/conversations/{thread}/messages", data={"type": "text", "text": "are you coming tonight?"})
    assert sent == [("https://push.example/bardia", {
        "title": "Sara",
        "body": "are you coming tonight?",
        "url": f"/conversations/{thread}",
        "tag": f"conversation-{thread}",
    })]


def test_somebody_here_now_is_not_told_twice(client, other_client, db_session, sent):
    thread, _, second = _people(client, other_client, db_session)
    db_session.get(User, second).last_seen_at = utcnow()  # the app is open: they hear it live
    db_session.commit()
    client.post(f"/conversations/{thread}/messages", data={"type": "text", "text": "hi"})
    assert sent == []


def test_a_muted_conversation_stays_quiet(client, other_client, db_session, sent):
    thread, _, second = _people(client, other_client, db_session)
    mine = db_session.query(ConversationParticipant).filter_by(conversation_id=thread, user_id=second).one()
    mine.muted = True
    db_session.commit()
    client.post(f"/conversations/{thread}/messages", data={"type": "text", "text": "hi"})
    assert sent == []


def test_a_signed_out_device_is_not_told_and_is_forgotten(client, other_client, db_session, sent):
    thread, _, second = _people(client, other_client, db_session)
    session = db_session.query(AuthSession).filter_by(user_id=second).one()
    sessions.close_session(db_session, session)
    client.post(f"/conversations/{thread}/messages", data={"type": "text", "text": "hi"})
    assert sent == []
    assert db_session.query(PushSubscription).count() == 0


def test_the_words_the_app_adds_are_in_the_readers_language(client, other_client, db_session, sent):
    thread, _, second = _people(client, other_client, db_session)
    db_session.get(User, second).language = "fa"
    db_session.commit()
    long = "x" * 300
    client.post(f"/conversations/{thread}/messages", data={"type": "text", "text": long})
    assert len(sent[-1][1]["body"]) == sender.PREVIEW
    # A photo: the app's own words, in the reader's language.
    first = client.get("/me").json()["id"]
    photo = ChatMessage(conversation_id=thread, sender_id=first, type=ChatMessageType.PHOTO, file_path="x.jpg")
    sender.message_sent(db_session, db_session.get(Conversation, thread), photo, db_session.get(User, first))
    assert sent[-1][1]["body"] == "یک عکس فرستاد"


def test_a_friend_request_is_told(client, other_client, db_session, sent):
    _, first, second = _people(client, other_client, db_session)
    client.post(f"/friends/{second}")
    assert sent[-1][1]["body"] == "wants to be your friend"
    assert sent[-1][1]["title"] == "Sara"


def test_one_browser_has_one_subscription_and_can_turn_it_off(client, db_session, sent):
    sign_in(client, db_session, 9711)
    _subscribe(client, "https://push.example/one")
    _subscribe(client, "https://push.example/one")
    assert db_session.query(PushSubscription).count() == 1
    client.post("/push/unsubscribe", json={"endpoint": "https://push.example/one"})
    assert db_session.query(PushSubscription).count() == 0
    assert _subscribe(client, "http://not-a-push-service").status_code == 400


def test_the_app_learns_whether_notifications_are_set_up(client, monkeypatch, sent):
    assert client.get("/push/key").json() == {"key": "public"}
    monkeypatch.setattr(settings, "vapid_private_key", None)
    assert client.get("/push/key").json() == {"key": None}


def test_a_browser_that_is_gone_is_forgotten(client, db_session, monkeypatch):
    """The push service says 410: notifications were turned off there."""
    import pywebpush

    sign_in(client, db_session, 9721)
    _subscribe(client, "https://push.example/gone")
    row = db_session.query(PushSubscription).one()

    class Gone:
        status_code = 410

    def refuse(**kwargs):
        raise pywebpush.WebPushException("gone", response=Gone())

    monkeypatch.setattr(pywebpush, "webpush", refuse)
    monkeypatch.setattr("app.core.database.SessionLocal", lambda: db_session)
    sender._send(row.id, row.endpoint, row.p256dh, row.auth, "{}")
    assert db_session.query(PushSubscription).count() == 0
