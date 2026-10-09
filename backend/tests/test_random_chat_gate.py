"""
The door into random chat.

Two facts are asked here instead of at signup, because signup asks for
almost nothing on purpose and because a question answered at the moment
its reason is obvious gets answered honestly. Everything below is about
that door being neither wider nor narrower than those two facts.
"""
from datetime import date

import pytest

from app.models.profile import GENDER_FEMALE, GENDER_MALE, GENDER_UNSAID, Profile
from app.random_chat.readiness import (
    age_from_birth_year,
    is_ready_for_random_chat,
    missing_for_random_chat,
)
from tests.helpers import sign_init_data


def _auth(telegram_id: int, first_name: str = "Test") -> dict:
    return {"X-Telegram-Init-Data": sign_init_data({"id": telegram_id, "first_name": first_name})}


# --- what the door asks for -------------------------------------------


def test_echo_no_longer_asks_for_gender_or_birthday():
    """Section 32: gender and age were taken out of Echo, not asked and not
    matched on. The eighteen-or-over confirmation is asked on the first
    visit instead, before anything opens."""
    from types import SimpleNamespace

    from app.core.time import utcnow

    # Only "eighteen or over" is asked, the first time Echo opens.
    assert missing_for_random_chat(SimpleNamespace(adult_confirmed_at=None)) == ["adult"]
    assert is_ready_for_random_chat(SimpleNamespace(adult_confirmed_at=utcnow())) is True
    # And the panel can turn the question off.
    off = SimpleNamespace(ask_adult=False)
    assert missing_for_random_chat(SimpleNamespace(adult_confirmed_at=None), off) == []


# --- age --------------------------------------------------------------


def test_age_comes_from_the_year_alone():
    assert age_from_birth_year(1995, today=date(2026, 1, 1)) == 31


def test_age_is_unknown_without_a_year():
    assert age_from_birth_year(None) is None


def test_age_never_goes_negative():
    """A year in the future is nonsense the database already rejects, but
    the range matcher should not be handed a negative number if one ever
    reaches it."""
    assert age_from_birth_year(2030, today=date(2026, 1, 1)) == 0


# --- the profile endpoint ---------------------------------------------


def test_gender_can_be_saved_and_read_back(client):
    me = _auth(1, "Alice")
    client.get("/me", headers=me)

    saved = client.put("/profile/me", headers=me, json={"gender": GENDER_FEMALE}).json()

    assert saved["gender"] == GENDER_FEMALE
    assert client.get("/profile/me", headers=me).json()["gender"] == GENDER_FEMALE


def test_an_unknown_gender_is_refused(client):
    me = _auth(1, "Alice")
    client.get("/me", headers=me)

    response = client.put("/profile/me", headers=me, json={"gender": "nonsense"})

    assert response.status_code == 400


def test_gender_may_be_left_unsaid(client):
    """Signup does not ask, so most profiles start without it and must
    stay saveable."""
    me = _auth(1, "Alice")
    client.get("/me", headers=me)

    saved = client.put("/profile/me", headers=me, json={"bio": "hello"}).json()

    assert saved["gender"] is None


def test_the_door_wants_a_whole_birthday(client):
    """A birth year on its own was considered and rejected: the owner
    wants a real date, with a separate switch for hiding the year from
    other people rather than not collecting it."""
    me = _auth(1, "Alice")
    client.get("/me", headers=me)

    response = client.put("/profile/me", headers=me, json={"birthday_year": 1995})

    assert response.status_code == 400


def test_a_whole_birthday_is_accepted(client):
    me = _auth(1, "Alice")
    client.get("/me", headers=me)

    saved = client.put(
        "/profile/me",
        headers=me,
        json={"birthday_year": 1995, "birthday_month": 3, "birthday_day": 14},
    ).json()

    assert (saved["birthday_year"], saved["birthday_month"], saved["birthday_day"]) == (1995, 3, 14)


def test_gender_shows_on_a_public_profile(client):
    """Whoever is looking needs it for the same reason the matcher does;
    it is not a private field."""
    alice, bob = _auth(1, "Alice"), _auth(2, "Bob")
    alice_id = client.get("/me", headers=alice).json()["id"]
    client.get("/me", headers=bob)
    client.put("/profile/me", headers=alice, json={"gender": GENDER_FEMALE})

    seen = client.get(f"/profiles/{alice_id}", headers=bob).json()

    assert seen["gender"] == GENDER_FEMALE


def test_a_profile_that_was_never_created_reads_as_unsaid(client):
    alice, bob = _auth(1, "Alice"), _auth(2, "Bob")
    alice_id = client.get("/me", headers=alice).json()["id"]
    client.get("/me", headers=bob)

    seen = client.get(f"/profiles/{alice_id}", headers=bob).json()

    assert seen["gender"] is None


# --- the birth year: its owner's alone ---------------------------------


def test_nobody_else_ever_sees_the_year(client):
    """Nothing shows another person's birth year (section 43), so it is not
    sent at all; day and month stay, so friends can wish them one."""
    alice, bob = _auth(1, "Alice"), _auth(2, "Bob")
    alice_id = client.get("/me", headers=alice).json()["id"]
    client.get("/me", headers=bob)
    client.put(
        "/profile/me",
        headers=alice,
        json={"birthday_year": 1995, "birthday_month": 3, "birthday_day": 14},
    )

    seen = client.get(f"/profiles/{alice_id}", headers=bob).json()

    assert "birthday_year" not in seen
    assert (seen["birthday_month"], seen["birthday_day"]) == (3, 14)


def test_the_owner_still_sees_their_own_year(client):
    alice = _auth(1, "Alice")
    client.get("/me", headers=alice)
    client.put(
        "/profile/me",
        headers=alice,
        json={"birthday_year": 1995, "birthday_month": 3, "birthday_day": 14},
    )

    mine = client.get("/profile/me", headers=alice).json()

    assert mine["birthday_year"] == 1995
    assert "hide_birth_year" not in mine


def test_the_year_is_still_there_for_matching(client, db_session):
    """Not sent is not forgotten: Echo works out an age from the column."""
    from app.models.profile import Profile as ProfileModel
    alice = _auth(1, "Alice")
    client.get("/me", headers=alice)
    client.put(
        "/profile/me",
        headers=alice,
        json={
            "birthday_year": 1995,
            "birthday_month": 3,
            "birthday_day": 14,
            "gender": GENDER_FEMALE,
        },
    )

    stored = db_session.query(ProfileModel).first()
    assert stored.birthday_year == 1995


def test_declining_to_say_is_accepted_by_the_endpoint(client):
    me = _auth(1, "Alice")
    client.get("/me", headers=me)

    saved = client.put("/profile/me", headers=me, json={"gender": GENDER_UNSAID}).json()

    assert saved["gender"] == GENDER_UNSAID
