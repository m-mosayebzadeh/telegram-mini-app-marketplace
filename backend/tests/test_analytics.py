"""
What the app counts about itself (TECHNICAL_REQUIREMENTS.md section 43,
"analytics"): only the events on its list, never text; a day row when
somebody comes back; and the numbers the admin page shows, counted from
the tables the app already has.
"""

from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from app.analytics import metrics
from app.analytics.router import reports
from app.core import team
from app.core.config import settings
from app.core.time import utcnow
from app.main import app
from app.models.analytics import ActiveDay, AppEvent
from app.models.user import User
from tests.helpers import sign_in
from tests.test_push import _people, other_client, sent  # noqa: F401 — fixtures used by name

OWNER_ID = 900000001


@pytest.fixture(autouse=True)
def fresh_limits():
    reports.clear()
    yield
    reports.clear()


def _events(client, *events):
    return client.post("/analytics/events", json={"events": list(events)})


def test_only_the_listed_events_are_kept(client, db_session):
    answer = _events(
        client,
        {"name": "app_load", "value": 1800},
        {"name": "signin_step", "detail": "google"},
        {"name": "frame_rate", "value": 58, "detail": "light"},
        {"name": "push_opened"},
    )
    assert answer.status_code == 204
    kept = {(e.name, e.value, e.detail) for e in db_session.query(AppEvent)}
    assert kept == {("app_load", 1800, None), ("signin_step", None, "google"), ("frame_rate", 58, "light"), ("push_opened", None, None)}


def test_anything_else_is_dropped_and_no_text_gets_in(client, db_session):
    _events(
        client,
        {"name": "message_text", "detail": "hello"},  # not an event at all
        {"name": "signin_step", "detail": "my password"},  # not one of its words
        {"name": "app_load", "value": -5},  # out of range
        {"name": "push_sent"},  # only the server says this
        {"name": "push_opened", "value": 3, "detail": "x"},  # extras are stripped
    )
    rows = db_session.query(AppEvent).all()
    assert [(e.name, e.value, e.detail) for e in rows] == [("push_opened", None, None)]


def test_a_signed_in_persons_events_are_theirs(client, db_session):
    sign_in(client, db_session, 9801, "Sara")
    me = client.get("/me").json()["id"]
    _events(client, {"name": "app_load", "value": 900})
    assert db_session.query(AppEvent).one().user_id == me


def test_coming_back_another_day_is_one_row_that_day(client, db_session):
    sign_in(client, db_session, 9802, "Sara")
    me = db_session.get(User, client.get("/me").json()["id"])
    me.last_seen_at = utcnow() - timedelta(days=1)
    db_session.commit()
    client.get("/me")
    client.get("/me")
    rows = db_session.query(ActiveDay).filter_by(user_id=me.id).all()
    assert [r.day for r in rows] == [utcnow().date()]


def test_the_one_number_counts_conversations_where_both_spoke(client, other_client, db_session):
    thread, first, second = _people(client, other_client, db_session)
    client.post(f"/conversations/{thread}/messages", data={"type": "text", "text": "hi"})
    team_id = team.team_user(db_session).id
    now = utcnow()
    # One side only: not yet an acquaintance.
    assert metrics.answered_conversations(db_session, now - timedelta(days=1), now + timedelta(minutes=1), team_id) == 0
    other_client.post(f"/conversations/{thread}/messages", data={"type": "text", "text": "hello!"})
    assert metrics.answered_conversations(db_session, now - timedelta(days=1), now + timedelta(minutes=1), team_id) == 1


def test_a_person_answering_cosmos_team_is_not_an_acquaintance(client, db_session):
    sign_in(client, db_session, 9803, "Sara")
    person = db_session.get(User, client.get("/me").json()["id"])
    team.say(db_session, person, "a new sign-in")
    thread = [c for c in client.get("/conversations").json() if c["others"][0]["team"]][0]
    client.post(f"/conversations/{thread['id']}/messages", data={"type": "text", "text": "it was me"})
    now = utcnow()
    assert metrics.answered_conversations(db_session, now - timedelta(days=1), now + timedelta(minutes=1), team.team_user(db_session).id) == 0


def test_came_back_the_next_day(client, db_session):
    sign_in(client, db_session, 9804, "Sara")
    me = db_session.get(User, client.get("/me").json()["id"])
    me.joined_at = utcnow() - timedelta(days=1)
    db_session.add(ActiveDay(user_id=me.id, day=utcnow().date()))
    db_session.commit()
    assert metrics._came_back(db_session, utcnow().date(), 1) == 1.0


def test_a_notification_sent_is_counted_once_per_person(client, other_client, db_session, sent):
    thread, _, second = _people(client, other_client, db_session)
    client.post(f"/conversations/{thread}/messages", data={"type": "text", "text": "are you coming?"})
    rows = db_session.query(AppEvent).filter_by(name="push_sent").all()
    assert [r.user_id for r in rows] == [second]


def test_the_page_is_only_for_who_may_read_it(client, db_session, monkeypatch):
    monkeypatch.setattr(settings, "owner_telegram_id", OWNER_ID)
    sign_in(client, db_session, 9805, "Nobody")
    assert client.get("/admin/analytics").status_code == 403
    owner = TestClient(app)
    sign_in(owner, db_session, OWNER_ID, "Owner")
    page = owner.get("/admin/analytics?days=7")
    assert page.status_code == 200
    body = page.json()
    assert set(body) >= {"answered", "joining", "first_day", "coming_back", "friendship", "echo", "safety", "notifications", "app"}
