"""
Integration tests for the content endpoints: upload, list (audience
filtering), file access (plain vs. spoiler reveal), purchase, pin, like,
delete.
"""

from app.core.config import settings
from app.models.content import MAX_UPLOAD_SIZE_BYTES
from tests.helpers import give_wallet_balance, make_test_image_bytes, sign_init_data


def _auth_header(telegram_id: int, first_name: str = "Test") -> dict:
    return {"X-Telegram-Init-Data": sign_init_data({"id": telegram_id, "first_name": first_name})}


def _login(client, telegram_id: int, first_name: str = "Test") -> dict:
    return client.get("/me", headers=_auth_header(telegram_id, first_name)).json()


def _upload(
    client,
    auth: dict,
    *,
    content_type: str = "photo",
    duration_seconds: int | None = None,
    is_paid: bool = False,
    price_stars: int | None = None,
    has_spoiler: bool = False,
    audience_type: str = "public",
    audience_user_id: int | None = None,
    audience_group_id: int | None = None,
    file_bytes: bytes | None = None,
):
    data = {
        "content_type": content_type,
        "is_paid": "true" if is_paid else "false",
        "has_spoiler": "true" if has_spoiler else "false",
        "audience_type": audience_type,
    }
    if duration_seconds is not None:
        data["duration_seconds"] = str(duration_seconds)
    if price_stars is not None:
        data["price_stars"] = str(price_stars)
    if audience_user_id is not None:
        data["audience_user_id"] = str(audience_user_id)
    if audience_group_id is not None:
        data["audience_group_id"] = str(audience_group_id)

    return client.post(
        "/content",
        headers=auth,
        files={"file": ("test.jpg", file_bytes or make_test_image_bytes(), "image/jpeg")},
        data=data,
    )


# --- upload validation -------------------------------------------------


def test_upload_does_not_require_a_profile_first(client):
    # Content connects directly to User, not Profile — a bare login is
    # enough to upload.
    auth = _auth_header(1, "Alice")
    _login(client, 1, "Alice")

    response = _upload(client, auth)

    assert response.status_code == 201


def test_upload_free_photo_without_spoiler(client):
    auth = _auth_header(1, "Alice")
    _login(client, 1, "Alice")

    response = _upload(client, auth)

    assert response.status_code == 201
    body = response.json()
    assert body["content_type"] == "photo"
    assert body["duration_seconds"] is None
    assert body["has_spoiler"] is False
    assert body["is_paid"] is False
    assert body["can_see_original"] is True
    assert body["like_count"] == 0
    assert body["liked_by_me"] is False


def test_paid_upload_forces_spoiler_even_if_client_says_false(client):
    auth = _auth_header(1, "Alice")
    _login(client, 1, "Alice")

    response = _upload(client, auth, is_paid=True, price_stars=50, has_spoiler=False)

    assert response.status_code == 201
    assert response.json()["has_spoiler"] is True


def test_paid_upload_without_price_fails(client):
    auth = _auth_header(1, "Alice")
    _login(client, 1, "Alice")

    response = _upload(client, auth, is_paid=True, price_stars=None)

    assert response.status_code == 400


def test_user_audience_without_target_fails(client):
    auth = _auth_header(1, "Alice")
    _login(client, 1, "Alice")

    response = _upload(client, auth, audience_type="user")

    assert response.status_code == 400


def test_group_audience_not_owned_by_uploader_fails(client):
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    _login(client, 1, "Alice")
    _login(client, 2, "Bob")
    bobs_group = client.post("/audience-groups", headers=auth_b, json={"name": "X"}).json()

    response = _upload(client, auth_a, audience_type="group", audience_group_id=bobs_group["id"])

    assert response.status_code == 404


# --- content_type / duration_seconds validation (new for Content) --------


def test_short_video_without_duration_fails(client):
    auth = _auth_header(1, "Alice")
    _login(client, 1, "Alice")

    response = _upload(client, auth, content_type="short_video", duration_seconds=None)

    assert response.status_code == 400


def test_short_video_over_the_limit_fails(client):
    auth = _auth_header(1, "Alice")
    _login(client, 1, "Alice")

    response = _upload(client, auth, content_type="short_video", duration_seconds=61)

    assert response.status_code == 400


def test_short_video_with_valid_duration_succeeds(client):
    auth = _auth_header(1, "Alice")
    _login(client, 1, "Alice")

    response = _upload(client, auth, content_type="short_video", duration_seconds=45)

    assert response.status_code == 201
    body = response.json()
    assert body["content_type"] == "short_video"
    assert body["duration_seconds"] == 45


def test_upload_over_the_size_limit_fails(client):
    auth = _auth_header(1, "Alice")
    _login(client, 1, "Alice")

    oversized = b"0" * (MAX_UPLOAD_SIZE_BYTES + 1)
    response = _upload(client, auth, file_bytes=oversized)

    assert response.status_code == 400


# --- file access: plain vs. spoiler reveal -------------------------------


def test_content_without_spoiler_is_directly_accessible(client):
    auth = _auth_header(1, "Alice")
    _login(client, 1, "Alice")
    content = _upload(client, auth, has_spoiler=False).json()

    response = client.get(f"/content/{content['id']}/file", headers=auth)

    assert response.status_code == 200
    assert len(response.content) > 0


def test_free_spoiler_content_reveals_via_file_endpoint(client):
    auth = _auth_header(1, "Alice")
    _login(client, 1, "Alice")
    content = _upload(client, auth, has_spoiler=True).json()

    response = client.get(f"/content/{content['id']}/file", headers=auth)

    assert response.status_code == 200  # free spoiler always reveals, no purchase needed


def test_paid_content_without_purchase_returns_402(client):
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    _login(client, 1, "Alice")
    _login(client, 2, "Bob")
    content = _upload(client, auth_a, is_paid=True, price_stars=50).json()

    response = client.get(f"/content/{content['id']}/file", headers=auth_b)

    assert response.status_code == 402
    assert response.json()["detail"]["price_stars"] == 50


def test_paid_content_purchase_without_enough_balance_returns_402(client):
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    _login(client, 1, "Alice")
    _login(client, 2, "Bob")
    content = _upload(client, auth_a, is_paid=True, price_stars=50).json()

    # Bob has no wallet balance at all yet.
    response = client.post(f"/content/{content['id']}/purchase", headers=auth_b)

    assert response.status_code == 402
    assert response.json()["detail"]["reason"] == "insufficient_balance"


def test_paid_content_after_purchase_reveals_file(client, db_session):
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    _login(client, 1, "Alice")
    bob = _login(client, 2, "Bob")
    content = _upload(client, auth_a, is_paid=True, price_stars=50).json()
    give_wallet_balance(db_session, bob["id"], amount_toman=50 * settings.star_to_toman_rate)

    purchase = client.post(f"/content/{content['id']}/purchase", headers=auth_b)
    assert purchase.status_code == 201
    assert purchase.json()["unlocked"] is True

    response = client.get(f"/content/{content['id']}/file", headers=auth_b)
    assert response.status_code == 200

    # And GET /content/{id} now reports can_see_original for Bob.
    meta = client.get(f"/content/{content['id']}", headers=auth_b).json()
    assert meta["can_see_original"] is True

    # Buying the same item again doesn't charge Bob a second time — his
    # balance should be exactly what's left after the ONE purchase.
    second_purchase = client.post(f"/content/{content['id']}/purchase", headers=auth_b)
    assert second_purchase.status_code == 201
    remaining = client.get("/wallet/balance", headers=auth_b).json()["balance_toman"]
    assert remaining == 0  # paid exactly 50 stars' worth, once


def test_owner_cannot_purchase_own_paid_content(client):
    auth = _auth_header(1, "Alice")
    _login(client, 1, "Alice")
    content = _upload(client, auth, is_paid=True, price_stars=50).json()

    response = client.post(f"/content/{content['id']}/purchase", headers=auth)

    assert response.status_code == 400


def test_cannot_purchase_free_content(client):
    auth = _auth_header(1, "Alice")
    _login(client, 1, "Alice")
    content = _upload(client, auth, is_paid=False).json()

    response = client.post(f"/content/{content['id']}/purchase", headers=auth)

    assert response.status_code == 400


# --- audience-based visibility ------------------------------------------


def test_public_content_is_visible_to_everyone(client):
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    alice = _login(client, 1, "Alice")
    _login(client, 2, "Bob")
    _upload(client, auth_a, audience_type="public")

    listing = client.get("/content", headers=auth_b, params={"user_id": alice["id"]}).json()
    assert len(listing) == 1


def test_user_targeted_content_is_invisible_to_everyone_else(client):
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    auth_c = _auth_header(3, "Carol")
    alice = _login(client, 1, "Alice")
    bob = _login(client, 2, "Bob")
    _login(client, 3, "Carol")
    content = _upload(client, auth_a, audience_type="user", audience_user_id=bob["id"]).json()

    # Carol: not in the audience — doesn't even see it in the list, and a
    # direct request 404s, not 403.
    carol_list = client.get("/content", headers=auth_c, params={"user_id": alice["id"]}).json()
    assert carol_list == []
    carol_direct = client.get(f"/content/{content['id']}", headers=auth_c)
    assert carol_direct.status_code == 404

    # Bob: the actual target — sees it fine.
    bob_list = client.get("/content", headers=auth_b, params={"user_id": alice["id"]}).json()
    assert len(bob_list) == 1

    # Alice: the owner — always sees her own content.
    alice_list = client.get("/content", headers=auth_a, params={"user_id": alice["id"]}).json()
    assert len(alice_list) == 1


def test_group_targeted_content_only_visible_to_members(client):
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    auth_c = _auth_header(3, "Carol")
    alice = _login(client, 1, "Alice")
    bob = _login(client, 2, "Bob")
    _login(client, 3, "Carol")
    group = client.post("/audience-groups", headers=auth_a, json={"name": "Friends"}).json()
    client.post(f"/audience-groups/{group['id']}/members/{bob['id']}", headers=auth_a)
    _upload(client, auth_a, audience_type="group", audience_group_id=group["id"])

    assert client.get("/content", headers=auth_c, params={"user_id": alice["id"]}).json() == []
    assert len(client.get("/content", headers=auth_b, params={"user_id": alice["id"]}).json()) == 1


def test_followers_only_content_requires_accepted_follow(client):
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    alice = _login(client, 1, "Alice")
    bob = _login(client, 2, "Bob")
    _upload(client, auth_a, audience_type="followers")

    # Bob isn't following Alice yet.
    assert client.get("/content", headers=auth_b, params={"user_id": alice["id"]}).json() == []

    client.post(f"/follow/{alice['id']}", headers=auth_b)
    client.post(f"/follow/{bob['id']}/accept", headers=auth_a)

    assert len(client.get("/content", headers=auth_b, params={"user_id": alice["id"]}).json()) == 1


# --- pin/unpin (new for Content) ------------------------------------------


def test_owner_can_pin_and_unpin_content(client):
    auth = _auth_header(1, "Alice")
    _login(client, 1, "Alice")
    content = _upload(client, auth).json()

    pinned = client.post(f"/content/{content['id']}/pin", headers=auth)
    assert pinned.status_code == 200
    assert pinned.json()["is_pinned"] is True

    unpinned = client.post(f"/content/{content['id']}/unpin", headers=auth)
    assert unpinned.status_code == 200
    assert unpinned.json()["is_pinned"] is False


def test_pin_is_capped_at_the_per_user_maximum(client):
    auth = _auth_header(1, "Alice")
    _login(client, 1, "Alice")
    items = [_upload(client, auth).json() for _ in range(4)]

    for item in items[:3]:
        response = client.post(f"/content/{item['id']}/pin", headers=auth)
        assert response.status_code == 200

    fourth = client.post(f"/content/{items[3]['id']}/pin", headers=auth)
    assert fourth.status_code == 400


def test_non_owner_cannot_pin_content(client):
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    _login(client, 1, "Alice")
    _login(client, 2, "Bob")
    content = _upload(client, auth_a).json()

    response = client.post(f"/content/{content['id']}/pin", headers=auth_b)

    assert response.status_code == 404


def test_pinned_content_sorts_first_in_the_listing(client):
    auth = _auth_header(1, "Alice")
    alice = _login(client, 1, "Alice")
    _upload(client, auth)  # not pinned
    to_pin = _upload(client, auth).json()
    client.post(f"/content/{to_pin['id']}/pin", headers=auth)

    listing = client.get("/content", headers=auth, params={"user_id": alice["id"]}).json()

    assert listing[0]["id"] == to_pin["id"]
    assert listing[0]["is_pinned"] is True


# --- like/unlike (new for Content) -----------------------------------------


def test_like_and_unlike_a_content_item(client):
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    _login(client, 1, "Alice")
    _login(client, 2, "Bob")
    content = _upload(client, auth_a).json()

    liked = client.post(f"/content/{content['id']}/like", headers=auth_b)
    assert liked.status_code == 201
    assert liked.json()["like_count"] == 1
    assert liked.json()["liked_by_me"] is True

    unliked = client.delete(f"/content/{content['id']}/like", headers=auth_b)
    assert unliked.status_code == 200
    assert unliked.json()["like_count"] == 0
    assert unliked.json()["liked_by_me"] is False


def test_liking_twice_does_not_double_count(client):
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    _login(client, 1, "Alice")
    _login(client, 2, "Bob")
    content = _upload(client, auth_a).json()

    client.post(f"/content/{content['id']}/like", headers=auth_b)
    second = client.post(f"/content/{content['id']}/like", headers=auth_b)

    assert second.status_code == 201
    assert second.json()["like_count"] == 1


def test_cannot_like_content_outside_its_audience(client):
    auth_a = _auth_header(1, "Alice")
    auth_c = _auth_header(3, "Carol")
    _login(client, 1, "Alice")
    bob = _login(client, 2, "Bob")
    _login(client, 3, "Carol")
    content = _upload(client, auth_a, audience_type="user", audience_user_id=bob["id"]).json()

    response = client.post(f"/content/{content['id']}/like", headers=auth_c)

    assert response.status_code == 404


# --- delete ---------------------------------------------------------------


def test_owner_can_delete_content(client):
    auth = _auth_header(1, "Alice")
    _login(client, 1, "Alice")
    content = _upload(client, auth).json()

    response = client.delete(f"/content/{content['id']}", headers=auth)
    assert response.status_code == 204

    assert client.get(f"/content/{content['id']}", headers=auth).status_code == 404


def test_non_owner_cannot_delete_content(client):
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    _login(client, 1, "Alice")
    _login(client, 2, "Bob")
    content = _upload(client, auth_a).json()

    response = client.delete(f"/content/{content['id']}", headers=auth_b)

    assert response.status_code == 404
