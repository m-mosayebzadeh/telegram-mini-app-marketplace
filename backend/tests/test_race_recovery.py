"""
Two requests that both find nothing and both try to create.

This is not theoretical. The chat screen asks for its conversation as it
opens, React opens it twice in development on purpose, and a person taps
twice in production. Both requests look for the thread, both find none,
both insert — and the database's unique rule lets exactly one through.

The one that loses has to come back with the thread the winner made. It
used to come back with an error instead, because the losing row was still
waiting in the session and the lookup for the winner tried to write it a
second time.

These tests make the losing path happen on purpose, by hiding the existing
row from the first look.
"""

from app.conversation import service
from app.models.conversation import Conversation
from app.models.user import User


def _two_people(db_session):
    one = User(telegram_id=5101, first_name="Ali")
    two = User(telegram_id=5102, first_name="Sara")
    db_session.add_all([one, two])
    db_session.commit()
    return one, two


def test_losing_the_race_returns_the_thread_the_winner_made(db_session, monkeypatch):
    one, two = _two_people(db_session)
    winner = service.get_or_create_direct(db_session, one.id, two.id)
    db_session.commit()

    # The second request's first look happens before the winner's row is
    # visible to it, so it finds nothing — exactly as in the real race.
    real_lookup = service.get_direct
    looks = {"count": 0}

    def blind_on_first_look(db, a, b):
        looks["count"] += 1
        return None if looks["count"] == 1 else real_lookup(db, a, b)

    monkeypatch.setattr(service, "get_direct", blind_on_first_look)

    loser = service.get_or_create_direct(db_session, one.id, two.id)

    assert loser.id == winner.id
    assert db_session.query(Conversation).count() == 1


def test_the_session_is_still_usable_after_losing(db_session, monkeypatch):
    """Not just the return value: the rest of the same request has to be
    able to carry on writing, which is what failed in practice."""
    one, two = _two_people(db_session)
    service.get_or_create_direct(db_session, one.id, two.id)
    db_session.commit()

    real_lookup = service.get_direct
    looks = {"count": 0}

    def blind_on_first_look(db, a, b):
        looks["count"] += 1
        return None if looks["count"] == 1 else real_lookup(db, a, b)

    monkeypatch.setattr(service, "get_direct", blind_on_first_look)
    service.get_or_create_direct(db_session, one.id, two.id)

    db_session.add(User(telegram_id=5103, first_name="Nima"))
    db_session.commit()
    assert db_session.query(User).filter_by(telegram_id=5103).count() == 1


def test_opening_the_same_chat_twice_through_the_api_is_harmless(client, db_session):
    from tests.helpers import sign_init_data

    def auth(telegram_id, name):
        return {"X-Telegram-Init-Data": sign_init_data({"id": telegram_id, "first_name": name})}

    client.get("/me", headers=auth(5201, "Ali"))
    client.get("/me", headers=auth(5202, "Sara"))
    sara = db_session.query(User).filter_by(telegram_id=5202).one()

    first = client.post("/conversations", json={"user_id": sara.id}, headers=auth(5201, "Ali"))
    second = client.post("/conversations", json={"user_id": sara.id}, headers=auth(5201, "Ali"))

    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["id"] == second.json()["id"]
