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


def test_the_line_under_a_body_is_their_note_of_the_day_not_a_bio(client, db_session):
    """Section 32: the bio is gone; the note of the day takes its place, and
    with no note there is nothing — only the name."""
    _someone(client, db_session, 7040, "Ali")
    two = _someone(client, db_session, 7041, "Sara")
    db_session.add(Profile(user_id=two.id, bio="An old bio nobody sees any more"))
    db_session.commit()

    sky = client.get("/sky", headers=_auth(7040)).json()
    assert sky[0]["tagline"] is None
    assert sky[0]["initial"] == "S"

    client.put("/profile/me/note", json={"text": "I am awake at odd hours"}, headers=_auth(7041))
    sky = client.get("/sky", headers=_auth(7040)).json()
    assert sky[0]["tagline"] == "I am awake at odd hours"


def test_being_in_the_app_is_what_makes_you_online(client, db_session):
    """last_seen is written by authentication itself, so "here now" is a
    fact rather than something anybody has to remember to report."""
    _someone(client, db_session, 7050, "Ali")
    watcher = _someone(client, db_session, 7051, "Sara")
    db_session.refresh(watcher)
    assert watcher.last_seen_at is not None

    sky = client.get("/sky", headers=_auth(7050)).json()
    assert sky[0]["online"] is True


# --- moons: "has something to show" (section 29.14) ---------------------


def _content(db_session, owner, audience="public", deleted=False):
    from app.models.content import Content, ContentAudience, ContentType

    db_session.add(
        Content(
            user_id=owner.id,
            content_type=ContentType.PHOTO,
            original_file_path="x.jpg",
            audience_type=ContentAudience(audience),
            audience_user_id=owner.id if audience == "user" else None,
            deleted_at=utcnow() if deleted else None,
        )
    )
    db_session.commit()


def _offer(db_session, owner, active=True):
    from app.models.offer import Offer, OfferStatus

    db_session.add(
        Offer(
            provider_id=owner.id,
            price_photons=40,
            session_duration_seconds=600,
            title="t",
            description="d",
            status=OfferStatus.ACTIVE if active else OfferStatus.INACTIVE,
        )
    )
    db_session.commit()


def _moons(client, viewer, name):
    sky = client.get("/sky", headers=_auth(viewer)).json()
    return next(p["moons"] for p in sky if p["display_name"] == name)


def test_somebody_with_nothing_to_show_has_no_moons(client, db_session):
    _someone(client, db_session, 7201, "Ali")
    _someone(client, db_session, 7202, "Sara")
    assert _moons(client, 7201, "Sara") == 0


def test_content_and_offers_both_become_moons(client, db_session):
    """Free and paid alike, so a moon never means "this one sells"."""
    _someone(client, db_session, 7203, "Ali")
    sara = _someone(client, db_session, 7204, "Sara")
    _content(db_session, sara)
    _offer(db_session, sara)
    assert _moons(client, 7203, "Sara") == 2


def test_never_more_than_three_moons(client, db_session):
    _someone(client, db_session, 7205, "Ali")
    sara = _someone(client, db_session, 7206, "Sara")
    for _ in range(5):
        _content(db_session, sara)
    assert _moons(client, 7205, "Sara") == 3


def test_only_what_everyone_can_see_counts(client, db_session):
    """A moon that leads to nothing is a promise the app does not keep."""
    _someone(client, db_session, 7207, "Ali")
    sara = _someone(client, db_session, 7208, "Sara")
    _content(db_session, sara, audience="user")
    _content(db_session, sara, deleted=True)
    _offer(db_session, sara, active=False)
    assert _moons(client, 7207, "Sara") == 0


def test_the_world_reads_one_page_and_keeps_a_hidden_online_out_of_the_front(client, db_session):
    """Section 32: the database picks the page (never everybody), and
    somebody hiding when they are online is not put first for being here."""
    from datetime import timedelta

    from app.core.time import utcnow

    _someone(client, db_session, 7090, "Viewer")
    hider = _someone(client, db_session, 7091, "Hider")
    shown = _someone(client, db_session, 7092, "Shown")
    away = _someone(client, db_session, 7093, "Away")
    client.put("/me/privacy", json={"hide_online": True}, headers=_auth(7091))
    away.last_seen_at = utcnow() - timedelta(days=3)
    hider.last_seen_at = utcnow()
    shown.last_seen_at = utcnow() - timedelta(minutes=1)
    db_session.commit()

    sky = client.get("/sky?limit=2", headers=_auth(7090)).json()
    assert len(sky) == 2
    assert sky[0]["user_id"] == shown.id and sky[0]["online"] is True
    assert sky[1]["user_id"] == hider.id and sky[1]["online"] is False


def test_opening_the_world_listens_for_the_people_in_it(client, db_session, monkeypatch):
    """From then on, whoever of them arrives lights up at once (section 43)."""
    from app.live.hub import hub

    watched = []
    monkeypatch.setattr(hub, "watch", lambda viewer, ids: watched.append((viewer, sorted(ids))))
    other = _someone(client, db_session, 8601, "Other", seen_minutes_ago=1)
    me = client.get("/me", headers=_auth(8602, "Me")).json()["id"]
    client.get("/sky", headers=_auth(8602, "Me"))
    assert watched and watched[-1][0] == me and other.id in watched[-1][1]


def test_somebody_hiding_their_presence_hears_nobody_arrive(client, db_session, monkeypatch):
    """They do not see anybody's ring, so nothing is sent to them."""
    from app.live.hub import hub

    watched = []
    monkeypatch.setattr(hub, "watch", lambda viewer, ids: watched.append(viewer))
    _someone(client, db_session, 8603, "Other", seen_minutes_ago=1)
    me = client.get("/me", headers=_auth(8604, "Me")).json()["id"]
    db_session.add(Profile(user_id=me, hide_online=True))
    db_session.commit()
    client.get("/sky", headers=_auth(8604, "Me"))
    assert watched == []
