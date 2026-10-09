"""
A ring that lights the moment somebody arrives (TECHNICAL_REQUIREMENTS.md
section 43): told only to the people whose world shows them, never to
everybody; never for somebody who hides being online; and gone again when
they stop counting as here.
"""

import asyncio
import json
from datetime import timedelta

from app.core.time import utcnow
from app.live import pulse
from app.live.hub import LiveHub
from app.models.profile import Profile
from app.models.user import User


def _hub_with(*viewer_ids):
    """A hub with these people connected, and what each was told."""
    hub = LiveHub()
    told: list[tuple[int, dict]] = []

    async def connect():
        for viewer in viewer_ids:
            hub.register(viewer)

    asyncio.run(connect())
    hub.publish_local = lambda ids, event: told.extend((i, event) for i in ids)  # type: ignore[method-assign]
    return hub, told


def test_only_the_people_whose_world_shows_somebody_hear_them_arrive():
    hub, told = _hub_with(1, 2)
    hub.watch(1, [7, 8])
    hub.watch(2, [9])
    hub.presence(7, True)
    assert told == [(1, {"type": "presence", "user_id": 7, "online": True})]


def test_a_new_world_replaces_the_old_one():
    hub, told = _hub_with(1)
    hub.watch(1, [7])
    hub.watch(1, [8])
    hub.presence(7, True)
    assert told == []


def test_somebody_who_closed_the_app_stops_hearing():
    hub, told = _hub_with(1)
    hub.watch(1, [7])
    connection = next(iter(hub._by_user[1]))
    hub.unregister(connection)
    hub.presence(7, True)
    assert told == [] and hub._watched_by == {}


def test_a_world_asked_for_just_before_the_socket_arrives_still_counts():
    """The app asks for the world and opens its socket together; the
    world usually answers first."""
    hub, told = _hub_with()
    hub.watch(1, [7])
    assert hub._watches == {}

    async def connect():
        hub.register(1)

    asyncio.run(connect())
    hub.presence(7, True)
    assert told == [(1, {"type": "presence", "user_id": 7, "online": True})]


def test_a_world_whose_socket_never_came_is_forgotten():
    hub, _ = _hub_with()
    hub.watch(1, [7])
    assert hub.sweep_pending(older_than=0) == 1
    assert hub._pending_watches == {}


def test_other_processes_hear_both_through_the_channel():
    sent = []

    class Broker:
        def send(self, raw):
            sent.append(json.loads(raw))

    here, _ = _hub_with()
    here.attach(Broker())
    here.watch(1, [7])
    here.presence(7, True)
    there, told = _hub_with(1)
    for message in sent:
        there.receive(json.dumps(message))
    assert told == [(1, {"type": "presence", "user_id": 7, "online": True})]


def test_leaving_is_told_once_when_the_five_minutes_pass(db_session, monkeypatch):
    now = utcnow()
    gone = User(telegram_id=9951, first_name="Gone", last_seen_at=now - pulse.ONLINE_WITHIN - timedelta(seconds=20))
    long_gone = User(telegram_id=9952, first_name="Long", last_seen_at=now - timedelta(hours=2))
    hidden = User(telegram_id=9953, first_name="Hidden", last_seen_at=now - pulse.ONLINE_WITHIN - timedelta(seconds=20))
    here = User(telegram_id=9954, first_name="Here", last_seen_at=now)
    db_session.add_all([gone, long_gone, hidden, here])
    db_session.commit()
    db_session.add(Profile(user_id=hidden.id, hide_online=True))
    db_session.commit()
    told = []
    monkeypatch.setattr(pulse.hub, "presence", lambda user_id, online: told.append((user_id, online)))
    monkeypatch.setattr(pulse.hub, "is_connected", lambda user_id: False)
    assert pulse.announce_gone(db_session) == 1
    assert told == [(gone.id, False)]


def test_turning_hiding_off_is_arriving_and_on_is_leaving(client, db_session, monkeypatch):
    from app.live import hub as hub_module
    from tests.helpers import sign_in

    told = []
    monkeypatch.setattr(hub_module.hub, "presence", lambda user_id, online: told.append(online))
    sign_in(client, db_session, 9961, "Sara")
    me = client.get("/me").json()["id"]
    base = {"chat_door": "open", "friends_seen_by": "everyone"}
    client.put("/me/privacy", json={**base, "hide_online": True})
    client.put("/me/privacy", json={**base, "hide_online": False})
    # Saving again without a change says nothing.
    client.put("/me/privacy", json={**base, "hide_online": False})
    assert told == [False, True]
    assert me
