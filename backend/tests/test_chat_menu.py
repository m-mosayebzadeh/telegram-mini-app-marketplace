"""
The menu at the top of a chat (TECHNICAL_REQUIREMENTS.md section 32):
mute, clear history, and delete chat — the last two with an "also for
them" box, as the owner asked.

The line between the two that look alike: clearing the history leaves the
chat in the list, empty; deleting the chat takes it out of the list too.
Either way the messages stay stored, so a complaint can still be looked
into, and a new message brings a deleted chat back.
"""

from app.models.user import User
from tests.helpers import sign_init_data


def _auth(telegram_id: int, first_name: str = "Test") -> dict:
    return {"X-Telegram-Init-Data": sign_init_data({"id": telegram_id, "first_name": first_name})}


def _thread(client, db_session, me, other):
    """Two people, one chat, one message each way."""
    client.get("/me", headers=_auth(me, "Me"))
    client.get("/me", headers=_auth(other, "Other"))
    them = db_session.query(User).filter_by(telegram_id=other).one()
    thread = client.post("/conversations", json={"user_id": them.id}, headers=_auth(me)).json()["id"]
    client.post(f"/conversations/{thread}/messages", data={"text": "hello"}, headers=_auth(me))
    client.post(f"/conversations/{thread}/messages", data={"text": "hi there"}, headers=_auth(other))
    return thread


def _messages(client, thread, who):
    return client.get(f"/conversations/{thread}/messages", headers=_auth(who)).json()


def _listed(client, thread, who):
    return any(c["id"] == thread for c in client.get("/conversations", headers=_auth(who)).json())


def test_clearing_the_history_empties_the_chat_but_keeps_it_in_the_list(client, db_session):
    thread = _thread(client, db_session, 7100, 7101)
    assert client.post(f"/conversations/{thread}/clear", headers=_auth(7100)).status_code == 204
    assert _messages(client, thread, 7100) == []
    assert _listed(client, thread, 7100)
    # Only your side, unless the box is ticked.
    assert len(_messages(client, thread, 7101)) == 2


def test_clearing_for_both_empties_it_for_both(client, db_session):
    thread = _thread(client, db_session, 7102, 7103)
    client.post(f"/conversations/{thread}/clear?for_everyone=true", headers=_auth(7102))
    assert _messages(client, thread, 7102) == []
    assert _messages(client, thread, 7103) == []
    assert _listed(client, thread, 7103)


def test_what_was_cleared_is_no_longer_unread(client, db_session):
    thread = _thread(client, db_session, 7104, 7105)
    assert client.get("/conversations/unread", headers=_auth(7104)).json()["conversations"] == 1
    client.post(f"/conversations/{thread}/clear", headers=_auth(7104))
    assert client.get("/conversations/unread", headers=_auth(7104)).json()["conversations"] == 0


def test_deleting_the_chat_takes_it_out_of_the_list_until_somebody_writes(client, db_session):
    thread = _thread(client, db_session, 7106, 7107)
    assert client.delete(f"/conversations/{thread}", headers=_auth(7106)).status_code == 204
    assert not _listed(client, thread, 7106)
    assert _listed(client, thread, 7107)
    # Not a block: a new word brings it back, with only the new word in it.
    client.post(f"/conversations/{thread}/messages", data={"text": "still there?"}, headers=_auth(7107))
    assert _listed(client, thread, 7106)
    assert [m["text"] for m in _messages(client, thread, 7106)] == ["still there?"]


def test_deleting_for_both_takes_it_from_both(client, db_session):
    thread = _thread(client, db_session, 7108, 7109)
    client.delete(f"/conversations/{thread}?for_everyone=true", headers=_auth(7108))
    assert not _listed(client, thread, 7108)
    assert not _listed(client, thread, 7109)
    assert _messages(client, thread, 7109) == []


def test_a_muted_chat_is_not_counted_on_the_door(client, db_session):
    thread = _thread(client, db_session, 7110, 7111)
    assert client.post(f"/conversations/{thread}/mute", headers=_auth(7110)).status_code == 204
    row = next(c for c in client.get("/conversations", headers=_auth(7110)).json() if c["id"] == thread)
    assert row["muted"] is True
    # Still marked unread on its own row; just not counted on the door.
    assert row["unread"] is True
    assert client.get("/conversations/unread", headers=_auth(7110)).json()["conversations"] == 0

    client.post(f"/conversations/{thread}/mute?muted=false", headers=_auth(7110))
    assert client.get("/conversations/unread", headers=_auth(7110)).json()["conversations"] == 1


def test_a_stranger_cannot_clear_or_mute_somebody_else_s_chat(client, db_session):
    thread = _thread(client, db_session, 7112, 7113)
    client.get("/me", headers=_auth(7114, "Stranger"))
    assert client.post(f"/conversations/{thread}/clear?for_everyone=true", headers=_auth(7114)).status_code == 404
    assert client.delete(f"/conversations/{thread}?for_everyone=true", headers=_auth(7114)).status_code == 404
    assert client.post(f"/conversations/{thread}/mute", headers=_auth(7114)).status_code == 404
    assert len(_messages(client, thread, 7112)) == 2


# --- pinning (the selection bar on the list, section 32) ----------------


def _many(client, db_session, me, others):
    client.get("/me", headers=_auth(me, "Me"))
    threads = []
    for other in others:
        client.get("/me", headers=_auth(other, f"P{other}"))
        them = db_session.query(User).filter_by(telegram_id=other).one()
        thread = client.post("/conversations", json={"user_id": them.id}, headers=_auth(me)).json()["id"]
        client.post(f"/conversations/{thread}/messages", data={"text": "hi"}, headers=_auth(me))
        threads.append(thread)
    return threads


def _order(client, who):
    return [c["id"] for c in client.get("/conversations", headers=_auth(who)).json()]


def test_pinned_chats_come_first_the_first_pinned_highest(client, db_session):
    threads = _many(client, db_session, 7200, [7201, 7202, 7203, 7204])
    # Without pins: newest first.
    assert _order(client, 7200) == list(reversed(threads))
    client.post(f"/conversations/{threads[0]}/pin", headers=_auth(7200))
    client.post(f"/conversations/{threads[1]}/pin", headers=_auth(7200))
    order = _order(client, 7200)
    assert order[:2] == [threads[0], threads[1]]
    assert order[2:] == [threads[3], threads[2]]
    rows = client.get("/conversations", headers=_auth(7200)).json()
    assert [r["pinned"] for r in rows] == [True, True, False, False]


def test_unpinning_puts_a_chat_back_in_its_place(client, db_session):
    threads = _many(client, db_session, 7210, [7211, 7212])
    client.post(f"/conversations/{threads[0]}/pin", headers=_auth(7210))
    client.post(f"/conversations/{threads[0]}/pin?pinned=false", headers=_auth(7210))
    assert _order(client, 7210) == [threads[1], threads[0]]


def test_no_more_than_five_pinned(client, db_session):
    threads = _many(client, db_session, 7220, [7221, 7222, 7223, 7224, 7225, 7226])
    for thread in threads[:5]:
        assert client.post(f"/conversations/{thread}/pin", headers=_auth(7220)).status_code == 204
    refused = client.post(f"/conversations/{threads[5]}/pin", headers=_auth(7220))
    assert refused.status_code == 409
    assert refused.json()["detail"] == {"reason": "pin_limit", "limit": 5}


def test_a_pin_is_yours_alone(client, db_session):
    threads = _many(client, db_session, 7230, [7231])
    client.post(f"/conversations/{threads[0]}/pin", headers=_auth(7230))
    theirs = client.get("/conversations", headers=_auth(7231)).json()
    assert theirs[0]["pinned"] is False
