"""
The pool, the matcher, and what becomes of a random conversation.

The rules being defended here all come from one decision
(TECHNICAL_REQUIREMENTS.md section 28.1): preferences RANK rather than
filter. With a small pool a hard filter returns nobody, and an empty
result teaches people the feature is broken — so almost every test below
is really asking "did somebody still get matched".
"""

from datetime import timedelta

import pytest

from app.core.time import utcnow
from app.models.block import Block
from app.models.conversation import Conversation
from app.models.feature_schedule import FEATURE_RANDOM_CHAT, FeatureSchedule
from app.models.profile import GENDER_FEMALE, GENDER_MALE, GENDER_UNSAID, Profile
from app.models.random_chat import (
    WANT_ANYONE,
    WANT_FEMALE,
    WANT_MALE,
    RandomChatSession,
    RandomChatTicket,
)
from app.models.report import SUSPEND_RANDOM_CHAT, Suspension
from app.models.user import User
from app.random_chat.matching import find_match, score_pair
from app.random_chat.service import end_session
from tests.helpers import sign_init_data


def _auth(telegram_id: int, first_name: str = "Test") -> dict:
    return {"X-Telegram-Init-Data": sign_init_data({"id": telegram_id, "first_name": first_name})}


def _open_the_feature(db_session, opens=0, closes=1440, enabled=True):
    """Turns random chat on for a test.

    The row is created here rather than assumed, because the test database
    is built from the models and never sees the migration that seeds it —
    and because a missing row correctly means "shut" everywhere else.
    """
    schedule = (
        db_session.query(FeatureSchedule).filter_by(feature=FEATURE_RANDOM_CHAT).one_or_none()
    )
    if schedule is None:
        schedule = FeatureSchedule(feature=FEATURE_RANDOM_CHAT)
        db_session.add(schedule)
    schedule.enabled = enabled
    schedule.opens_at_minute = opens
    schedule.closes_at_minute = closes
    db_session.commit()
    return schedule


def _person(client, db_session, telegram_id, *, gender, birth_year, name="Test"):
    """Creates a user who has been through the door."""
    client.get("/me", headers=_auth(telegram_id, name))
    user = db_session.query(User).filter_by(telegram_id=telegram_id).one()
    profile = db_session.query(Profile).filter_by(user_id=user.id).one_or_none()
    if profile is None:
        profile = Profile(user_id=user.id)
        db_session.add(profile)
    profile.gender = gender
    profile.birthday_year = birth_year
    profile.birthday_month = 3
    profile.birthday_day = 21
    db_session.commit()
    return user


def _ticket(user_id, **kwargs):
    defaults = dict(
        user_id=user_id,
        wants_gender=WANT_ANYONE,
        tags=[],
        gender=GENDER_MALE,
        age=30,
        local_minute=600,
        joined_at=utcnow(),
    )
    defaults.update(kwargs)
    return RandomChatTicket(**defaults)


# --- the door and the switch ------------------------------------------


def test_the_feature_starts_switched_off(client, db_session):
    """Built in full and held shut until the community is big enough —
    the owner's plan, and the reason the switch exists at all."""
    _person(client, db_session, 9001, gender=GENDER_MALE, birth_year=1995)
    response = client.post("/random-chat/search", json={}, headers=_auth(9001))
    assert response.status_code == 409
    assert response.json()["detail"]["reason"] == "closed"


def test_a_window_that_wraps_past_midnight_is_open_late_and_early(db_session):
    schedule = _open_the_feature(db_session, opens=22 * 60, closes=2 * 60)
    assert schedule.is_open_at(23 * 60) is True
    assert schedule.is_open_at(1 * 60) is True
    assert schedule.is_open_at(12 * 60) is False


def test_the_countdown_says_how_long_until_it_opens(db_session):
    """An event nobody knows is coming brings nobody back, so the wait
    itself has to be visible all day."""
    schedule = _open_the_feature(db_session, opens=22 * 60, closes=24 * 60)
    assert schedule.minutes_until_open(20 * 60) == 120
    # Already open: there is nothing to count down to.
    assert schedule.minutes_until_open(23 * 60) is None


def test_someone_who_has_not_been_through_the_door_is_refused(client, db_session):
    _open_the_feature(db_session)
    client.get("/me", headers=_auth(9002))
    response = client.post("/random-chat/search", json={}, headers=_auth(9002))
    assert response.status_code == 409
    assert response.json()["detail"]["reason"] == "profile_incomplete"
    assert "gender" in response.json()["detail"]["missing"]


def test_a_suspended_account_cannot_search(client, db_session):
    _open_the_feature(db_session)
    user = _person(client, db_session, 9003, gender=GENDER_MALE, birth_year=1995)
    db_session.add(
        Suspension(
            user_id=user.id,
            scope=SUSPEND_RANDOM_CHAT,
            expires_at=utcnow() + timedelta(hours=1),
            created_by_user_id=user.id,
        )
    )
    db_session.commit()
    response = client.post("/random-chat/search", json={}, headers=_auth(9003))
    assert response.status_code == 403
    assert response.json()["detail"]["reason"] == "suspended"


def test_a_suspension_that_has_run_out_stops_stopping_anyone(client, db_session):
    """Self-expiring is the point: a suspension somebody has to remember
    to lift is one that quietly becomes permanent."""
    _open_the_feature(db_session)
    user = _person(client, db_session, 9004, gender=GENDER_MALE, birth_year=1995)
    db_session.add(
        Suspension(
            user_id=user.id,
            scope=SUSPEND_RANDOM_CHAT,
            expires_at=utcnow() - timedelta(minutes=1),
            created_by_user_id=user.id,
        )
    )
    db_session.commit()
    assert client.post("/random-chat/search", json={}, headers=_auth(9004)).status_code == 200


# --- the pool ---------------------------------------------------------


def test_tapping_twice_leaves_one_ticket(client, db_session):
    """Pressing the button means joining a pool, not sending a request —
    so impatience costs the server nothing."""
    _open_the_feature(db_session)
    _person(client, db_session, 9005, gender=GENDER_MALE, birth_year=1995)
    for _ in range(4):
        assert client.post("/random-chat/search", json={}, headers=_auth(9005)).status_code == 200
    assert db_session.query(RandomChatTicket).count() == 1


def test_waiting_alone_matches_nobody_and_says_so(client, db_session):
    _open_the_feature(db_session)
    _person(client, db_session, 9006, gender=GENDER_MALE, birth_year=1995)
    body = client.post("/random-chat/search", json={}, headers=_auth(9006)).json()
    assert body["waiting"] is True
    assert body["matched"] is None


def test_leaving_the_pool_stops_the_wait_but_keeps_the_search(client, db_session):
    """The row survives because it is also the record of what they last
    searched for; what ends is the waiting."""
    _open_the_feature(db_session)
    _person(client, db_session, 9007, gender=GENDER_MALE, birth_year=1995)
    client.post("/random-chat/search", json={}, headers=_auth(9007))
    assert client.delete("/random-chat/search", headers=_auth(9007)).status_code == 204
    assert db_session.query(RandomChatTicket).filter_by(active=True).count() == 0
    assert db_session.query(RandomChatTicket).count() == 1


def test_two_people_are_matched_and_both_stop_waiting(client, db_session):
    _open_the_feature(db_session)
    _person(client, db_session, 9010, gender=GENDER_MALE, birth_year=1995, name="Ali")
    _person(client, db_session, 9011, gender=GENDER_FEMALE, birth_year=1996, name="Sara")

    client.post("/random-chat/search", json={}, headers=_auth(9010))
    second = client.post("/random-chat/search", json={}, headers=_auth(9011)).json()

    assert second["matched"] is not None
    assert second["matched"]["display_name"] == "Ali"
    assert db_session.query(RandomChatTicket).filter_by(active=True).count() == 0

    # The person who was already waiting finds out by asking, which is
    # what keeps the matcher from having to push anything.
    first = client.get("/random-chat/status", headers=_auth(9010)).json()
    assert first["matched"]["display_name"] == "Sara"
    assert first["matched"]["session_id"] == second["matched"]["session_id"]


def test_reopening_mid_conversation_lands_you_back_in_it(client, db_session):
    _open_the_feature(db_session)
    _person(client, db_session, 9012, gender=GENDER_MALE, birth_year=1995)
    _person(client, db_session, 9013, gender=GENDER_FEMALE, birth_year=1996)
    client.post("/random-chat/search", json={}, headers=_auth(9012))
    matched = client.post("/random-chat/search", json={}, headers=_auth(9013)).json()

    again = client.post("/random-chat/search", json={}, headers=_auth(9013)).json()
    assert again["matched"]["session_id"] == matched["matched"]["session_id"]
    assert db_session.query(RandomChatSession).count() == 1


# --- the matcher ------------------------------------------------------


def test_a_preference_that_cannot_be_met_still_produces_a_match(db_session):
    """The whole point of ranking instead of filtering: with a small pool
    a hard filter returns nobody, and nobody is the worst answer."""
    wanting_women = _ticket(1, wants_gender=WANT_FEMALE, gender=GENDER_MALE)
    only_man_available = _ticket(2, wants_gender=WANT_ANYONE, gender=GENDER_MALE)
    pairing = score_pair(wanting_women, only_man_available)
    assert pairing.gender_as_asked is False
    # Still a real score, so this pairing is allowed to happen.
    assert pairing.score >= 0


def test_getting_what_you_asked_for_scores_higher(db_session):
    asker = _ticket(1, wants_gender=WANT_FEMALE, gender=GENDER_MALE)
    right = _ticket(2, wants_gender=WANT_MALE, gender=GENDER_FEMALE)
    wrong = _ticket(3, wants_gender=WANT_MALE, gender=GENDER_MALE)
    assert score_pair(asker, right).score > score_pair(asker, wrong).score


def test_shared_tags_raise_the_score(db_session):
    asker = _ticket(1, tags=["music", "film"])
    shares_two = _ticket(2, tags=["music", "film"])
    shares_none = _ticket(3, tags=["sport"])
    assert score_pair(asker, shares_two).score > score_pair(asker, shares_none).score
    assert score_pair(asker, shares_two).shared_tags == ["music", "film"]


def test_someone_who_declined_to_say_only_meets_people_who_do_not_mind(db_session):
    """Otherwise "prefer not to say" is a value nobody ever searches for,
    and picking it would mean never being matched at all."""
    unsaid = _ticket(1, gender=GENDER_UNSAID, wants_gender=WANT_ANYONE)
    does_not_mind = _ticket(2, gender=GENDER_MALE, wants_gender=WANT_ANYONE)
    wants_women = _ticket(3, gender=GENDER_MALE, wants_gender=WANT_FEMALE)
    assert score_pair(does_not_mind, unsaid).gender_as_asked is True
    assert score_pair(wants_women, unsaid).gender_as_asked is False


def test_waiting_longer_beats_a_better_match_that_just_arrived(db_session):
    """Without this, an unusual set of preferences waits forever while
    the easy matches keep pairing off in front of them."""
    now = utcnow()
    asker = _ticket(1, wants_gender=WANT_FEMALE, gender=GENDER_MALE, joined_at=now)
    perfect_but_new = _ticket(
        2, gender=GENDER_FEMALE, wants_gender=WANT_MALE, joined_at=now
    )
    wrong_but_patient = _ticket(
        3, gender=GENDER_MALE, wants_gender=WANT_MALE,
        joined_at=now - timedelta(minutes=30),
    )
    fresh = score_pair(asker, perfect_but_new, now=now).score
    patient = score_pair(asker, wrong_but_patient, now=now).score
    assert patient > fresh


def test_blocked_people_are_never_matched_in_either_direction(client, db_session):
    """A block is one-directional, but matching honours it both ways —
    otherwise the same person simply reappears from the other side."""
    _open_the_feature(db_session)
    one = _person(client, db_session, 9020, gender=GENDER_MALE, birth_year=1995)
    two = _person(client, db_session, 9021, gender=GENDER_FEMALE, birth_year=1996)
    db_session.add(Block(blocker_id=two.id, blocked_id=one.id))
    db_session.commit()

    client.post("/random-chat/search", json={}, headers=_auth(9020))
    second = client.post("/random-chat/search", json={}, headers=_auth(9021)).json()

    assert second["matched"] is None
    assert second["waiting"] is True
    assert db_session.query(RandomChatSession).count() == 0


# --- searches are validated -------------------------------------------


def test_an_unknown_tag_is_refused(client, db_session):
    _open_the_feature(db_session)
    _person(client, db_session, 9030, gender=GENDER_MALE, birth_year=1995)
    response = client.post(
        "/random-chat/search", json={"tags": ["not-a-real-tag"]}, headers=_auth(9030)
    )
    assert response.status_code == 400
    assert response.json()["detail"]["reason"] == "unknown_tags"


def test_more_than_three_tags_is_refused(client, db_session):
    _open_the_feature(db_session)
    _person(client, db_session, 9031, gender=GENDER_MALE, birth_year=1995)
    response = client.post(
        "/random-chat/search",
        json={"tags": ["music", "film", "books", "games"]},
        headers=_auth(9031),
    )
    assert response.status_code == 400
    assert response.json()["detail"]["reason"] == "too_many_tags"


# --- how it ends ------------------------------------------------------


def _matched_pair(client, db_session, a=9040, b=9041):
    _open_the_feature(db_session)
    _person(client, db_session, a, gender=GENDER_MALE, birth_year=1995, name="Ali")
    _person(client, db_session, b, gender=GENDER_FEMALE, birth_year=1996, name="Sara")
    client.post("/random-chat/search", json={}, headers=_auth(a))
    body = client.post("/random-chat/search", json={}, headers=_auth(b)).json()
    return body["matched"]["session_id"], body["matched"]["conversation_id"]


def test_leaving_tells_the_other_person_but_does_not_take_the_thread(client, db_session):
    """Walking out should not also delete the screen from under the
    person walked out on."""
    session_id, conversation_id = _matched_pair(client, db_session)
    assert client.post(
        f"/random-chat/sessions/{session_id}/leave", headers=_auth(9040)
    ).status_code == 204

    session = db_session.query(RandomChatSession).one()
    db_session.refresh(session)
    assert session.ended_at is not None

    # The one who stayed can still read it.
    messages = client.get(
        f"/conversations/{conversation_id}/messages", headers=_auth(9041)
    )
    assert messages.status_code == 200


def test_a_thread_nobody_kept_disappears_from_both_lists(client, db_session):
    session_id, _ = _matched_pair(client, db_session, a=9042, b=9043)
    client.post(f"/random-chat/sessions/{session_id}/leave", headers=_auth(9042))

    for telegram_id in (9042, 9043):
        listed = client.get("/conversations", headers=_auth(telegram_id)).json()
        assert listed == []


def test_the_transcript_never_survives_for_either_person(client, db_session):
    """What is kept is the person, never the conversation.

    People say things to a stranger that they would not say to somebody
    who will still be there tomorrow, and a permanent transcript makes
    everyone careful — which is the one thing this feature cannot afford.
    """
    session_id, _ = _matched_pair(client, db_session, a=9044, b=9045)
    for telegram_id in (9044, 9045):
        assert client.post(
            f"/random-chat/sessions/{session_id}/follow", headers=_auth(telegram_id)
        ).status_code == 200

    client.post(f"/random-chat/sessions/{session_id}/leave", headers=_auth(9044))

    for telegram_id in (9044, 9045):
        assert client.get("/conversations", headers=_auth(telegram_id)).json() == []


def test_following_from_the_chat_is_an_ordinary_request(client, db_session):
    """A shortcut to the button on their profile, not a special bond: the
    other person still decides."""
    session_id, _ = _matched_pair(client, db_session, a=9046, b=9047)
    body = client.post(
        f"/random-chat/sessions/{session_id}/follow", headers=_auth(9046)
    ).json()
    assert body == {"mutual": False, "follow_status": "requested"}

    # It shows up where every other follow request does, waiting for them.
    incoming = client.get("/follow/incoming-requests", headers=_auth(9047)).json()
    assert [r["status"] for r in incoming] == ["pending"]


def test_both_pressing_follow_makes_it_mutual_at_once(client, db_session):
    """Both have said yes to the same thing, so there is nobody left to
    ask — a follow and a follow-back in one move."""
    session_id, _ = _matched_pair(client, db_session, a=9070, b=9071)
    first = client.post(
        f"/random-chat/sessions/{session_id}/follow", headers=_auth(9070)
    ).json()
    second = client.post(
        f"/random-chat/sessions/{session_id}/follow", headers=_auth(9071)
    ).json()

    assert first["mutual"] is False
    assert second == {"mutual": True, "follow_status": "following"}

    # Nothing is left waiting for anybody to approve. The rows are still
    # there — this list keeps the history too — but none of them is
    # pending any more.
    for telegram_id in (9070, 9071):
        incoming = client.get("/follow/incoming-requests", headers=_auth(telegram_id)).json()
        assert [r["status"] for r in incoming] == ["accepted"]


def test_the_button_says_whether_it_has_been_pressed(client, db_session):
    session_id, _ = _matched_pair(client, db_session, a=9072, b=9073)
    before = client.get("/random-chat/status", headers=_auth(9072)).json()
    assert before["matched"]["follow_status"] == "none"

    client.post(f"/random-chat/sessions/{session_id}/follow", headers=_auth(9072))
    after = client.get("/random-chat/status", headers=_auth(9072)).json()
    assert after["matched"]["follow_status"] == "requested"


def test_a_thread_that_existed_before_is_never_cleared(client, db_session):
    """Belt and braces.

    The matcher now refuses to pair two people who already talk, so this
    can no longer arise through the app — but the rule that their earlier
    history is not ours to clear is worth holding on its own, and it is
    checked here at the level where it is enforced.
    """
    _open_the_feature(db_session)
    one = _person(client, db_session, 9048, gender=GENDER_MALE, birth_year=1995)
    two = _person(client, db_session, 9049, gender=GENDER_FEMALE, birth_year=1996)

    opened = client.post(
        "/conversations", json={"user_id": two.id}, headers=_auth(9048)
    ).json()
    client.post(
        f"/conversations/{opened['id']}/messages",
        data={"type": "text", "text": "hello from before"},
        headers=_auth(9048),
    )

    session = RandomChatSession(
        conversation_id=opened["id"],
        user_a_id=min(one.id, two.id),
        user_b_id=max(one.id, two.id),
        # The thread was theirs already; the matcher did not make it.
        created_conversation=False,
        shared_tags=[],
        started_at=utcnow(),
    )
    db_session.add(session)
    db_session.commit()

    end_session(db_session, session, ended_by_user_id=one.id)
    db_session.commit()

    for telegram_id in (9048, 9049):
        listed = client.get("/conversations", headers=_auth(telegram_id)).json()
        assert [c["id"] for c in listed] == [opened["id"]]


# --- the daily cap ----------------------------------------------------


def test_unlimited_is_where_the_cap_starts(client, db_session):
    """The tick box starts ticked, so the number beside it is stored but
    not applied — it is there to be turned on later."""
    _open_the_feature(db_session)
    _person(client, db_session, 9050, gender=GENDER_MALE, birth_year=1995)
    body = client.post("/random-chat/search", json={}, headers=_auth(9050)).json()
    assert body["remaining_today"] is None


def test_a_cap_of_one_stops_the_second_conversation(client, db_session):
    schedule = _open_the_feature(db_session)
    schedule.daily_quota = 1
    schedule.daily_quota_unlimited = False
    db_session.commit()

    _person(client, db_session, 9051, gender=GENDER_MALE, birth_year=1995)
    _person(client, db_session, 9052, gender=GENDER_FEMALE, birth_year=1996)
    client.post("/random-chat/search", json={}, headers=_auth(9051))
    matched = client.post("/random-chat/search", json={}, headers=_auth(9052)).json()
    assert matched["matched"] is not None

    client.post(
        f"/random-chat/sessions/{matched['matched']['session_id']}/leave",
        headers=_auth(9051),
    )
    refused = client.post("/random-chat/search", json={}, headers=_auth(9051))
    assert refused.status_code == 429
    assert refused.json()["detail"]["reason"] == "daily_quota_reached"


def test_the_cap_counts_down_where_it_can_be_seen(client, db_session):
    schedule = _open_the_feature(db_session)
    schedule.daily_quota = 5
    schedule.daily_quota_unlimited = False
    db_session.commit()
    _person(client, db_session, 9053, gender=GENDER_MALE, birth_year=1995)
    body = client.get("/random-chat/status", headers=_auth(9053)).json()
    assert body["remaining_today"] == 5


# --- remembering the last search --------------------------------------


def test_the_first_search_has_nothing_to_remember(client, db_session):
    _open_the_feature(db_session)
    _person(client, db_session, 9060, gender=GENDER_MALE, birth_year=1995)
    assert client.get("/random-chat/status", headers=_auth(9060)).json()["last_search"] is None


def test_the_last_search_comes_back_for_the_next_one(client, db_session):
    """One tap to search again, with the previous choices visible rather
    than applied behind their back."""
    _open_the_feature(db_session)
    _person(client, db_session, 9061, gender=GENDER_MALE, birth_year=1995)
    client.post(
        "/random-chat/search",
        json={"wants_gender": "female", "wants_age_min": 25, "wants_age_max": 35, "tags": ["music"]},
        headers=_auth(9061),
    )
    client.delete("/random-chat/search", headers=_auth(9061))

    body = client.get("/random-chat/status", headers=_auth(9061)).json()
    assert body["waiting"] is False
    assert body["last_search"] == {
        "wants_gender": "female",
        "wants_age_min": 25,
        "wants_age_max": 35,
        "tags": ["music"],
    }


def test_leaving_the_pool_really_stops_the_matching(client, db_session):
    """The row survives so the search can be remembered, which would be a
    bug if it also kept them in the pool."""
    _open_the_feature(db_session)
    _person(client, db_session, 9062, gender=GENDER_MALE, birth_year=1995)
    _person(client, db_session, 9063, gender=GENDER_FEMALE, birth_year=1996)
    client.post("/random-chat/search", json={}, headers=_auth(9062))
    client.delete("/random-chat/search", headers=_auth(9062))

    second = client.post("/random-chat/search", json={}, headers=_auth(9063)).json()
    assert second["matched"] is None
    assert db_session.query(RandomChatSession).count() == 0


def test_a_matched_person_is_no_longer_waiting(client, db_session):
    _open_the_feature(db_session)
    _person(client, db_session, 9064, gender=GENDER_MALE, birth_year=1995)
    _person(client, db_session, 9065, gender=GENDER_FEMALE, birth_year=1996)
    client.post("/random-chat/search", json={}, headers=_auth(9064))
    client.post("/random-chat/search", json={}, headers=_auth(9065))

    for telegram_id in (9064, 9065):
        assert client.get("/random-chat/status", headers=_auth(telegram_id)).json()["waiting"] is False


def test_unticking_unlimited_brings_back_the_number_that_was_kept(db_session):
    """The whole reason the number and the switch are separate columns:
    ticking "unlimited" must not throw the number away."""
    schedule = _open_the_feature(db_session)
    schedule.daily_quota = 7
    schedule.daily_quota_unlimited = True
    db_session.commit()
    assert schedule.effective_daily_quota is None

    schedule.daily_quota_unlimited = False
    db_session.commit()
    assert schedule.effective_daily_quota == 7


# --- who you should not be handed --------------------------------------


def test_two_people_who_already_chat_are_never_matched(client, db_session):
    """The button says "meet someone new". Two friends who are both
    online do not message each other and then bump into each other by
    accident — it reads as a mistake."""
    _open_the_feature(db_session)
    one = _person(client, db_session, 9080, gender=GENDER_MALE, birth_year=1995)
    two = _person(client, db_session, 9081, gender=GENDER_FEMALE, birth_year=1996)

    opened = client.post(
        "/conversations", json={"user_id": two.id}, headers=_auth(9080)
    ).json()
    client.post(
        f"/conversations/{opened['id']}/messages",
        data={"type": "text", "text": "we already know each other"},
        headers=_auth(9080),
    )

    client.post("/random-chat/search", json={}, headers=_auth(9080))
    second = client.post("/random-chat/search", json={}, headers=_auth(9081)).json()

    assert second["matched"] is None
    assert second["waiting"] is True


def test_an_empty_thread_does_not_count_as_knowing_someone(client, db_session):
    """Opening a chat screen and saying nothing is not a relationship."""
    _open_the_feature(db_session)
    one = _person(client, db_session, 9082, gender=GENDER_MALE, birth_year=1995)
    two = _person(client, db_session, 9083, gender=GENDER_FEMALE, birth_year=1996)
    client.post("/conversations", json={"user_id": two.id}, headers=_auth(9082))

    client.post("/random-chat/search", json={}, headers=_auth(9082))
    second = client.post("/random-chat/search", json={}, headers=_auth(9083)).json()
    assert second["matched"] is not None


def test_meeting_the_same_person_again_at_random_is_allowed(client, db_session):
    """Nothing of a random conversation is kept, so there is no thread
    between them and nothing stopping it happening twice."""
    _open_the_feature(db_session)
    _person(client, db_session, 9084, gender=GENDER_MALE, birth_year=1995)
    _person(client, db_session, 9085, gender=GENDER_FEMALE, birth_year=1996)

    client.post("/random-chat/search", json={}, headers=_auth(9084))
    first = client.post("/random-chat/search", json={}, headers=_auth(9085)).json()
    client.post(
        f"/conversations/{first['matched']['conversation_id']}/messages",
        data={"type": "text", "text": "hi"},
        headers=_auth(9084),
    )
    client.post(
        f"/random-chat/sessions/{first['matched']['session_id']}/leave",
        headers=_auth(9084),
    )

    client.post("/random-chat/search", json={}, headers=_auth(9084))
    again = client.post("/random-chat/search", json={}, headers=_auth(9085)).json()
    assert again["matched"] is not None


def test_a_new_face_wins_a_tie_against_someone_already_met(db_session):
    """Not an exclusion, a nudge: between two equally good candidates the
    person you have not met comes first."""
    fresh = score_pair(_ticket(1), _ticket(2), met_before=False)
    again = score_pair(_ticket(1), _ticket(3), met_before=True)
    assert fresh.score > again.score
