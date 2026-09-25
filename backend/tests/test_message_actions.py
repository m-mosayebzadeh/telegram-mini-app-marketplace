"""
Replying to, editing, deleting and reacting to messages.

The rules come from TECHNICAL_REQUIREMENTS.md sections 24.1 and 29.13: in a
free conversation all of it is open; in a paid session a message can be
changed only briefly; and nothing, ever, is removed from the database.
"""

from datetime import timedelta
from types import SimpleNamespace

from app.chat_message.actions import PAID_GRACE, is_emoji, locked_by_session
from app.core.time import utcnow
from app.models.chat_message import ChatMessage
from app.models.message_actions import MessageEdit
from app.models.user import User
from tests.helpers import sign_init_data

CARD = "6037991234567893"


def _auth(telegram_id: int, first_name: str = "Test") -> dict:
    return {"X-Telegram-Init-Data": sign_init_data({"id": telegram_id, "first_name": first_name})}


def _pair(client, db_session, a, b):
    client.get("/me", headers=_auth(a, "Ali"))
    client.get("/me", headers=_auth(b, "Sara"))
    other = db_session.query(User).filter_by(telegram_id=b).one()
    thread = client.post("/conversations", json={"user_id": other.id}, headers=_auth(a)).json()
    return thread["id"]


def _say(client, thread, who, text, **extra):
    sent = client.post(
        f"/conversations/{thread}/messages", data={"text": text, **extra}, headers=_auth(who)
    )
    assert sent.status_code == 201, sent.text
    return sent.json()


def _texts(client, thread, who):
    listed = client.get(f"/conversations/{thread}/messages", headers=_auth(who)).json()
    return [m["text"] for m in listed]


# --- replying ------------------------------------------------------------


def test_a_reply_carries_a_quote_of_what_it_answers(client, db_session):
    thread = _pair(client, db_session, 8001, 8002)
    first = _say(client, thread, 8001, "coffee tomorrow?")
    reply = _say(client, thread, 8002, "yes!", reply_to_id=str(first["id"]))
    assert reply["reply_to"]["id"] == first["id"]
    assert reply["reply_to"]["text"] == "coffee tomorrow?"


def test_a_reply_cannot_quote_another_conversation(client, db_session):
    # The quote would carry that thread's words into this one.
    mine = _pair(client, db_session, 8003, 8004)
    theirs = _pair(client, db_session, 8005, 8006)
    private = _say(client, theirs, 8005, "private")
    sent = client.post(
        f"/conversations/{mine}/messages",
        data={"text": "hi", "reply_to_id": str(private["id"])},
        headers=_auth(8003),
    )
    assert sent.status_code == 404


def test_the_quote_disappears_when_the_original_is_deleted(client, db_session):
    thread = _pair(client, db_session, 8007, 8008)
    first = _say(client, thread, 8007, "oops")
    _say(client, thread, 8008, "what?", reply_to_id=str(first["id"]))
    client.post(
        f"/conversations/{thread}/messages/delete",
        json={"message_ids": [first["id"]], "for_everyone": True},
        headers=_auth(8007),
    )
    listed = client.get(f"/conversations/{thread}/messages", headers=_auth(8008)).json()
    assert listed[-1]["text"] == "what?"
    assert listed[-1]["reply_to"] is None


# --- editing -------------------------------------------------------------


def test_editing_changes_the_text_and_keeps_the_old_one(client, db_session):
    thread = _pair(client, db_session, 8010, 8011)
    sent = _say(client, thread, 8010, "helo")
    edited = client.patch(
        f"/conversations/{thread}/messages/{sent['id']}", json={"text": "hello"}, headers=_auth(8010)
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["text"] == "hello"
    assert edited.json()["edited_at"] is not None
    kept = db_session.query(MessageEdit).filter_by(message_id=sent["id"]).one()
    assert kept.previous_text == "helo"


def test_nobody_edits_somebody_else_s_message(client, db_session):
    thread = _pair(client, db_session, 8012, 8013)
    sent = _say(client, thread, 8012, "mine")
    edited = client.patch(
        f"/conversations/{thread}/messages/{sent['id']}", json={"text": "yours"}, headers=_auth(8013)
    )
    assert edited.status_code == 403


def test_an_edit_cannot_slip_a_card_number_past_the_warning(client, db_session):
    thread = _pair(client, db_session, 8014, 8015)
    sent = _say(client, thread, 8014, "hi")
    assert sent["flagged_payment"] is False
    edited = client.patch(
        f"/conversations/{thread}/messages/{sent['id']}", json={"text": CARD}, headers=_auth(8014)
    )
    assert edited.json()["flagged_payment"] is True


def test_editing_the_card_number_away_does_not_hide_it_from_staff(client, db_session):
    thread = _pair(client, db_session, 8016, 8017)
    sent = _say(client, thread, 8016, CARD)
    client.patch(f"/conversations/{thread}/messages/{sent['id']}", json={"text": "hi"}, headers=_auth(8016))
    assert db_session.get(ChatMessage, sent["id"]).flagged_payment is True


# --- deleting ------------------------------------------------------------


def test_deleting_your_own_for_everyone_removes_it_from_both_sides(client, db_session):
    thread = _pair(client, db_session, 8020, 8021)
    sent = _say(client, thread, 8020, "gone")
    done = client.post(
        f"/conversations/{thread}/messages/delete",
        json={"message_ids": [sent["id"]], "for_everyone": True},
        headers=_auth(8020),
    ).json()
    assert done["for_everyone"] == [sent["id"]]
    assert "gone" not in _texts(client, thread, 8020)
    assert "gone" not in _texts(client, thread, 8021)
    # Nothing is really deleted.
    assert db_session.get(ChatMessage, sent["id"]) is not None


def test_deleting_only_for_yourself_leaves_the_other_side_alone(client, db_session):
    thread = _pair(client, db_session, 8022, 8023)
    sent = _say(client, thread, 8022, "still here for them")
    client.post(
        f"/conversations/{thread}/messages/delete",
        json={"message_ids": [sent["id"]], "for_everyone": False},
        headers=_auth(8022),
    )
    assert "still here for them" not in _texts(client, thread, 8022)
    assert "still here for them" in _texts(client, thread, 8023)


def test_somebody_else_s_message_is_only_ever_deleted_for_you(client, db_session):
    thread = _pair(client, db_session, 8024, 8025)
    sent = _say(client, thread, 8024, "theirs")
    done = client.post(
        f"/conversations/{thread}/messages/delete",
        json={"message_ids": [sent["id"]], "for_everyone": True},
        headers=_auth(8025),
    ).json()
    assert done == {"for_everyone": [], "only_for_me": [sent["id"]]}
    assert "theirs" in _texts(client, thread, 8024)


def test_a_selection_is_deleted_in_one_request(client, db_session):
    thread = _pair(client, db_session, 8026, 8027)
    ids = [_say(client, thread, 8026, str(n))["id"] for n in range(3)]
    client.post(
        f"/conversations/{thread}/messages/delete",
        json={"message_ids": ids, "for_everyone": True},
        headers=_auth(8026),
    )
    assert _texts(client, thread, 8027) == []


def test_a_deleted_message_does_not_live_on_as_the_preview(client, db_session):
    thread = _pair(client, db_session, 8028, 8029)
    _say(client, thread, 8028, "first")
    last = _say(client, thread, 8028, "regret")
    client.post(
        f"/conversations/{thread}/messages/delete",
        json={"message_ids": [last["id"]], "for_everyone": True},
        headers=_auth(8028),
    )
    shown = client.get(f"/conversations/{thread}", headers=_auth(8029)).json()
    assert shown["last_text"] == "first"


# --- the paid-session rule ----------------------------------------------


def _paid(created_ago: timedelta, other_read_at=None):
    message = ChatMessage(sender_id=1, chat_session_id=5, created_at=utcnow() - created_ago)
    conversation = SimpleNamespace(
        participants=[
            SimpleNamespace(user_id=1, last_read_at=None),
            SimpleNamespace(user_id=2, last_read_at=other_read_at),
        ]
    )
    return conversation, message


def test_a_free_message_is_never_locked():
    message = ChatMessage(sender_id=1, chat_session_id=None, created_at=utcnow() - timedelta(days=30))
    assert locked_by_session(SimpleNamespace(participants=[]), message) is False


def test_a_paid_message_is_open_briefly_while_unread():
    conversation, message = _paid(timedelta(seconds=30))
    assert locked_by_session(conversation, message) is False


def test_a_paid_message_closes_once_read():
    conversation, message = _paid(timedelta(seconds=30), other_read_at=utcnow())
    assert locked_by_session(conversation, message) is True


def test_a_paid_message_closes_after_the_grace_even_unread():
    conversation, message = _paid(PAID_GRACE + timedelta(seconds=1))
    assert locked_by_session(conversation, message) is True


# --- reactions -----------------------------------------------------------


def test_reacting_replacing_and_taking_it_back(client, db_session):
    thread = _pair(client, db_session, 8030, 8031)
    sent = _say(client, thread, 8030, "news")
    path = f"/conversations/{thread}/messages/{sent['id']}/reaction"

    assert client.put(path, json={"emoji": "❤️"}, headers=_auth(8031)).status_code == 204
    client.put(path, json={"emoji": "😂"}, headers=_auth(8031))
    listed = client.get(f"/conversations/{thread}/messages", headers=_auth(8030)).json()
    assert [r["emoji"] for r in listed[0]["reactions"]] == ["😂"]

    client.put(path, json={"emoji": None}, headers=_auth(8031))
    listed = client.get(f"/conversations/{thread}/messages", headers=_auth(8030)).json()
    assert listed[0]["reactions"] == []


def test_a_reaction_cannot_carry_words():
    assert is_emoji("❤️") and is_emoji("👍🏽") and is_emoji("👨‍👩‍👧")
    assert not is_emoji("call me")
    assert not is_emoji("0912")
    assert not is_emoji("")
