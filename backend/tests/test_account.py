"""
The "me" step (TECHNICAL_REQUIREMENTS.md section 32, step 4): the
eighteen-or-over confirmation, privacy (who may message you, hiding when
you are online), deleting the account, and "report a problem".
"""

from app.core.time import utcnow
from app.models.user import User, UserStatus
from tests.helpers import sign_init_data


def _auth(telegram_id: int, first_name: str = "Test") -> dict:
    return {"X-Telegram-Init-Data": sign_init_data({"id": telegram_id, "first_name": first_name})}


def _user(client, db_session, telegram_id, name="Test"):
    client.get("/me", headers=_auth(telegram_id, name))
    return db_session.query(User).filter_by(telegram_id=telegram_id).one()


# --- eighteen or over ----------------------------------------------------


def test_eighteen_or_over_is_asked_once(client, db_session):
    _user(client, db_session, 8001)
    assert client.get("/me", headers=_auth(8001)).json()["adult_confirmed"] is False
    assert client.post("/me/adult", headers=_auth(8001)).status_code == 204
    assert client.get("/me", headers=_auth(8001)).json()["adult_confirmed"] is True


# --- privacy -------------------------------------------------------------


def test_privacy_starts_at_the_freest(client, db_session):
    _user(client, db_session, 8010)
    assert client.get("/me/privacy", headers=_auth(8010)).json() == {"chat_door": "open", "hide_online": False, "friends_seen_by": "everyone"}


def test_only_friends_may_start_a_conversation(client, db_session):
    me = _user(client, db_session, 8020, "Me")
    friend = _user(client, db_session, 8021, "Friend")
    _user(client, db_session, 8022, "Stranger")
    client.put("/me/privacy", json={"chat_door": "friends", "hide_online": False}, headers=_auth(8020))
    client.post(f"/friends/{friend.id}", headers=_auth(8020))
    client.post(f"/friends/{me.id}/accept", headers=_auth(8021))

    refused = client.post("/conversations", json={"user_id": me.id}, headers=_auth(8022))
    assert refused.status_code == 403
    assert refused.json()["detail"]["reason"] == "door_friends"
    assert client.post("/conversations", json={"user_id": me.id}, headers=_auth(8021)).status_code == 201


def test_a_conversation_that_exists_stays_open_after_the_door_closes(client, db_session):
    me = _user(client, db_session, 8030, "Me")
    _user(client, db_session, 8031, "Other")
    thread = client.post("/conversations", json={"user_id": me.id}, headers=_auth(8031)).json()["id"]
    client.put("/me/privacy", json={"chat_door": "friends"}, headers=_auth(8030))
    again = client.post("/conversations", json={"user_id": me.id}, headers=_auth(8031))
    assert again.status_code == 201
    assert again.json()["id"] == thread


def test_an_unknown_door_is_refused(client, db_session):
    _user(client, db_session, 8035)
    assert client.put("/me/privacy", json={"chat_door": "paid"}, headers=_auth(8035)).status_code == 400


def test_hiding_online_hides_it_both_ways(client, db_session):
    """Telegram's rule: whoever hides it sees nobody's either."""
    me = _user(client, db_session, 8040, "Me")
    other = _user(client, db_session, 8041, "Other")
    thread = client.post("/conversations", json={"user_id": other.id}, headers=_auth(8040)).json()["id"]

    def seen(who):
        return client.get(f"/conversations/{thread}", headers=_auth(who)).json()["others"][0]["seen"]

    assert seen(8040) == "now"
    client.put("/me/privacy", json={"hide_online": True}, headers=_auth(8041))
    assert seen(8040) == "recently"  # they hide: I do not see them
    assert seen(8041) == "recently"  # and they do not see me


def test_somebody_hiding_online_has_no_ring_in_the_world(client, db_session):
    _user(client, db_session, 8050, "Me")
    other = _user(client, db_session, 8051, "Other")
    client.put("/me/privacy", json={"hide_online": True}, headers=_auth(8051))
    people = client.get("/sky", headers=_auth(8050)).json()
    row = next(p for p in people if p["user_id"] == other.id)
    assert row["online"] is False


# --- deleting the account ------------------------------------------------


def test_deleting_needs_to_be_sure(client, db_session):
    _user(client, db_session, 8060)
    assert client.delete("/me", headers=_auth(8060)).status_code == 400


def test_a_deleted_account_leaves_the_world_and_stays_shut(client, db_session):
    gone = _user(client, db_session, 8070, "Gone")
    _user(client, db_session, 8071, "Stays")
    thread = client.post("/conversations", json={"user_id": gone.id}, headers=_auth(8071)).json()["id"]
    client.post(f"/conversations/{thread}/messages", data={"text": "hi"}, headers=_auth(8071))

    assert client.delete("/me?sure=true", headers=_auth(8070)).status_code == 204
    db_session.expire_all()
    assert db_session.get(User, gone.id).status == UserStatus.DELETED

    people = client.get("/sky", headers=_auth(8071)).json()
    assert all(p["user_id"] != gone.id for p in people)
    # The other side still has the conversation and its messages.
    messages = client.get(f"/conversations/{thread}/messages", headers=_auth(8071)).json()
    assert [m["text"] for m in messages] == ["hi"]

    # The app asking in the background does not quietly make a new account.
    refused = client.get("/me", headers=_auth(8070))
    assert refused.status_code == 410
    assert refused.json()["detail"]["reason"] == "account_deleted"
    assert db_session.query(User).filter(User.first_name == "Back").count() == 0


def test_starting_over_after_deleting_makes_a_new_empty_account(client, db_session):
    gone = _user(client, db_session, 8075, "Gone")
    client.delete("/me?sure=true", headers=_auth(8075))
    assert client.post("/me/start-over", headers=_auth(8075, "Back")).status_code == 201
    again = client.get("/me", headers=_auth(8075, "Back")).json()
    assert again["id"] != gone.id
    assert again["adult_confirmed"] is False
    # Only a deleted account can be started over.
    assert client.post("/me/start-over", headers=_auth(8075)).status_code == 409


# --- report a problem ----------------------------------------------------


def test_a_problem_can_be_reported_and_read_by_staff(client, db_session):
    from app.core.config import settings

    _user(client, db_session, 8080, "Reporter")
    assert client.post("/feedback", json={"text": "The map froze", "where": "/sky"}, headers=_auth(8080)).status_code == 201
    assert client.post("/feedback", json={"text": "   "}, headers=_auth(8080)).status_code == 400

    original = settings.owner_telegram_id
    settings.owner_telegram_id = 8081
    try:
        _user(client, db_session, 8081, "Owner")
        rows = client.get("/admin/feedback", headers=_auth(8081)).json()
    finally:
        settings.owner_telegram_id = original
    assert rows[0]["text"] == "The map froze"
    assert rows[0]["where"] == "/sky"
    # Not for everybody.
    assert client.get("/admin/feedback", headers=_auth(8080)).status_code == 403


# --- the note of the day -------------------------------------------------


def test_the_note_of_the_day_is_shown_for_a_day(client, db_session):
    from datetime import timedelta

    from app.models.profile import Profile

    me = _user(client, db_session, 8090, "Me")
    _user(client, db_session, 8091, "Other")
    saved = client.put("/profile/me/note", json={"text": "  looking for a film to watch  "}, headers=_auth(8090))
    assert saved.json()["note"] == "looking for a film to watch"
    assert client.get(f"/profiles/{me.id}", headers=_auth(8091)).json()["note"] == "looking for a film to watch"
    people = client.get("/sky", headers=_auth(8091)).json()
    assert next(p for p in people if p["user_id"] == me.id)["tagline"] == "looking for a film to watch"

    # A day later it has faded, and nothing takes its place.
    profile = db_session.query(Profile).filter_by(user_id=me.id).one()
    profile.note_at = utcnow() - timedelta(hours=25)
    db_session.commit()
    assert client.get(f"/profiles/{me.id}", headers=_auth(8091)).json()["note"] is None
    people = client.get("/sky", headers=_auth(8091)).json()
    assert next(p for p in people if p["user_id"] == me.id)["tagline"] is None


def test_an_empty_note_takes_it_down(client, db_session):
    _user(client, db_session, 8095)
    client.put("/profile/me/note", json={"text": "hi"}, headers=_auth(8095))
    assert client.put("/profile/me/note", json={"text": ""}, headers=_auth(8095)).json()["note"] is None
    assert client.put("/profile/me/note", json={"text": "x" * 61}, headers=_auth(8095)).status_code == 422


def test_the_note_says_when_it_was_written(client, db_session):
    me = _user(client, db_session, 8096, "Me")
    _user(client, db_session, 8097, "Other")
    client.put("/profile/me/note", json={"text": "tea and a book"}, headers=_auth(8096))
    seen = client.get(f"/profiles/{me.id}", headers=_auth(8097)).json()
    assert seen["note_at"] is not None
    person = next(p for p in client.get("/sky", headers=_auth(8097)).json() if p["user_id"] == me.id)
    assert person["tagline_at"] == seen["note_at"]
    # No note, no hour.
    client.put("/profile/me/note", json={"text": ""}, headers=_auth(8096))
    assert client.get(f"/profiles/{me.id}", headers=_auth(8097)).json()["note_at"] is None


def test_a_faded_note_is_erased_not_only_hidden(client, db_session):
    from datetime import timedelta

    from app.models.profile import Profile
    from app.profile.note import erase_faded_notes

    old = _user(client, db_session, 8098, "Old")
    new = _user(client, db_session, 8099, "New")
    client.put("/profile/me/note", json={"text": "yesterday"}, headers=_auth(8098))
    client.put("/profile/me/note", json={"text": "today"}, headers=_auth(8099))
    stale = db_session.query(Profile).filter_by(user_id=old.id).one()
    stale.note_at = utcnow() - timedelta(hours=25)
    db_session.commit()

    assert erase_faded_notes(db_session) == 1
    db_session.expire_all()
    stale = db_session.query(Profile).filter_by(user_id=old.id).one()
    assert (stale.note, stale.note_at) == (None, None)
    assert db_session.query(Profile).filter_by(user_id=new.id).one().note == "today"


def test_answering_a_note_keeps_a_copy_of_it_on_the_message(client, db_session):
    from datetime import timedelta

    from app.models.profile import Profile

    _user(client, db_session, 8100, "Me")
    them = _user(client, db_session, 8101, "Them")
    client.put("/profile/me/note", json={"text": "anyone for a walk?"}, headers=_auth(8101))
    thread = client.post("/conversations", json={"user_id": them.id}, headers=_auth(8100)).json()["id"]

    sent = client.post(
        f"/conversations/{thread}/messages", data={"text": "me!", "to_note": "true"}, headers=_auth(8100)
    ).json()
    assert sent["note_quote"] == "anyone for a walk?"
    # They see the same quote on their side.
    seen = client.get(f"/conversations/{thread}/messages", headers=_auth(8101)).json()
    assert seen[-1]["note_quote"] == "anyone for a walk?"

    # An ordinary message carries no quote, and a faded note quotes nothing.
    plain = client.post(f"/conversations/{thread}/messages", data={"text": "hi"}, headers=_auth(8100)).json()
    assert plain["note_quote"] is None
    profile = db_session.query(Profile).filter_by(user_id=them.id).one()
    profile.note_at = utcnow() - timedelta(hours=25)
    db_session.commit()
    late = client.post(
        f"/conversations/{thread}/messages", data={"text": "still?", "to_note": "true"}, headers=_auth(8100)
    ).json()
    assert late["note_quote"] is None
