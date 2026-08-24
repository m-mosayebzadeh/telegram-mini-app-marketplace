"""Integration tests for GET /profiles/{user_id} and .../provider-summary."""

from app.core.config import settings
from tests.helpers import give_wallet_balance, make_test_image_bytes, sign_init_data


def _auth_header(telegram_id: int, first_name: str = "Test") -> dict:
    return {"X-Telegram-Init-Data": sign_init_data({"id": telegram_id, "first_name": first_name})}


def _login(client, telegram_id: int, first_name: str = "Test") -> dict:
    return client.get("/me", headers=_auth_header(telegram_id, first_name)).json()


def test_requires_auth(client):
    response = client.get("/profiles/1")

    assert response.status_code == 422


def test_viewing_a_user_with_no_profile_still_works(client):
    _login(client, 1, "Alice")
    bob = _login(client, 2, "Bob")

    response = client.get(f"/profiles/{bob['id']}", headers=_auth_header(1, "Alice"))

    assert response.status_code == 200
    body = response.json()
    assert body["display_name"] == "Bob"
    assert body["avatar_url"] is None
    assert body["bio"] is None
    assert "telegram_id" not in body  # never leak this to another user


def test_viewing_a_user_with_a_profile_includes_bio(client):
    _login(client, 1, "Alice")
    bob_auth = _auth_header(2, "Bob")
    bob = _login(client, 2, "Bob")
    client.put("/profile/me", headers=bob_auth, json={"bio": "Hi there"})

    response = client.get(f"/profiles/{bob['id']}", headers=_auth_header(1, "Alice"))

    assert response.json()["bio"] == "Hi there"


def test_viewing_a_nonexistent_user_returns_404(client):
    _login(client, 1, "Alice")

    response = client.get("/profiles/999999", headers=_auth_header(1, "Alice"))

    assert response.status_code == 404


def test_public_profile_includes_follow_counts(client):
    _login(client, 1, "Alice")
    bob = _login(client, 2, "Bob")

    response = client.get(f"/profiles/{bob['id']}", headers=_auth_header(1, "Alice"))

    assert response.json()["followers_count"] == 0
    assert response.json()["following_count"] == 0


def test_follow_status_reflects_the_viewers_own_relationship(client):
    alice = _login(client, 1, "Alice")
    bob = _login(client, 2, "Bob")
    auth_alice = _auth_header(1, "Alice")

    # Before following: not_following.
    before = client.get(f"/profiles/{bob['id']}", headers=auth_alice).json()
    assert before["follow_status"] == "not_following"

    # After requesting, but before Bob accepts: pending.
    client.post(f"/follow/{bob['id']}", headers=auth_alice)
    pending = client.get(f"/profiles/{bob['id']}", headers=auth_alice).json()
    assert pending["follow_status"] == "pending"

    # After Bob accepts: accepted.
    client.post(f"/follow/{alice['id']}/accept", headers=_auth_header(2, "Bob"))
    accepted = client.get(f"/profiles/{bob['id']}", headers=auth_alice).json()
    assert accepted["follow_status"] == "accepted"


def test_follow_status_on_your_own_profile_is_not_following(client):
    alice = _login(client, 1, "Alice")

    response = client.get(f"/profiles/{alice['id']}", headers=_auth_header(1, "Alice"))

    assert response.json()["follow_status"] == "not_following"


# --- provider summary ------------------------------------------------------


def test_provider_summary_for_a_brand_new_user(client):
    _login(client, 1, "Alice")
    bob = _login(client, 2, "Bob")

    response = client.get(f"/profiles/{bob['id']}/provider-summary", headers=_auth_header(1, "Alice"))

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "new"
    assert body["completed_services_count"] == 0
    # No requests received at all yet -- None, not 0.0 (see
    # ProviderSummaryOut's docstring for why that distinction matters).
    assert body["response_rate"] is None
    assert body["rejection_rate"] is None
    assert body["disputed_transactions_count"] == 0


def test_provider_summary_for_a_nonexistent_user_returns_404(client):
    _login(client, 1, "Alice")

    response = client.get("/profiles/999999/provider-summary", headers=_auth_header(1, "Alice"))

    assert response.status_code == 404


def test_provider_summary_tracks_response_and_rejection_rate(client):
    alice = _login(client, 1, "Alice")  # provider
    bob = _login(client, 2, "Bob")  # buyer, gets rejected
    _login(client, 3, "Carol")  # buyer, request stays pending

    auth_alice = _auth_header(1, "Alice")
    offer = client.post(
        "/offers",
        headers=auth_alice,
        json={"price_stars": 10, "display_duration_minutes": 30, "title": "Chat with me", "description": "Chat"},
    ).json()

    bob_request = client.post(
        "/requests", headers=_auth_header(2, "Bob"), json={"offer_id": offer["id"]}
    ).json()
    client.post("/requests", headers=_auth_header(3, "Carol"), json={"offer_id": offer["id"]})
    client.post(
        f"/requests/{bob_request['id']}/reject",
        headers=auth_alice,
        json={"reason": "Not a good fit"},
    )

    response = client.get(f"/profiles/{alice['id']}/provider-summary", headers=auth_alice)

    body = response.json()
    # 2 total requests received (Bob + Carol), 1 responded to (Bob,
    # rejected), 1 still pending (Carol).
    assert body["response_rate"] == 0.5
    assert body["rejection_rate"] == 0.5


def test_provider_summary_counts_completed_services(client, db_session):
    alice = _login(client, 1, "Alice")  # provider
    bob = _login(client, 2, "Bob")  # buyer
    auth_alice = _auth_header(1, "Alice")
    auth_bob = _auth_header(2, "Bob")

    # A paid photo purchase settles instantly (see app/wallet/service.py),
    # so it's the simplest way to get one real SUCCEEDED transaction
    # without walking through the full accept -> pay -> close-session flow.
    client.put("/profile/me", headers=auth_alice, json={"bio": "hi"})
    photo = client.post(
        "/photos",
        headers=auth_alice,
        files={"file": ("test.jpg", make_test_image_bytes(), "image/jpeg")},
        data={"is_paid": "true", "price_stars": "10", "audience_type": "public"},
    ).json()
    give_wallet_balance(db_session, bob["id"], amount_toman=10 * settings.star_to_toman_rate)
    client.post(f"/photos/{photo['id']}/purchase", headers=auth_bob)

    response = client.get(f"/profiles/{alice['id']}/provider-summary", headers=auth_bob)

    body = response.json()
    assert body["status"] == "established"
    assert body["completed_services_count"] == 1


# --- buyer summary ----------------------------------------------------------


def test_buyer_summary_for_a_brand_new_user(client):
    _login(client, 1, "Alice")
    bob = _login(client, 2, "Bob")

    response = client.get(f"/profiles/{bob['id']}/buyer-summary", headers=_auth_header(1, "Alice"))

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "new"
    assert body["completed_transactions_count"] == 0
    assert body["total_stars_spent"] == 0


def test_buyer_summary_for_a_nonexistent_user_returns_404(client):
    _login(client, 1, "Alice")

    response = client.get("/profiles/999999/buyer-summary", headers=_auth_header(1, "Alice"))

    assert response.status_code == 404


def test_buyer_summary_counts_pending_and_succeeded_spend(client, db_session):
    alice = _login(client, 1, "Alice")  # provider
    bob = _login(client, 2, "Bob")  # buyer
    auth_alice = _auth_header(1, "Alice")
    auth_bob = _auth_header(2, "Bob")

    # A paid photo purchase settles instantly -> SUCCEEDED, counts
    # toward completed_transactions_count.
    client.put("/profile/me", headers=auth_alice, json={"bio": "hi"})
    photo = client.post(
        "/photos",
        headers=auth_alice,
        files={"file": ("test.jpg", make_test_image_bytes(), "image/jpeg")},
        data={"is_paid": "true", "price_stars": "10", "audience_type": "public"},
    ).json()
    give_wallet_balance(db_session, bob["id"], amount_toman=200 * settings.star_to_toman_rate)
    client.post(f"/photos/{photo['id']}/purchase", headers=auth_bob)

    # A paid chat request stays PENDING (idle money) -- still counts as
    # "spent" (the buyer was already charged), but not yet "completed".
    offer = client.post(
        "/offers",
        headers=auth_alice,
        json={"price_stars": 20, "display_duration_minutes": 30, "title": "Chat", "description": "Chat"},
    ).json()
    req = client.post("/requests", headers=auth_bob, json={"offer_id": offer["id"]}).json()
    client.post(f"/requests/{req['id']}/accept", headers=auth_alice)
    client.post(f"/requests/{req['id']}/pay", headers=auth_bob)

    response = client.get(f"/profiles/{bob['id']}/buyer-summary", headers=auth_alice)

    body = response.json()
    assert body["status"] == "established"  # the photo purchase completed
    assert body["completed_transactions_count"] == 1  # only the photo, not the still-pending chat
    assert body["total_stars_spent"] == 30  # 10 (photo) + 20 (chat), pending or not
