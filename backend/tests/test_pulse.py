"""
The server's heartbeat (app/live/pulse.py): who is here comes from the
live connection, written once a minute for everybody at once; Echo's
numbers are told to the people searching only when they change.
"""

from datetime import timedelta

from app.core.time import utcnow
from app.live import pulse
from app.models.random_chat import RandomChatTicket
from app.models.user import User


def _users(db_session, *names):
    people = [User(telegram_id=9900 + k, first_name=name) for k, name in enumerate(names)]
    db_session.add_all(people)
    db_session.commit()
    return people


def test_everybody_connected_is_marked_as_here_in_one_go(db_session, monkeypatch):
    a, b, gone = _users(db_session, "A", "B", "Gone")
    old = utcnow() - timedelta(hours=1)
    for user in (a, b, gone):
        user.last_seen_at = old
    db_session.commit()
    monkeypatch.setattr(pulse.hub, "connected_user_ids", lambda: [a.id, b.id])

    assert pulse.mark_connected_as_seen(db_session) == 2
    db_session.expire_all()
    assert db_session.get(User, a.id).last_seen_at > old
    assert db_session.get(User, gone.id).last_seen_at == old


def test_echo_numbers_go_to_searchers_only_when_they_change(db_session, monkeypatch):
    searcher, idle = _users(db_session, "Searcher", "Idle")
    db_session.add(RandomChatTicket(user_id=searcher.id, active=True, local_minute=600, joined_at=utcnow()))
    db_session.commit()
    sent = []
    monkeypatch.setattr(pulse.hub, "connected_user_ids", lambda: [searcher.id, idle.id])
    monkeypatch.setattr(pulse.hub, "publish", lambda ids, event: sent.append((sorted(ids), event["type"])))

    echo = pulse.EchoPulse()
    echo.tick(db_session)
    assert sent == [([searcher.id], "echo_counts")]
    # Nothing changed: nothing sent.
    echo.tick(db_session)
    assert len(sent) == 1


def test_everybody_hears_when_echo_goes_from_nobody_to_somebody_waiting(db_session, monkeypatch):
    searcher, idle = _users(db_session, "Searcher", "Idle")
    sent = []
    monkeypatch.setattr(pulse.hub, "connected_user_ids", lambda: [searcher.id, idle.id])
    monkeypatch.setattr(pulse.hub, "publish", lambda ids, event: sent.append(sorted(ids)))
    echo = pulse.EchoPulse()
    echo.tick(db_session)  # nobody waiting yet
    db_session.add(RandomChatTicket(user_id=searcher.id, active=True, local_minute=600, joined_at=utcnow()))
    db_session.commit()
    echo.tick(db_session)
    assert sent[-1] == sorted([searcher.id, idle.id])


def test_the_door_knows_when_echo_shuts():
    from app.models.feature_schedule import FeatureSchedule

    schedule = FeatureSchedule(feature="x", enabled=True, always_open=False, opens_at_minute=22 * 60, closes_at_minute=23 * 60)
    assert schedule.minutes_until_close(22 * 60 + 30) == 30
    assert schedule.minutes_until_close(10 * 60) is None
    schedule.always_open = True
    assert schedule.minutes_until_close(22 * 60 + 30) is None
