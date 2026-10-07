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
    assert _subscribe(other_client, "https://fcm.googleapis.com/fcm/send/bardia").status_code == 204
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
    thread, _, second = _people(client, other_client, db_session)
    # The words are shown only to somebody who chose to see them.
    assert other_client.put("/push/preview", json={"show": True}).status_code == 204
    _away(db_session, second)  # asking made them "here" again
    client.post(f"/conversations/{thread}/messages", data={"type": "text", "text": "are you coming tonight?"})
    assert sent == [("https://fcm.googleapis.com/fcm/send/bardia", {
        "title": "Sara",
        "body": "are you coming tonight?",
        "url": f"/conversations/{thread}",
        "tag": f"conversation-{thread}",
    })]


def test_by_default_a_notification_says_only_who_wrote(client, other_client, db_session, sent):
    """A lock screen is seen by whoever is next to it: until the person
    turns the words on, a notification names the writer and nothing more."""
    thread, _, second = _people(client, other_client, db_session)
    assert other_client.get("/me").json()["push_preview"] is False
    _away(db_session, second)  # asking made them "here" again
    client.post(f"/conversations/{thread}/messages", data={"type": "text", "text": "a secret"})
    assert sent[-1][1]["title"] == "Sara"
    assert sent[-1][1]["body"] == "sent a message"


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
    db_session.get(User, second).push_preview = True
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
    _subscribe(client, "https://fcm.googleapis.com/fcm/send/one")
    _subscribe(client, "https://fcm.googleapis.com/fcm/send/one")
    assert db_session.query(PushSubscription).count() == 1
    client.post("/push/unsubscribe", json={"endpoint": "https://fcm.googleapis.com/fcm/send/one"})
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
    _subscribe(client, "https://fcm.googleapis.com/fcm/send/gone")
    row = db_session.query(PushSubscription).one()

    class Gone:
        status_code = 410

    def refuse(**kwargs):
        raise pywebpush.WebPushException("gone", response=Gone())

    monkeypatch.setattr(pywebpush, "webpush", refuse)
    monkeypatch.setattr("app.core.database.SessionLocal", lambda: db_session)
    sender._send(row.id, row.endpoint, row.p256dh, row.auth, "{}")
    assert db_session.query(PushSubscription).count() == 0


@pytest.mark.parametrize("endpoint", [
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://web.push.apple.com/abc",
    "https://wns2-db5p.notify.windows.com/w/?token=abc",
])
def test_the_real_push_services_are_accepted(client, db_session, endpoint):
    sign_in(client, db_session, 9711, "Sara")
    assert _subscribe(client, endpoint).status_code == 204


@pytest.mark.parametrize("endpoint", [
    "http://fcm.googleapis.com/fcm/send/abc",  # not https
    "https://localhost/admin",  # somewhere inside
    "https://10.0.0.5/internal",
    "https://fcm.googleapis.com.evil.example/x",  # only looks like Google
    "https://user@fcm.googleapis.com/x",  # something hidden in front
    "https://fcm.googleapis.com:8443/x",  # another port
    "https://evilnotify.windows.com/x",
])
def test_any_other_address_is_refused(client, db_session, endpoint):
    """The server sends a request to this address for every message: it must
    never be somewhere the person chose."""
    sign_in(client, db_session, 9712, "Sara")
    answer = _subscribe(client, endpoint)
    assert answer.status_code == 400 and answer.json()["detail"]["reason"] == "not_a_push_service"
