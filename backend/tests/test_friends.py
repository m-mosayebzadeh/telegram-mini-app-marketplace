"""
Friends, two-way (TECHNICAL_REQUIREMENTS.md section 32, step 4): asking,
answering, the requests waiting, the lists, mutual friends first, and who
may see somebody's list.
"""

from app.models.user import User
from tests.helpers import sign_init_data


def _auth(telegram_id: int, first_name: str = "Test") -> dict:
    return {"X-Telegram-Init-Data": sign_init_data({"id": telegram_id, "first_name": first_name})}


def _user(client, db_session, telegram_id, name):
    client.get("/me", headers=_auth(telegram_id, name))
    return db_session.query(User).filter_by(telegram_id=telegram_id).one()


def _befriend(client, a_tg, b_tg, b_id, a_id):
    client.post(f"/friends/{b_id}", headers=_auth(a_tg))
    client.post(f"/friends/{a_id}/accept", headers=_auth(b_tg))


def test_asking_and_accepting_makes_two_people_friends(client, db_session):
    ali = _user(client, db_session, 7300, "Ali")
    sara = _user(client, db_session, 7301, "Sara")
    assert client.post(f"/friends/{sara.id}", headers=_auth(7300)).json()["status"] == "requested"
    assert client.get(f"/profiles/{sara.id}", headers=_auth(7300)).json()["friend_status"] == "requested"
    assert client.get(f"/profiles/{ali.id}", headers=_auth(7301)).json()["friend_status"] == "incoming"
    assert client.get("/me", headers=_auth(7301)).json()["pending_friend_requests_count"] == 1
    assert [p["user_id"] for p in client.get("/friends/requests", headers=_auth(7301)).json()] == [ali.id]

    assert client.post(f"/friends/{ali.id}/accept", headers=_auth(7301)).json()["status"] == "friends"
    assert [p["user_id"] for p in client.get("/friends", headers=_auth(7300)).json()] == [sara.id]
    assert [p["user_id"] for p in client.get("/friends", headers=_auth(7301)).json()] == [ali.id]
    assert client.get("/me", headers=_auth(7301)).json()["pending_friend_requests_count"] == 0


def test_asking_somebody_who_already_asked_you_is_a_yes(client, db_session):
    ali = _user(client, db_session, 7310, "Ali")
    sara = _user(client, db_session, 7311, "Sara")
    client.post(f"/friends/{sara.id}", headers=_auth(7310))
    assert client.post(f"/friends/{ali.id}", headers=_auth(7311)).json()["status"] == "friends"


def test_you_cannot_accept_your_own_request(client, db_session):
    _user(client, db_session, 7320, "Ali")
    sara = _user(client, db_session, 7321, "Sara")
    client.post(f"/friends/{sara.id}", headers=_auth(7320))
    assert client.post(f"/friends/{sara.id}/accept", headers=_auth(7320)).status_code == 404


def test_no_and_unfriend_leave_nothing_behind(client, db_session):
    ali = _user(client, db_session, 7330, "Ali")
    sara = _user(client, db_session, 7331, "Sara")
    client.post(f"/friends/{sara.id}", headers=_auth(7330))
    assert client.delete(f"/friends/{ali.id}", headers=_auth(7331)).status_code == 204
    assert client.get(f"/profiles/{sara.id}", headers=_auth(7330)).json()["friend_status"] == "none"
    # And asking again is possible.
    _befriend(client, 7330, 7331, sara.id, ali.id)
    client.delete(f"/friends/{sara.id}", headers=_auth(7330))
    assert client.get("/friends", headers=_auth(7331)).json() == []


def test_a_block_reads_as_nobody_there(client, db_session):
    _user(client, db_session, 7340, "Ali")
    sara = _user(client, db_session, 7341, "Sara")
    ali = db_session.query(User).filter_by(telegram_id=7340).one()
    client.post("/blocks", json={"user_id": ali.id}, headers=_auth(7341))
    assert client.post(f"/friends/{sara.id}", headers=_auth(7340)).status_code == 404


def test_their_friends_list_shows_the_shared_ones_first_marked(client, db_session):
    me = _user(client, db_session, 7350, "Me")
    them = _user(client, db_session, 7351, "Them")
    shared = _user(client, db_session, 7352, "Zed shared")
    only_theirs = _user(client, db_session, 7353, "Amy theirs")
    _befriend(client, 7350, 7352, shared.id, me.id)
    _befriend(client, 7351, 7352, shared.id, them.id)
    _befriend(client, 7351, 7353, only_theirs.id, them.id)

    out = client.get(f"/profiles/{them.id}/friends", headers=_auth(7350)).json()
    assert out["visible"] is True
    assert [(p["user_id"], p["mutual"]) for p in out["people"]] == [(shared.id, True), (only_theirs.id, False)]


def test_who_may_see_a_list_of_friends(client, db_session):
    me = _user(client, db_session, 7360, "Me")
    them = _user(client, db_session, 7361, "Them")
    shared = _user(client, db_session, 7362, "Shared")
    other = _user(client, db_session, 7363, "Other")
    _befriend(client, 7360, 7362, shared.id, me.id)
    _befriend(client, 7361, 7362, shared.id, them.id)
    _befriend(client, 7361, 7363, other.id, them.id)

    def seen():
        out = client.get(f"/profiles/{them.id}/friends", headers=_auth(7360)).json()
        return out["visible"], [p["user_id"] for p in out["people"]]

    client.put("/me/privacy", json={"friends_seen_by": "nobody"}, headers=_auth(7361))
    # Closed means closed: not even the friends you share.
    assert seen() == (False, [])
    client.put("/me/privacy", json={"friends_seen_by": "friends"}, headers=_auth(7361))
    assert seen()[0] is False
    client.put("/me/privacy", json={"friends_seen_by": "chosen"}, headers=_auth(7361))
    assert seen()[0] is False
    # Only friends can be chosen; I am not theirs, so choosing me does nothing...
    assert client.put("/me/friends-viewers", json={"user_ids": [me.id, other.id]}, headers=_auth(7361)).json() == [other.id]
    assert seen()[0] is False
    # ...until we are friends.
    _befriend(client, 7360, 7361, them.id, me.id)
    client.put("/me/friends-viewers", json={"user_ids": [me.id]}, headers=_auth(7361))
    assert seen()[0] is True
    assert client.put("/me/privacy", json={"friends_seen_by": "strangers"}, headers=_auth(7361)).status_code == 400


def test_a_request_and_a_yes_are_announced_live_to_the_one_concerned(client, db_session, monkeypatch):
    """No asking every few seconds whether a request came: the server says
    so the moment it happens, to that one person."""
    from app.friends import router as friends

    sent = []
    monkeypatch.setattr(friends.hub, "publish", lambda ids, event: sent.append((list(ids), event)))
    ali = _user(client, db_session, 7370, "Ali")
    sara = _user(client, db_session, 7371, "Sara")
    client.post(f"/friends/{sara.id}", headers=_auth(7370))
    client.post(f"/friends/{ali.id}/accept", headers=_auth(7371))
    assert sent == [([sara.id], {"type": "friends"}), ([ali.id], {"type": "friends"})]


# --- the people of this week (section 32, "me") ---------------------------


def _thread(client, a_tg, b_id):
    return client.post("/conversations", json={"user_id": b_id}, headers=_auth(a_tg)).json()["id"]


def _say(client, thread, tg, text="hi"):
    sent = client.post(f"/conversations/{thread}/messages", data={"text": text}, headers=_auth(tg))
    assert sent.status_code == 201, sent.text


def _week(client, tg):
    return client.get("/friends/this-week", headers=_auth(tg)).json()


def test_this_week_lists_people_you_really_talked_with(client, db_session):
    me = _user(client, db_session, 7400, "Me")
    talked = _user(client, db_session, 7401, "Talked")
    silent = _user(client, db_session, 7402, "Silent")
    both = _thread(client, 7400, talked.id)
    _say(client, both, 7400)
    _say(client, both, 7401)
    # Only one side wrote: somebody who never answered is not offered back.
    one_sided = _thread(client, 7400, silent.id)
    _say(client, one_sided, 7400)

    week = _week(client, 7400)
    assert [p["user_id"] for p in week] == [talked.id]
    assert week[0]["status"] == "none"
    # It works both ways.
    assert [p["user_id"] for p in _week(client, 7401)] == [me.id]


def test_this_week_leaves_out_friends_and_says_where_a_request_stands(client, db_session):
    me = _user(client, db_session, 7410, "Me")
    friend = _user(client, db_session, 7411, "Friend")
    asked = _user(client, db_session, 7412, "Asked")
    for other, tg in ((friend, 7411), (asked, 7412)):
        thread = _thread(client, 7410, other.id)
        _say(client, thread, 7410)
        _say(client, thread, tg)
    _befriend(client, 7410, 7411, friend.id, me.id)
    client.post(f"/friends/{asked.id}", headers=_auth(7410))

    week = _week(client, 7410)
    assert [(p["user_id"], p["status"]) for p in week] == [(asked.id, "requested")]
    assert [(p["user_id"], p["status"]) for p in _week(client, 7412)] == [(me.id, "incoming")]


def test_this_week_forgets_older_talk_and_blocked_people(client, db_session):
    from datetime import timedelta

    from app.core.time import utcnow
    from app.models.chat_message import ChatMessage

    _user(client, db_session, 7420, "Me")
    old = _user(client, db_session, 7421, "Old")
    blocked = _user(client, db_session, 7422, "Blocked")
    old_thread = _thread(client, 7420, old.id)
    _say(client, old_thread, 7420)
    _say(client, old_thread, 7421)
    for message in db_session.query(ChatMessage).filter_by(conversation_id=old_thread):
        message.created_at = utcnow() - timedelta(days=8)
    db_session.commit()
    blocked_thread = _thread(client, 7420, blocked.id)
    _say(client, blocked_thread, 7420)
    _say(client, blocked_thread, 7422)
    client.post("/blocks", json={"user_id": blocked.id}, headers=_auth(7420))

    assert _week(client, 7420) == []


def test_this_week_is_a_handful_newest_first(client, db_session):
    _user(client, db_session, 7430, "Me")
    ids = []
    for n in range(10):
        other = _user(client, db_session, 7431 + n, f"P{n}")
        thread = _thread(client, 7430, other.id)
        _say(client, thread, 7430)
        _say(client, thread, 7431 + n)
        ids.append(other.id)
    week = [p["user_id"] for p in _week(client, 7430)]
    assert len(week) == 8
    assert week[0] == ids[-1]
