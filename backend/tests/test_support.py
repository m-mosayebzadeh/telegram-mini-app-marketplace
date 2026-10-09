"""
Answering people who write to Cosmos Team (TECHNICAL_REQUIREMENTS.md
section 43): staff with the support permission see those conversations
beside their own, open them in the ordinary conversation screen and answer
as the team; a lock keeps two of them from answering one person at once;
the owner sees who wrote what and can hand a conversation to somebody.
"""

from datetime import timedelta

import pytest

from app.core import team
from app.core.config import settings
from app.core.time import utcnow
from app.models.chat_message import ChatMessage
from app.models.support import SupportLock, SupportOpening
from app.models.user import User
from tests.helpers import sign_init_data

OWNER_ID = 900000001


@pytest.fixture(autouse=True)
def owner_configured():
    original = settings.owner_telegram_id
    settings.owner_telegram_id = OWNER_ID
    yield
    settings.owner_telegram_id = original


def _h(telegram_id: int, name: str) -> dict:
    return {"X-Telegram-Init-Data": sign_init_data({"id": telegram_id, "first_name": name})}


OWNER = _h(OWNER_ID, "Owner")
PERSON = _h(2001, "Nika")
STAFF_A = _h(2002, "Ava")
STAFF_B = _h(2003, "Bahar")
NOBODY = _h(2004, "Dara")


def _staff(client, *headers):
    """A support role, given to each of `headers`."""
    role = client.post("/admin/roles", headers=OWNER, json={"name": "support", "scopes": ["support.conversations"]})
    assert role.status_code == 201, role.text
    for header in headers:
        user_id = client.get("/me", headers=header).json()["id"]
        given = client.post(f"/admin/users/{user_id}/roles", headers=OWNER, json={"role_id": role.json()["id"]})
        assert given.status_code in (200, 201, 204), given.text


def _person_writes(client, db_session, text="the map froze") -> int:
    """The team told the person something; they answered. Returns the
    conversation's id."""
    client.get("/me", headers=OWNER)
    person = db_session.get(User, client.get("/me", headers=PERSON).json()["id"])
    team.say(db_session, person, "hello from the team")
    thread = [c for c in client.get("/conversations", headers=PERSON).json() if c["others"][0]["team"]][0]
    sent = client.post(f"/conversations/{thread['id']}/messages", headers=PERSON, data={"type": "text", "text": text})
    assert sent.status_code == 201
    return thread["id"]


def test_staff_see_the_team_conversations_from_the_teams_side(client, db_session):
    conversation_id = _person_writes(client, db_session)
    _staff(client, STAFF_A)

    listed = client.get("/support/conversations", headers=STAFF_A).json()
    assert [c["id"] for c in listed] == [conversation_id]
    row = listed[0]
    # From the team's side: the other is the person, and their word is unread.
    assert row["others"][0]["display_name"] == "Nika"
    assert row["unread"] is True and row["last_text"] == "the map froze"
    assert row["acting_as"] == team.team_user(db_session).id
    assert client.get("/support/unread", headers=STAFF_A).json() == {"conversations": 1}


def test_without_the_permission_there_is_no_support(client, db_session):
    conversation_id = _person_writes(client, db_session)
    client.get("/me", headers=NOBODY)
    assert client.get("/support/conversations", headers=NOBODY).status_code == 403
    # And the conversation itself stays closed to them.
    assert client.get(f"/conversations/{conversation_id}", headers=NOBODY).status_code == 404
    assert client.get(f"/conversations/{conversation_id}/messages", headers=NOBODY).status_code == 404


def test_an_answer_comes_from_the_team_and_the_person_never_sees_who(client, db_session):
    conversation_id = _person_writes(client, db_session)
    _staff(client, STAFF_A)

    opened = client.get(f"/conversations/{conversation_id}", headers=STAFF_A).json()
    assert opened["support"]["language"] is None or isinstance(opened["support"]["language"], str)
    assert opened["support"]["last_notice"] == "notice"
    answer = client.post(f"/conversations/{conversation_id}/messages", headers=STAFF_A, data={"type": "text", "text": "fixed now"})
    assert answer.status_code == 201
    assert answer.json()["sender_id"] == team.team_user(db_session).id

    seen = client.get(f"/conversations/{conversation_id}/messages", headers=PERSON).json()
    assert seen[-1]["text"] == "fixed now"
    assert seen[-1]["staff_name"] is None
    assert "Ava" not in str(seen)
    # Kept for the owner, though.
    stored = db_session.query(ChatMessage).filter_by(text="fixed now").one()
    assert stored.staff_id == client.get("/me", headers=STAFF_A).json()["id"]


def test_only_the_owner_sees_who_wrote_each_answer(client, db_session):
    conversation_id = _person_writes(client, db_session)
    _staff(client, STAFF_A, STAFF_B)
    client.post(f"/conversations/{conversation_id}/messages", headers=STAFF_A, data={"type": "text", "text": "fixed now"})

    by_owner = client.get(f"/conversations/{conversation_id}/messages", headers=OWNER).json()
    by_staff = client.get(f"/conversations/{conversation_id}/messages", headers=STAFF_B).json()
    assert by_owner[-1]["staff_name"] == "Ava"
    assert by_staff[-1]["staff_name"] is None


def test_every_look_is_recorded(client, db_session):
    conversation_id = _person_writes(client, db_session)
    _staff(client, STAFF_A)
    client.get(f"/conversations/{conversation_id}", headers=STAFF_A)
    client.get(f"/conversations/{conversation_id}", headers=STAFF_A)
    assert db_session.query(SupportOpening).filter_by(conversation_id=conversation_id).count() == 2
    # The person opening their own conversation is not a look.
    client.get(f"/conversations/{conversation_id}", headers=PERSON)
    assert db_session.query(SupportOpening).count() == 2


def test_while_one_answers_another_cannot(client, db_session):
    conversation_id = _person_writes(client, db_session)
    _staff(client, STAFF_A, STAFF_B)

    assert client.post(f"/support/conversations/{conversation_id}/claim", headers=STAFF_A).status_code == 204
    held = client.post(f"/support/conversations/{conversation_id}/claim", headers=STAFF_B)
    assert held.status_code == 409
    assert held.json()["detail"] == {"reason": "support_held", "holder": "Ava"}
    refused = client.post(f"/conversations/{conversation_id}/messages", headers=STAFF_B, data={"type": "text", "text": "me too"})
    assert refused.status_code == 409
    info = client.get(f"/conversations/{conversation_id}", headers=STAFF_B).json()["support"]
    assert info["holder_name"] == "Ava" and info["held_by_me"] is False


def test_a_lock_frees_itself_after_ten_minutes(client, db_session):
    conversation_id = _person_writes(client, db_session)
    _staff(client, STAFF_A, STAFF_B)
    client.post(f"/support/conversations/{conversation_id}/claim", headers=STAFF_A)
    lock = db_session.get(SupportLock, conversation_id)
    lock.touched_at = utcnow() - timedelta(minutes=11)
    db_session.commit()
    assert client.post(f"/support/conversations/{conversation_id}/claim", headers=STAFF_B).status_code == 204


def test_the_owner_hands_a_conversation_and_it_holds_until_answered(client, db_session):
    conversation_id = _person_writes(client, db_session)
    _staff(client, STAFF_A, STAFF_B)
    b_id = client.get("/me", headers=STAFF_B).json()["id"]

    assert client.post(f"/support/conversations/{conversation_id}/hand", headers=STAFF_A, json={"user_id": b_id}).status_code == 403
    staff = client.get("/support/staff", headers=OWNER).json()
    assert b_id in {s["user_id"] for s in staff}
    assert client.post(f"/support/conversations/{conversation_id}/hand", headers=OWNER, json={"user_id": b_id}).status_code == 204

    # Long after, still Bahar's: a handed conversation does not run out.
    lock = db_session.get(SupportLock, conversation_id)
    lock.touched_at = utcnow() - timedelta(hours=3)
    db_session.commit()
    assert client.post(f"/support/conversations/{conversation_id}/claim", headers=STAFF_A).status_code == 409
    # Once Bahar answers, it is an ordinary lock again.
    assert client.post(f"/conversations/{conversation_id}/messages", headers=STAFF_B, data={"type": "text", "text": "on it"}).status_code == 201
    db_session.refresh(lock)
    assert lock.handed is False


def test_only_words_go_from_the_team(client, db_session):
    conversation_id = _person_writes(client, db_session)
    _staff(client, STAFF_A)
    voice = client.post(f"/conversations/{conversation_id}/messages", headers=STAFF_A, data={"type": "voice", "duration_seconds": 3})
    assert voice.status_code == 400


def test_reading_it_marks_it_read_for_the_whole_team(client, db_session):
    conversation_id = _person_writes(client, db_session)
    _staff(client, STAFF_A, STAFF_B)
    assert client.post(f"/conversations/{conversation_id}/read", headers=STAFF_A).status_code == 204
    assert client.get("/support/unread", headers=STAFF_B).json() == {"conversations": 0}


def test_a_new_word_reaches_the_staff_live(client, db_session):
    """Staff get the team conversation's live events; nobody else does."""
    from app.live.events import _everyone_in
    from app.models.conversation import Conversation

    conversation_id = _person_writes(client, db_session)
    _staff(client, STAFF_A)
    client.get("/me", headers=NOBODY)
    conversation = db_session.get(Conversation, conversation_id)
    told = set(_everyone_in(conversation))
    ids = {name: client.get("/me", headers=h).json()["id"] for name, h in (("a", STAFF_A), ("owner", OWNER), ("nobody", NOBODY), ("person", PERSON))}
    assert {ids["a"], ids["owner"], ids["person"]} <= told
    assert ids["nobody"] not in told


def test_contact_support_opens_the_conversation_with_the_team(client, db_session):
    """Settings → "contact support": started if never needed, the same one
    every time after, words only — and it lands under staff's "support"."""
    client.get("/me", headers=OWNER)
    first = client.post("/conversations/team", headers=PERSON)
    assert first.status_code == 200
    thread = first.json()
    assert thread["others"][0]["team"] is True
    assert thread["capabilities"] == ["text"]
    assert client.post("/conversations/team", headers=PERSON).json()["id"] == thread["id"]
    client.post(f"/conversations/{thread['id']}/messages", headers=PERSON, data={"type": "text", "text": "how do I hide my age?"})
    assert [c["id"] for c in client.get("/support/conversations", headers=OWNER).json()] == [thread["id"]]


def test_taking_a_role_away_tells_that_person_at_once(client, db_session, monkeypatch):
    """Their app reads its access again, so the support tab goes from the
    screen too — the server already refused them either way."""
    from app.live.hub import hub

    told = []
    monkeypatch.setattr(hub, "publish", lambda ids, event: told.append((sorted(ids), event["type"])))
    _person_writes(client, db_session)
    _staff(client, STAFF_A)
    ava = client.get("/me", headers=STAFF_A).json()["id"]
    assert ([ava], "access") in told
    role_id = client.get(f"/admin/users/{ava}/roles", headers=OWNER).json()[0]["role_id"]
    told.clear()
    assert client.delete(f"/admin/users/{ava}/roles/{role_id}", headers=OWNER).status_code == 204
    assert told == [([ava], "access")]
    assert client.get("/support/conversations", headers=STAFF_A).status_code == 403


def test_editing_a_role_tells_everyone_holding_it(client, db_session, monkeypatch):
    from app.live.hub import hub

    _person_writes(client, db_session)
    _staff(client, STAFF_A, STAFF_B)
    told = []
    monkeypatch.setattr(hub, "publish", lambda ids, event: told.append((sorted(ids), event["type"])))
    ids = sorted(client.get("/me", headers=h).json()["id"] for h in (STAFF_A, STAFF_B))
    role_id = client.get(f"/admin/users/{ids[0]}/roles", headers=OWNER).json()[0]["role_id"]
    client.post(f"/admin/roles/{role_id}/deactivate", headers=OWNER)
    assert told == [(ids, "access")]


def test_with_the_team_nobody_deletes_for_both_sides(client, db_session):
    conversation_id = _person_writes(client, db_session)
    _staff(client, STAFF_A)
    mine = client.get(f"/conversations/{conversation_id}/messages", headers=PERSON).json()[-1]["id"]
    for who in (PERSON, STAFF_A):
        refused = client.post(f"/conversations/{conversation_id}/messages/delete", headers=who, json={"message_ids": [mine], "for_everyone": True})
        assert refused.status_code == 400 and refused.json()["detail"] == {"reason": "team_one_sided"}
    assert client.post(f"/conversations/{conversation_id}/clear?for_everyone=true", headers=PERSON).status_code == 400
    assert client.delete(f"/conversations/{conversation_id}?for_everyone=true", headers=PERSON).status_code == 400
    # For your own side it is fine.
    assert client.post(f"/conversations/{conversation_id}/messages/delete", headers=PERSON, json={"message_ids": [mine], "for_everyone": False}).status_code == 200


def test_staff_put_messages_away_until_the_person_writes_again(client, db_session):
    conversation_id = _person_writes(client, db_session, "first problem")
    _staff(client, STAFF_A, STAFF_B)
    first = client.get(f"/conversations/{conversation_id}/messages", headers=STAFF_A).json()[-1]["id"]
    hidden = client.post(f"/conversations/{conversation_id}/messages/delete", headers=STAFF_A, json={"message_ids": [first], "for_everyone": False})
    assert hidden.status_code == 200
    # Gone for the whole team, still there for the person.
    assert first not in [m["id"] for m in client.get(f"/conversations/{conversation_id}/messages", headers=STAFF_B).json()]
    assert first in [m["id"] for m in client.get(f"/conversations/{conversation_id}/messages", headers=PERSON).json()]
    client.post(f"/conversations/{conversation_id}/messages", headers=PERSON, data={"type": "text", "text": "it happened again"})
    assert first in [m["id"] for m in client.get(f"/conversations/{conversation_id}/messages", headers=STAFF_A).json()]
