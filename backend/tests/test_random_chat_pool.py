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


def _both_start(client, a, b):
    """Both people answer the card they were shown with "start" — since
    section 32, that is what turns two people found for each other into a
    conversation. Returns the status of the second to answer."""
    proposal = client.get("/random-chat/status", headers=_auth(a)).json()["proposal"]
    assert proposal is not None
    client.post(f"/random-chat/proposals/{proposal['id']}/accept", headers=_auth(a))
    return client.post(f"/random-chat/proposals/{proposal['id']}/accept", headers=_auth(b)).json()


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
    client.post("/random-chat/search", json={}, headers=_auth(9011))
    second = _both_start(client, 9010, 9011)

    assert second["matched"] is not None
    assert second["matched"]["display_name"] == "Ali"
    assert db_session.query(RandomChatTicket).filter_by(active=True).count() == 0

    # The person who was already waiting finds out by asking, which is
    # what keeps the matcher from having to push anything.
    first = client.get("/random-chat/status", headers=_auth(9010)).json()
    assert first["matched"]["display_name"] == "Sara"
    assert first["matched"]["session_id"] == second["matched"]["session_id"]


def test_searching_again_ends_the_last_meeting_but_keeps_its_conversation(client, db_session):
    """Section 32: going back to Echo after talking to somebody finds a new
    person. The earlier meeting ends, and its conversation stays."""
    _open_the_feature(db_session)
    _person(client, db_session, 9012, gender=GENDER_MALE, birth_year=1995)
    _person(client, db_session, 9013, gender=GENDER_FEMALE, birth_year=1996)
    client.post("/random-chat/search", json={}, headers=_auth(9012))
    client.post("/random-chat/search", json={}, headers=_auth(9013))
    matched = _both_start(client, 9012, 9013)

    again = client.post("/random-chat/search", json={}, headers=_auth(9013)).json()
    assert again["matched"] is None
    assert again["waiting"] is True
    session = db_session.query(RandomChatSession).one()
    db_session.refresh(session)
    assert session.ended_at is not None
    listed = client.get("/conversations", headers=_auth(9013)).json()
    assert [c["id"] for c in listed] == [matched["matched"]["conversation_id"]]


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
    assert second["proposal"] is None
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
    client.post("/random-chat/search", json={}, headers=_auth(b))
    body = _both_start(client, a, b)
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


def test_an_echo_meeting_stays_in_both_lists_after_it_ends(client, db_session):
    """Section 32: nothing to ask and nothing to keep — the conversation
    stays for both, whoever left, until one of them deletes it."""
    session_id, conversation_id = _matched_pair(client, db_session, a=9042, b=9043)
    client.post(f"/random-chat/sessions/{session_id}/leave", headers=_auth(9042))

    for telegram_id in (9042, 9043):
        listed = client.get("/conversations", headers=_auth(telegram_id)).json()
        assert [c["id"] for c in listed] == [conversation_id]
        assert listed[0]["origin"] == "echo"


def test_what_was_said_stays_for_both_after_it_ends(client, db_session):
    """The earlier rule cleared the transcript unless both kept each other;
    the owner decided against it (section 32)."""
    session_id, conversation_id = _matched_pair(client, db_session, a=9044, b=9045)
    client.post(
        f"/conversations/{conversation_id}/messages",
        data={"type": "text", "text": "nice to meet you"},
        headers=_auth(9044),
    )
    client.post(f"/random-chat/sessions/{session_id}/leave", headers=_auth(9044))

    for telegram_id in (9044, 9045):
        texts = [m["text"] for m in client.get(
            f"/conversations/{conversation_id}/messages", headers=_auth(telegram_id)
        ).json()]
        assert texts == ["nice to meet you"]


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


def test_the_day_budget_for_new_people_applies_even_with_echo_unlimited(client, db_session):
    """Echo's own quota starts unlimited, but the day's budget for meeting
    new people — shared with "say hello", ten by default — always applies
    (section 30.21). So the door always knows how many are left."""
    _open_the_feature(db_session)
    _person(client, db_session, 9050, gender=GENDER_MALE, birth_year=1995)
    body = client.post("/random-chat/search", json={}, headers=_auth(9050)).json()
    assert body["remaining_today"] == 10


def test_a_cap_of_one_stops_the_second_conversation(client, db_session):
    schedule = _open_the_feature(db_session)
    schedule.daily_quota = 1
    schedule.daily_quota_unlimited = False
    db_session.commit()

    _person(client, db_session, 9051, gender=GENDER_MALE, birth_year=1995)
    _person(client, db_session, 9052, gender=GENDER_FEMALE, birth_year=1996)
    client.post("/random-chat/search", json={}, headers=_auth(9051))
    client.post("/random-chat/search", json={}, headers=_auth(9052))
    matched = _both_start(client, 9051, 9052)
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
    _both_start(client, 9064, 9065)

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
    assert second["proposal"] is not None


def test_two_people_who_met_through_echo_are_not_matched_again(client, db_session):
    """Their conversation stays now, so they already talk — and Echo is for
    somebody new. The way back to each other is that conversation."""
    _open_the_feature(db_session)
    _person(client, db_session, 9084, gender=GENDER_MALE, birth_year=1995)
    _person(client, db_session, 9085, gender=GENDER_FEMALE, birth_year=1996)

    client.post("/random-chat/search", json={}, headers=_auth(9084))
    client.post("/random-chat/search", json={}, headers=_auth(9085))
    first = _both_start(client, 9084, 9085)
    client.post(
        f"/conversations/{first['matched']['conversation_id']}/messages",
        data={"type": "text", "text": "hi"},
        headers=_auth(9084),
    )

    client.post("/random-chat/search", json={}, headers=_auth(9084))
    again = client.post("/random-chat/search", json={}, headers=_auth(9085)).json()
    assert again["matched"] is None
    assert again["proposal"] is None


def test_a_new_face_wins_a_tie_against_someone_already_met(db_session):
    """Not an exclusion, a nudge: between two equally good candidates the
    person you have not met comes first."""
    fresh = score_pair(_ticket(1), _ticket(2), met_before=False)
    again = score_pair(_ticket(1), _ticket(3), met_before=True)
    assert fresh.score > again.score


# --- how two people met, on the conversation list ----------------------


def test_a_thread_echo_made_says_it_came_from_echo(client, db_session):
    _open_the_feature(db_session)
    _person(client, db_session, 9090, gender=GENDER_MALE, birth_year=1995)
    _person(client, db_session, 9091, gender=GENDER_FEMALE, birth_year=1996)
    client.post("/random-chat/search", json={}, headers=_auth(9090))
    client.post("/random-chat/search", json={}, headers=_auth(9091))
    _both_start(client, 9090, 9091)
    session = db_session.query(RandomChatSession).one()
    client.post(
        f"/conversations/{session.conversation_id}/messages",
        data={"type": "text", "text": "hi"},
        headers=_auth(9090),
    )

    listed = client.get("/conversations", headers=_auth(9091)).json()
    row = next(c for c in listed if c["id"] == session.conversation_id)
    assert row["origin"] == "echo"


# --- open all day, and honest numbers ------------------------------------


def test_always_open_ignores_the_window_and_keeps_it(db_session):
    from app.models.feature_schedule import FeatureSchedule

    schedule = FeatureSchedule(feature="x", enabled=True, opens_at_minute=22 * 60, closes_at_minute=23 * 60)
    assert schedule.is_open_at(10 * 60) is False
    schedule.always_open = True
    assert schedule.is_open_at(10 * 60) is True
    assert schedule.minutes_until_open(10 * 60) is None
    # The hours are still there for when it is switched off again.
    assert (schedule.opens_at_minute, schedule.closes_at_minute) == (22 * 60, 23 * 60)
    schedule.enabled = False
    assert schedule.is_open_at(10 * 60) is False


def test_the_status_says_how_many_are_here_and_waiting(client, db_session):
    _open_the_feature(db_session)
    _person(client, db_session, 9092, gender=GENDER_MALE, birth_year=1995)
    _person(client, db_session, 9093, gender=GENDER_FEMALE, birth_year=1996)
    client.post("/random-chat/search", json={"wants_gender": "male"}, headers=_auth(9092))
    status = client.get("/random-chat/status", headers=_auth(9093)).json()
    assert status["online_now"] >= 1
    assert status["waiting_now"] == 1
    assert status["show_counts"] is True
    # Searching yourself, you are one of those searching.
    client.post("/random-chat/search", json={"wants_gender": "female"}, headers=_auth(9093))
    status = client.get("/random-chat/status", headers=_auth(9093)).json()
    if status["proposal"] is None:
        assert status["waiting_now"] == 2


def test_saving_the_panel_tells_everyone_with_the_app_open(client, db_session, monkeypatch):
    """The Echo mark in the bar changes at once when the panel turns Echo on
    or off, not only when somebody next opens Echo."""
    from app.core.config import settings
    from app.live import events

    sent = []
    monkeypatch.setattr(events.hub, "connected_user_ids", lambda: [1, 2, 3])
    monkeypatch.setattr(events.hub, "publish", lambda ids, event: sent.append((list(ids), event)))
    original = settings.owner_telegram_id
    settings.owner_telegram_id = 9096
    try:
        _open_the_feature(db_session)
        client.get("/me", headers=_auth(9096, "Owner"))
        client.put("/admin/random-chat/schedule", json={"enabled": False}, headers=_auth(9096))
    finally:
        settings.owner_telegram_id = original
    assert ([1, 2, 3], {"type": "echo", "everyone": True}) in sent


def test_the_panel_can_hide_the_numbers(client, db_session):
    """Section 32: a tick in the panel; with it off the waiting screen shows
    no numbers. On to begin with."""
    from app.core.config import settings

    original = settings.owner_telegram_id
    settings.owner_telegram_id = 9095
    try:
        _open_the_feature(db_session)
        client.get("/me", headers=_auth(9095, "Owner"))
        assert client.get("/admin/random-chat/schedule", headers=_auth(9095)).json()["show_counts"] is True
        body = {"enabled": True, "always_open": True, "show_counts": False}
        saved = client.put("/admin/random-chat/schedule", json=body, headers=_auth(9095))
        assert saved.status_code == 200, saved.text
        assert saved.json()["show_counts"] is False
        assert client.get("/random-chat/status", headers=_auth(9095)).json()["show_counts"] is False
    finally:
        settings.owner_telegram_id = original


def test_the_panel_can_open_echo_all_day(client, db_session):
    """Section 32: a switch in the panel that opens Echo round the clock and
    leaves the hours as they were, for when it is switched off."""
    from app.core.config import settings

    original = settings.owner_telegram_id
    settings.owner_telegram_id = 9094
    try:
        _open_the_feature(db_session, opens=22 * 60, closes=23 * 60)
        client.get("/me", headers=_auth(9094, "Owner"))
        body = {"enabled": True, "always_open": True, "opens_at_minute": 22 * 60, "closes_at_minute": 23 * 60,
                "daily_quota": 10, "daily_quota_unlimited": True}
        saved = client.put("/admin/random-chat/schedule", json=body, headers=_auth(9094, "Owner"))
        assert saved.status_code == 200, saved.text
        assert saved.json()["always_open"] is True
        assert saved.json()["opens_at_minute"] == 22 * 60
        status = client.get("/random-chat/status?local_minute=600", headers=_auth(9094, "Owner")).json()
        assert status["open_now"] is True
    finally:
        settings.owner_telegram_id = original


# --- the card: held for each other until both say "start" (section 32) --


def _two_searching(client, db_session, a, b):
    _open_the_feature(db_session)
    _person(client, db_session, a, gender=GENDER_MALE, birth_year=1995, name="Ali")
    _person(client, db_session, b, gender=GENDER_FEMALE, birth_year=1996, name="Sara")
    client.post("/random-chat/search", json={}, headers=_auth(a))
    return client.post("/random-chat/search", json={}, headers=_auth(b)).json()


def test_two_people_found_are_held_for_each_other_not_put_in_a_conversation(client, db_session):
    second = _two_searching(client, db_session, 9100, 9101)
    assert second["matched"] is None
    card = second["proposal"]
    assert card is not None
    assert card["seconds"] == 30
    assert card["accepted"] is False
    # No name and no photo on the card: only what there is to talk about.
    assert "display_name" not in card and "avatar_url" not in card
    first = client.get("/random-chat/status", headers=_auth(9100)).json()
    assert first["proposal"]["id"] == card["id"]
    assert db_session.query(RandomChatSession).count() == 0
    assert db_session.query(Conversation).count() == 0


def test_one_start_waits_for_the_other(client, db_session):
    card = _two_searching(client, db_session, 9102, 9103)["proposal"]
    mine = client.post(f"/random-chat/proposals/{card['id']}/accept", headers=_auth(9102)).json()
    assert mine["proposal"]["accepted"] is True
    assert mine["matched"] is None
    theirs = client.get("/random-chat/status", headers=_auth(9103)).json()
    # The other side is not told somebody already said yes.
    assert theirs["proposal"]["accepted"] is False


def test_a_no_sends_both_back_to_searching_and_never_says_who(client, db_session):
    card = _two_searching(client, db_session, 9104, 9105)["proposal"]
    client.post(f"/random-chat/proposals/{card['id']}/accept", headers=_auth(9104))
    client.post(f"/random-chat/proposals/{card['id']}/decline", headers=_auth(9105))

    for person in (9104, 9105):
        status = client.get("/random-chat/status", headers=_auth(person)).json()
        assert status["waiting"] is True
        assert status["proposal"] is None
        assert status["matched"] is None
    assert db_session.query(RandomChatSession).count() == 0


def test_two_who_passed_on_each_other_are_not_shown_again_that_day(client, db_session):
    card = _two_searching(client, db_session, 9106, 9107)["proposal"]
    client.post(f"/random-chat/proposals/{card['id']}/decline", headers=_auth(9106))
    # Both search again: still nobody but each other, and they are not paired.
    again = client.post("/random-chat/search", json={}, headers=_auth(9106)).json()
    assert again["proposal"] is None
    assert again["waiting"] is True


def test_a_no_finds_the_next_person_at_once(client, db_session):
    """Going back to searching runs the matcher straight away, because the
    next person may already be waiting."""
    card = _two_searching(client, db_session, 9108, 9109)["proposal"]
    _person(client, db_session, 9110, gender=GENDER_FEMALE, birth_year=1990, name="Mina")
    client.post("/random-chat/search", json={}, headers=_auth(9110))
    client.post(f"/random-chat/proposals/{card['id']}/decline", headers=_auth(9109))
    status = client.get("/random-chat/status", headers=_auth(9108)).json()
    assert status["proposal"] is not None
    assert status["proposal"]["id"] != card["id"]


def test_when_time_runs_out_whoever_did_not_answer_stops_searching(client, db_session):
    from app.models.random_chat import EchoProposal

    card = _two_searching(client, db_session, 9111, 9112)["proposal"]
    client.post(f"/random-chat/proposals/{card['id']}/accept", headers=_auth(9111))
    proposal = db_session.get(EchoProposal, card["id"])
    proposal.expires_at = utcnow() - timedelta(seconds=1)
    db_session.commit()

    answered = client.get("/random-chat/status", headers=_auth(9111)).json()
    silent = client.get("/random-chat/status", headers=_auth(9112)).json()
    assert answered["waiting"] is True and answered["proposal"] is None
    # Not looking at the screen: the search ends rather than holding every
    # newcomer for the full time on somebody who has gone.
    assert silent["waiting"] is False and silent["proposal"] is None


def test_stopping_the_search_while_a_card_is_up_is_a_no(client, db_session):
    card = _two_searching(client, db_session, 9113, 9114)["proposal"]
    assert client.delete("/random-chat/search", headers=_auth(9113)).status_code == 204
    other = client.get("/random-chat/status", headers=_auth(9114)).json()
    assert other["proposal"] is None and other["waiting"] is True
    mine = client.get("/random-chat/status", headers=_auth(9113)).json()
    assert mine["waiting"] is False
    assert card["id"]


def test_starting_late_does_nothing_harmful(client, db_session):
    card = _two_searching(client, db_session, 9115, 9116)["proposal"]
    client.post(f"/random-chat/proposals/{card['id']}/decline", headers=_auth(9116))
    late = client.post(f"/random-chat/proposals/{card['id']}/accept", headers=_auth(9115))
    assert late.status_code == 200
    assert late.json()["matched"] is None


def test_somebody_else_cannot_answer_your_card(client, db_session):
    card = _two_searching(client, db_session, 9117, 9118)["proposal"]
    _person(client, db_session, 9119, gender=GENDER_MALE, birth_year=1990)
    response = client.post(f"/random-chat/proposals/{card['id']}/accept", headers=_auth(9119))
    assert response.status_code == 404


def test_the_panel_sets_how_long_a_card_is_held(client, db_session):
    from app.models.feature_schedule import FeatureSchedule as Schedule

    _open_the_feature(db_session)
    row = db_session.query(Schedule).filter_by(feature=FEATURE_RANDOM_CHAT).one()
    row.proposal_seconds = 45
    db_session.commit()
    card = _two_searching(client, db_session, 9120, 9121)["proposal"]
    assert card["seconds"] == 45


# --- the interests, in tonight's order (section 32) ---------------------


def test_tags_most_chosen_right_now_come_first():
    from app.random_chat.router import tonight_order

    order = tonight_order({"film": 5, "books": 3, "music": 4})
    assert [t.tag for t in order[:3]] == ["film", "music", "books"]
    assert all(t.tonight for t in order[:3])
    assert not order[3].tonight
    # Nothing is lost.
    assert len(order) == 20


def test_a_tag_one_or_two_people_chose_does_not_move_up():
    """Otherwise the order would tell you what a particular person picked."""
    from app.random_chat.router import SEARCH_TAGS, tonight_order

    order = tonight_order({"startup": 2})
    assert [t.tag for t in order] == list(SEARCH_TAGS)
    assert not any(t.tonight for t in order)


def test_tonight_counts_the_people_searching(client, db_session):
    _open_the_feature(db_session)
    for n in range(3):
        _person(client, db_session, 9200 + n, gender=GENDER_MALE, birth_year=1990)
    _person(client, db_session, 9210, gender=GENDER_FEMALE, birth_year=1990)
    # Three people who already talk to each other, so they wait side by side.
    users = [db_session.query(User).filter_by(telegram_id=9200 + n).one() for n in range(3)]
    for a in users:
        for b in users:
            if a.id < b.id:
                db_session.add(Block(blocker_id=a.id, blocked_id=b.id))
    db_session.commit()
    for n in range(3):
        client.post("/random-chat/search", json={"tags": ["film"]}, headers=_auth(9200 + n))
    order = client.get("/random-chat/tags/tonight", headers=_auth(9210)).json()
    assert order[0] == {"tag": "film", "tonight": True}


# --- interest groups (section 32) ---------------------------------------


def test_every_interest_is_in_exactly_one_group():
    from app.random_chat.tags import GROUP_OF, SEARCH_TAGS, TAG_GROUPS

    every = [tag for tags in TAG_GROUPS.values() for tag in tags]
    assert len(every) == len(set(every)) == len(SEARCH_TAGS)
    assert set(GROUP_OF) == set(SEARCH_TAGS)
    # Few enough to see in one glance; more would be a long list again.
    assert len(TAG_GROUPS) <= 6


def test_the_same_interest_first_then_the_same_group_then_anybody(db_session):
    """The owner's idea: physics and chemistry still have something to say
    to each other — but less than physics and physics."""
    asker = _ticket(1, tags=["music"])
    same_interest = _ticket(2, tags=["music"])
    same_group = _ticket(3, tags=["film"])
    other_group = _ticket(4, tags=["sport"])
    scores = [score_pair(asker, other).score for other in (same_interest, same_group, other_group)]
    assert scores[0] > scores[1] > scores[2]
    assert score_pair(asker, same_group).shared_groups == ["fun"]
    # Already said by the shared interest: not counted twice.
    assert score_pair(asker, same_interest).shared_groups == []


def test_the_card_says_the_group_when_no_interest_is_shared(client, db_session):
    _open_the_feature(db_session)
    _person(client, db_session, 9200, gender=GENDER_MALE, birth_year=1995)
    _person(client, db_session, 9201, gender=GENDER_FEMALE, birth_year=1996)
    client.post("/random-chat/search", json={"tags": ["books"]}, headers=_auth(9200))
    card = client.post("/random-chat/search", json={"tags": ["language"]}, headers=_auth(9201)).json()["proposal"]
    assert card["shared_tags"] == []
    assert card["shared_groups"] == ["learning"]
