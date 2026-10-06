"""
Cosmos Team (TECHNICAL_REQUIREMENTS.md section 37): the account the app
itself writes from — a new sign-in, a change to the ways in — and the
conversation through which people can answer us.
"""

from fastapi.testclient import TestClient

from app.auth import sessions
from app.core import team
from app.main import app
from app.models.auth_session import AuthSession
from app.models.feedback import Feedback
from app.models.user import User, UserStatus
from tests.helpers import sign_in
from tests.test_ways_in_settings import _google_trip, ways  # noqa: F401 — the fixture is used by name


def _team_thread(page):
    """This person's conversation with Cosmos Team, and its messages."""
    rows = page.get("/conversations").json()
    mine = [c for c in rows if c["others"] and c["others"][0]["team"]]
    assert len(mine) == 1
    return mine[0], page.get(f"/conversations/{mine[0]['id']}/messages").json()


def test_a_new_sign_in_to_an_existing_account_is_told_with_a_button_to_close_it(client, db_session, ways):
    first = TestClient(app)
    assert _google_trip(first, "g-7") == "/"
    # The very first sign-in is the person arriving: nothing to say.
    assert all(not c["others"] or not c["others"][0]["team"] for c in first.get("/conversations").json())

    me = db_session.get(User, first.get("/me").json()["id"])
    me.language = "fa"
    db_session.commit()

    second = TestClient(app, headers={"user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/604.1"})
    assert _google_trip(second, "g-7") == "/"
    thread, messages = _team_thread(first)
    assert thread["others"][0]["display_name"] == "Cosmos Team"
    assert thread["others"][0]["seen"] == "long"  # no presence for the team
    note = messages[-1]
    assert "ورودِ تازه" in note["text"] and "گوگل" in note["text"]
    newest = db_session.query(AuthSession).filter_by(user_id=me.id).order_by(AuthSession.id.desc()).first()
    assert note["action"] == f"close_session:{newest.id}"

    # The button: closing that session signs the other device out.
    assert first.delete(f"/auth/sessions/{newest.id}").status_code == 204
    assert second.get("/me").status_code == 401


def test_the_team_never_appears_among_people(client, db_session):
    member = User(first_name="Sara", last_seen_at=sessions.utcnow())
    db_session.add(member)
    db_session.commit()
    team.say(db_session, member, "hello")
    the_team = team.team_user(db_session)
    assert the_team.status == UserStatus.TEAM
    # One team, however often it speaks.
    team.say(db_session, member, "again")
    assert db_session.query(User).filter_by(status=UserStatus.TEAM).count() == 1
    # Not in the world, however recently it "spoke".
    the_team.last_seen_at = sessions.utcnow()
    db_session.commit()
    sign_in(client, db_session, 9502)
    people = client.get("/sky").json()
    assert the_team.id not in {p["user_id"] for p in people}
    assert member.id in {p["user_id"] for p in people}


def test_answering_the_team_reaches_report_a_problem(client, db_session, ways):
    first = TestClient(app)
    _google_trip(first, "g-8")
    _google_trip(TestClient(app), "g-8")
    thread, _ = _team_thread(first)
    sent = first.post(f"/conversations/{thread['id']}/messages", data={"type": "text", "text": "the map froze"})
    assert sent.status_code == 201
    row = db_session.query(Feedback).filter_by(where=team.FEEDBACK_WHERE).one()
    assert row.text == "the map froze"
    # Only words go to the team.
    assert thread["capabilities"] == ["text"]


def test_a_change_to_the_ways_in_is_told_in_the_app_too(client, db_session, ways):
    """Somebody with only Google has no Telegram to be told through."""
    person = User(first_name="Nika", language="en")
    db_session.add(person)
    db_session.commit()
    team.door_changed(db_session, person, "google_linked", "n***a@gmail.com")
    said = db_session.query(team.ChatMessage).filter_by(sender_id=team.team_user(db_session).id).one()
    assert said.text.startswith("A Google account was connected as a way into your account (n***a@gmail.com).")


def test_the_app_says_which_language_it_is_shown_in(client, db_session):
    sign_in(client, db_session, 9501)
    assert client.put("/me/language", json={"language": "fa"}).status_code == 204
    assert client.get("/me").json()["language"] == "fa"
    assert client.put("/me/language", json={"language": "xx"}).status_code == 400
