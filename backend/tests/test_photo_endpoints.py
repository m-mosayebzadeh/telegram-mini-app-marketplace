"""
Integration tests for the photo endpoints: upload, list (audience
filtering), default view vs. reveal, purchase (stub), delete.
"""

from tests.helpers import make_test_image_bytes, sign_init_data


def _auth_header(telegram_id: int, first_name: str = "Test") -> dict:
    return {"X-Telegram-Init-Data": sign_init_data({"id": telegram_id, "first_name": first_name})}


def _login(client, telegram_id: int, first_name: str = "Test") -> dict:
    return client.get("/me", headers=_auth_header(telegram_id, first_name)).json()


def _create_profile(client, auth: dict) -> None:
    client.put("/profile/me", headers=auth, json={"bio": "hi"})


def _upload(
    client,
    auth: dict,
    *,
    is_paid: bool = False,
    price_stars: int | None = None,
    is_blurred: bool = False,
    audience_type: str = "public",
    audience_user_id: int | None = None,
    audience_group_id: int | None = None,
):
    data = {
        "is_paid": "true" if is_paid else "false",
        "is_blurred": "true" if is_blurred else "false",
        "audience_type": audience_type,
    }
    if price_stars is not None:
        data["price_stars"] = str(price_stars)
    if audience_user_id is not None:
        data["audience_user_id"] = str(audience_user_id)
    if audience_group_id is not None:
        data["audience_group_id"] = str(audience_group_id)

    return client.post(
        "/photos",
        headers=auth,
        files={"file": ("test.jpg", make_test_image_bytes(), "image/jpeg")},
        data=data,
    )


# --- upload validation -------------------------------------------------


def test_upload_requires_a_profile_first(client):
    auth = _auth_header(1, "Alice")
    _login(client, 1, "Alice")

    response = _upload(client, auth)

    assert response.status_code == 400


def test_upload_free_unblurred_photo(client):
    auth = _auth_header(1, "Alice")
    _login(client, 1, "Alice")
    _create_profile(client, auth)

    response = _upload(client, auth)

    assert response.status_code == 201
    body = response.json()
    assert body["is_blurred"] is False
    assert body["is_paid"] is False
    assert body["can_see_original"] is True


def test_paid_upload_forces_blurred_even_if_client_says_false(client):
    auth = _auth_header(1, "Alice")
    _login(client, 1, "Alice")
    _create_profile(client, auth)

    response = _upload(client, auth, is_paid=True, price_stars=50, is_blurred=False)

    assert response.status_code == 201
    assert response.json()["is_blurred"] is True


def test_paid_upload_without_price_fails(client):
    auth = _auth_header(1, "Alice")
    _login(client, 1, "Alice")
    _create_profile(client, auth)

    response = _upload(client, auth, is_paid=True, price_stars=None)

    assert response.status_code == 400


def test_user_audience_without_target_fails(client):
    auth = _auth_header(1, "Alice")
    _login(client, 1, "Alice")
    _create_profile(client, auth)

    response = _upload(client, auth, audience_type="user")

    assert response.status_code == 400


def test_group_audience_not_owned_by_uploader_fails(client):
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    _login(client, 1, "Alice")
    _login(client, 2, "Bob")
    _create_profile(client, auth_a)
    bobs_group = client.post("/audience-groups", headers=auth_b, json={"name": "X"}).json()

    response = _upload(client, auth_a, audience_type="group", audience_group_id=bobs_group["id"])

    assert response.status_code == 404


# --- default view vs. reveal -------------------------------------------


def test_unblurred_photo_image_and_original_are_identical(client):
    auth = _auth_header(1, "Alice")
    _login(client, 1, "Alice")
    _create_profile(client, auth)
    photo = _upload(client, auth, is_blurred=False).json()

    image = client.get(f"/photos/{photo['id']}/image", headers=auth)
    original = client.get(f"/photos/{photo['id']}/original", headers=auth)

    assert image.status_code == original.status_code == 200
    assert image.content == original.content


def test_free_blurred_photo_default_view_differs_from_original(client):
    auth = _auth_header(1, "Alice")
    _login(client, 1, "Alice")
    _create_profile(client, auth)
    photo = _upload(client, auth, is_blurred=True).json()

    image = client.get(f"/photos/{photo['id']}/image", headers=auth)
    original = client.get(f"/photos/{photo['id']}/original", headers=auth)

    assert image.status_code == original.status_code == 200
    assert image.content != original.content  # one is actually blurred


def test_paid_photo_without_purchase_returns_402(client):
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    _login(client, 1, "Alice")
    _login(client, 2, "Bob")
    _create_profile(client, auth_a)
    photo = _upload(client, auth_a, is_paid=True, price_stars=50).json()

    response = client.get(f"/photos/{photo['id']}/original", headers=auth_b)

    assert response.status_code == 402
    assert response.json()["detail"]["price_stars"] == 50


def test_paid_photo_after_purchase_reveals_original(client):
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    _login(client, 1, "Alice")
    _login(client, 2, "Bob")
    _create_profile(client, auth_a)
    photo = _upload(client, auth_a, is_paid=True, price_stars=50).json()

    purchase = client.post(f"/photos/{photo['id']}/purchase", headers=auth_b)
    assert purchase.status_code == 201
    assert purchase.json()["unlocked"] is True

    response = client.get(f"/photos/{photo['id']}/original", headers=auth_b)
    assert response.status_code == 200

    # And GET /photos/{id} now reports can_see_original for Bob.
    meta = client.get(f"/photos/{photo['id']}", headers=auth_b).json()
    assert meta["can_see_original"] is True


def test_cannot_purchase_a_free_photo(client):
    auth = _auth_header(1, "Alice")
    _login(client, 1, "Alice")
    _create_profile(client, auth)
    photo = _upload(client, auth, is_paid=False).json()

    response = client.post(f"/photos/{photo['id']}/purchase", headers=auth)

    assert response.status_code == 400


# --- audience-based visibility ------------------------------------------


def test_public_photo_is_visible_to_everyone(client):
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    _login(client, 1, "Alice")
    bob = _login(client, 2, "Bob")
    _create_profile(client, auth_a)
    _upload(client, auth_a, audience_type="public")

    listing = client.get("/photos", headers=auth_b, params={"profile_id": 1}).json()
    assert len(listing) == 1
    assert bob  # just to use the variable


def test_user_targeted_photo_is_invisible_to_everyone_else(client):
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    auth_c = _auth_header(3, "Carol")
    _login(client, 1, "Alice")
    bob = _login(client, 2, "Bob")
    _login(client, 3, "Carol")
    _create_profile(client, auth_a)
    photo = _upload(client, auth_a, audience_type="user", audience_user_id=bob["id"]).json()

    # Carol: not in the audience — doesn't even see it in the list, and
    # a direct request 404s, not 403.
    carol_list = client.get("/photos", headers=auth_c, params={"profile_id": 1}).json()
    assert carol_list == []
    carol_direct = client.get(f"/photos/{photo['id']}", headers=auth_c)
    assert carol_direct.status_code == 404

    # Bob: the actual target — sees it fine.
    bob_list = client.get("/photos", headers=auth_b, params={"profile_id": 1}).json()
    assert len(bob_list) == 1

    # Alice: the owner — always sees her own photo.
    alice_list = client.get("/photos", headers=auth_a, params={"profile_id": 1}).json()
    assert len(alice_list) == 1


def test_group_targeted_photo_only_visible_to_members(client):
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    auth_c = _auth_header(3, "Carol")
    _login(client, 1, "Alice")
    bob = _login(client, 2, "Bob")
    _login(client, 3, "Carol")
    _create_profile(client, auth_a)
    group = client.post("/audience-groups", headers=auth_a, json={"name": "Friends"}).json()
    client.post(f"/audience-groups/{group['id']}/members/{bob['id']}", headers=auth_a)
    _upload(client, auth_a, audience_type="group", audience_group_id=group["id"])

    assert client.get("/photos", headers=auth_c, params={"profile_id": 1}).json() == []
    assert len(client.get("/photos", headers=auth_b, params={"profile_id": 1}).json()) == 1


def test_followers_only_photo_requires_accepted_follow(client):
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    alice = _login(client, 1, "Alice")
    bob = _login(client, 2, "Bob")
    _create_profile(client, auth_a)
    _upload(client, auth_a, audience_type="followers")

    # Bob isn't following Alice yet.
    assert client.get("/photos", headers=auth_b, params={"profile_id": 1}).json() == []

    client.post(f"/follow/{alice['id']}", headers=auth_b)
    client.post(f"/follow/{bob['id']}/accept", headers=auth_a)

    assert len(client.get("/photos", headers=auth_b, params={"profile_id": 1}).json()) == 1


# --- delete ---------------------------------------------------------------


def test_owner_can_delete_a_photo(client):
    auth = _auth_header(1, "Alice")
    _login(client, 1, "Alice")
    _create_profile(client, auth)
    photo = _upload(client, auth).json()

    response = client.delete(f"/photos/{photo['id']}", headers=auth)
    assert response.status_code == 204

    assert client.get(f"/photos/{photo['id']}", headers=auth).status_code == 404


def test_non_owner_cannot_delete_a_photo(client):
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    _login(client, 1, "Alice")
    _login(client, 2, "Bob")
    _create_profile(client, auth_a)
    photo = _upload(client, auth_a).json()

    response = client.delete(f"/photos/{photo['id']}", headers=auth_b)

    assert response.status_code == 404
