"""
The sky: who the world shows you, and in what order.

The rules being defended here are the ones that decide what kind of place
this is. Money never appears. Everyone appears, not only people selling
something. Whoever is here right now comes first, because a world of
people who left is not a world.
"""

from datetime import timedelta

from app.core.time import utcnow
from app.models.block import Block
from app.models.profile import Profile
from app.models.user import User
from tests.helpers import sign_init_data


def _auth(telegram_id: int, first_name: str = "Test") -> dict:
    return {"X-Telegram-Init-Data": sign_init_data({"id": telegram_id, "first_name": first_name})}


def _someone(client, db_session, telegram_id, name="Test", *, seen_minutes_ago=None):
    client.get("/me", headers=_auth(telegram_id, name))
    user = db_session.query(User).filter_by(telegram_id=telegram_id).one()
    if seen_minutes_ago is not None:
        user.last_seen_at = utcnow() - timedelta(minutes=seen_minutes_ago)
        db_session.commit()
    return user


def test_the_sky_never_contains_you(client, db_session):
    """You are the one thing in the world you cannot meet."""
    _someone(client, db_session, 7001, "Ali")
    _someone(client, db_session, 7002, "Sara")
    sky = client.get("/sky", headers=_auth(7001)).json()
    assert 7001 not in [p["user_id"] for p in sky]
    assert [p["display_name"] for p in sky] == ["Sara"]


def test_everyone_is_in_the_sky_not_only_people_selling_something(client, db_session):
    """Decided in section 26. A sky of sellers is a catalogue; a sky of
    people is a world."""
    _someone(client, db_session, 7003, "Ali")
    _someone(client, db_session, 7004, "Sara")
    _someone(client, db_session, 7005, "Nima")
    sky = client.get("/sky", headers=_auth(7003)).json()
    assert sorted(p["display_name"] for p in sky) == ["Nima", "Sara"]


def test_the_sky_says_nothing_about_money(client, db_session):
    """The moment the sky shows who charges, it becomes a ranking of
    people — the paid ones desirable, the free ones available."""
    _someone(client, db_session, 7006, "Ali")
    _someone(client, db_session, 7007, "Sara")
    sky = client.get("/sky", headers=_auth(7006)).json()
    forbidden = {"price", "offers", "offer_count", "price_from", "has_offer"}
    assert forbidden.isdisjoint(sky[0].keys())


def test_somebody_here_now_comes_before_somebody_who_left(client, db_session):
    _someone(client, db_session, 7010, "Ali")
    _someone(client, db_session, 7011, "Gone", seen_minutes_ago=600)
    _someone(client, db_session, 7012, "Here", seen_minutes_ago=0)

    sky = client.get("/sky", headers=_auth(7010)).json()
    assert [p["display_name"] for p in sky][0] == "Here"
    assert sky[0]["online"] is True


def test_online_lingers_a_few_minutes_rather_than_blinking_out(client, db_session):
    """Somebody reading a long message has not left, and a ring that goes
    out mid-sentence is worse than one that lingers."""
    _someone(client, db_session, 7013, "Ali")
    _someone(client, db_session, 7014, "Recent", seen_minutes_ago=3)
    _someone(client, db_session, 7015, "Older", seen_minutes_ago=30)

    sky = {p["display_name"]: p for p in client.get("/sky", headers=_auth(7013)).json()}
    assert sky["Recent"]["online"] is True
    assert sky["Older"]["online"] is False


def test_a_brand_new_account_is_marked_new_rather_than_left_dim(client, db_session):
    """Dim reads as "nobody wanted this person", which is a judgement the
    sky has no business making about a stranger."""
    _someone(client, db_session, 7016, "Ali")
    _someone(client, db_session, 7017, "Newcomer")
    sky = client.get("/sky", headers=_auth(7016)).json()
    assert sky[0]["is_new"] is True
    assert sky[0]["trust"] == 0


def test_a_blocked_person_is_gone_from_both_skies(client, db_session):
    """One-directional to record, both ways to enforce — a block that
    worked one way would leave the blocked person still looking at
    somebody who wanted them gone."""
    one = _someone(client, db_session, 7020, "Ali")
    two = _someone(client, db_session, 7021, "Sara")
    db_session.add(Block(blocker_id=one.id, blocked_id=two.id))
    db_session.commit()

    assert client.get("/sky", headers=_auth(7020)).json() == []
    assert client.get("/sky", headers=_auth(7021)).json() == []


def test_the_sky_never_hands_over_more_than_one_screen(client, db_session):
    """The device never receives more than a screenful however many people
    exist — which is the whole reason this can work at a million users."""
    _someone(client, db_session, 7030, "Ali")
    for index in range(8):
        _someone(client, db_session, 7100 + index, f"P{index}")

    sky = client.get("/sky?limit=3", headers=_auth(7030)).json()
    assert len(sky) == 3


def test_a_tagline_comes_from_their_own_words(client, db_session):
    one = _someone(client, db_session, 7040, "Ali")
    two = _someone(client, db_session, 7041, "Sara")
    db_session.add(Profile(user_id=two.id, bio="I am awake at odd hours"))
    db_session.commit()

    sky = client.get("/sky", headers=_auth(7040)).json()
    assert sky[0]["tagline"] == "I am awake at odd hours"
    assert sky[0]["initial"] == "S"


def test_being_in_the_app_is_what_makes_you_online(client, db_session):
    """last_seen is written by authentication itself, so "here now" is a
    fact rather than something anybody has to remember to report."""
    _someone(client, db_session, 7050, "Ali")
    watcher = _someone(client, db_session, 7051, "Sara")
    db_session.refresh(watcher)
    assert watcher.last_seen_at is not None

    sky = client.get("/sky", headers=_auth(7050)).json()
    assert sky[0]["online"] is True
