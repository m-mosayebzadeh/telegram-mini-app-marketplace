"""
Integration tests for GET/PUT /profile/me.
"""

from tests.helpers import make_test_image_bytes, sign_init_data

AUTH_HEADER = {"X-Telegram-Init-Data": sign_init_data({"id": 900, "first_name": "Nina"})}


def test_get_profile_requires_auth(client):
    response = client.get("/profile/me")

    assert response.status_code == 422


def test_get_profile_before_creating_returns_404(client):
    response = client.get("/profile/me", headers=AUTH_HEADER)

    assert response.status_code == 404


def test_put_creates_profile(client):
    response = client.put(
        "/profile/me",
        headers=AUTH_HEADER,
        json={"bio": "Hello there"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["bio"] == "Hello there"


def test_put_never_touches_avatar_url(client):
    """avatar_url is only ever set via POST /profile/me/avatar (see
    upload_my_avatar) — a plain bio/location edit must never wipe out an
    existing photo, and sending avatar_url in the JSON body (an old
    client, or an attacker) must be silently ignored, not honored."""
    client.put(
        "/profile/me",
        headers=AUTH_HEADER,
        json={"avatar_url": "https://example.com/a.jpg", "bio": "Hello there"},
    )

    response = client.get("/profile/me", headers=AUTH_HEADER)

    assert response.json()["avatar_url"] is None


def test_get_after_put_returns_saved_profile(client):
    client.put("/profile/me", headers=AUTH_HEADER, json={"bio": "First version"})

    response = client.get("/profile/me", headers=AUTH_HEADER)

    assert response.status_code == 200
    assert response.json()["bio"] == "First version"


def test_put_again_updates_the_same_profile_not_a_new_one(client):
    first = client.put("/profile/me", headers=AUTH_HEADER, json={"bio": "v1"}).json()
    second = client.put("/profile/me", headers=AUTH_HEADER, json={"bio": "v2"}).json()

    assert first["id"] == second["id"]
    assert second["bio"] == "v2"


def test_put_saves_location_and_interests(client):
    response = client.put(
        "/profile/me",
        headers=AUTH_HEADER,
        json={"location": "Tehran", "interests": ["Music", "Travel"]},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["location"] == "Tehran"
    assert body["interests"] == ["Music", "Travel"]


def test_put_rejects_too_many_interests(client):
    from app.models.profile import MAX_INTERESTS

    response = client.put(
        "/profile/me",
        headers=AUTH_HEADER,
        json={"interests": [f"tag{i}" for i in range(MAX_INTERESTS + 1)]},
    )

    assert response.status_code == 400


# --- is_trusted -------------------------------------------------------------
# is_trusted has no field in ProfileUpdate at all (see app/profile/schemas.py) —
# these confirm that's actually enforced, not just documented in a comment.


def test_is_trusted_defaults_to_false(client):
    response = client.put("/profile/me", headers=AUTH_HEADER, json={"bio": "Hi"})

    assert response.json()["is_trusted"] is False


def test_put_cannot_set_is_trusted(client):
    # ProfileUpdate has no is_trusted field, so Pydantic silently drops
    # this extra key (the default "ignore unknown fields" behavior) —
    # this confirms that silent-drop actually results in the badge
    # staying off, not a 422 that would at least be a visible signal.
    response = client.put("/profile/me", headers=AUTH_HEADER, json={"bio": "Hi", "is_trusted": True})

    assert response.status_code == 200
    assert response.json()["is_trusted"] is False


# --- birthday (month/day only, no year) -------------------------------------


def test_birthday_defaults_to_unset(client):
    response = client.put("/profile/me", headers=AUTH_HEADER, json={"bio": "Hi"})

    body = response.json()
    assert body["birthday_month"] is None
    assert body["birthday_day"] is None


def test_put_saves_a_valid_birthday(client):
    response = client.put(
        "/profile/me", headers=AUTH_HEADER, json={"birthday_month": 5, "birthday_day": 20}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["birthday_month"] == 5
    assert body["birthday_day"] == 20


def test_get_after_put_reflects_the_saved_birthday(client):
    client.put("/profile/me", headers=AUTH_HEADER, json={"birthday_month": 3, "birthday_day": 1})

    response = client.get("/profile/me", headers=AUTH_HEADER)

    body = response.json()
    assert body["birthday_month"] == 3
    assert body["birthday_day"] == 1


def test_put_without_birthday_fields_clears_a_previously_saved_one(client):
    # PUT /profile/me is a full replace, not a partial patch — the same
    # already-established behavior for bio/location/interests. A
    # follow-up PUT that omits birthday_month/day should clear it, the
    # same as omitting bio clears bio, not "leave it alone".
    client.put("/profile/me", headers=AUTH_HEADER, json={"birthday_month": 5, "birthday_day": 20})

    response = client.put("/profile/me", headers=AUTH_HEADER, json={"bio": "no birthday this time"})

    body = response.json()
    assert body["birthday_month"] is None
    assert body["birthday_day"] is None


def test_put_rejects_birthday_month_without_day(client):
    response = client.put("/profile/me", headers=AUTH_HEADER, json={"birthday_month": 5})

    assert response.status_code == 400


def test_put_rejects_birthday_day_without_month(client):
    response = client.put("/profile/me", headers=AUTH_HEADER, json={"birthday_day": 20})

    assert response.status_code == 400


def test_put_rejects_a_day_that_does_not_exist_in_any_year(client):
    # February 30th doesn't exist in ANY year — Field(ge=1, le=31) alone
    # can't catch this since 30 is in-range for a day in general; the
    # router's own date(2000, month, day) check is what has to catch it.
    response = client.put(
        "/profile/me", headers=AUTH_HEADER, json={"birthday_month": 2, "birthday_day": 30}
    )

    assert response.status_code == 400


def test_put_accepts_february_29th(client):
    # 2000 (the fixed anchor year the router validates against — see
    # app/profile/router.py) is a leap year, so Feb 29 is accepted even
    # though the real year is never stored at all (see
    # Profile.birthday_month's docstring on why there's no year here).
    response = client.put(
        "/profile/me", headers=AUTH_HEADER, json={"birthday_month": 2, "birthday_day": 29}
    )

    assert response.status_code == 200


def test_put_rejects_birthday_month_out_of_range(client):
    response = client.put(
        "/profile/me", headers=AUTH_HEADER, json={"birthday_month": 13, "birthday_day": 1}
    )

    assert response.status_code == 422  # caught by Pydantic's Field(le=12), not the router


def test_put_rejects_birthday_day_out_of_range(client):
    response = client.put(
        "/profile/me", headers=AUTH_HEADER, json={"birthday_month": 1, "birthday_day": 32}
    )

    assert response.status_code == 422  # caught by Pydantic's Field(le=31), not the router


def test_upload_avatar_sets_a_public_url(client):
    response = client.post(
        "/profile/me/avatar",
        headers=AUTH_HEADER,
        files={"file": ("avatar.jpg", make_test_image_bytes(), "image/jpeg")},
    )

    assert response.status_code == 201
    avatar_url = response.json()["avatar_url"]
    assert avatar_url is not None
    assert avatar_url.startswith("/avatars/")

    # And it sticks — a plain GET sees the same url afterward.
    assert client.get("/profile/me", headers=AUTH_HEADER).json()["avatar_url"] == avatar_url


def test_upload_avatar_replaces_the_previous_one(client):
    first_url = client.post(
        "/profile/me/avatar",
        headers=AUTH_HEADER,
        files={"file": ("a.jpg", make_test_image_bytes(), "image/jpeg")},
    ).json()["avatar_url"]

    second_url = client.post(
        "/profile/me/avatar",
        headers=AUTH_HEADER,
        files={"file": ("b.jpg", make_test_image_bytes(), "image/jpeg")},
    ).json()["avatar_url"]

    assert first_url != second_url
    assert client.get("/profile/me", headers=AUTH_HEADER).json()["avatar_url"] == second_url
