"""
Integration tests for the follow request lifecycle: request, accept,
reject, unfollow.
"""

from tests.helpers import sign_init_data


def _login(client, telegram_id: int, first_name: str = "Test") -> dict:
    """Logs a (fake) user in via /me and returns their own User record,
    including our internal `id` — the id every follow endpoint expects,
    not the telegram_id."""
    init_data = sign_init_data({"id": telegram_id, "first_name": first_name})
    response = client.get("/me", headers={"X-Telegram-Init-Data": init_data})
    return response.json()


def _auth_header(client, telegram_id: int, first_name: str = "Test") -> dict:
    init_data = sign_init_data({"id": telegram_id, "first_name": first_name})
    return {"X-Telegram-Init-Data": init_data}


def test_cannot_follow_yourself(client):
    alice = _login(client, 1, "Alice")

    response = client.post(f"/follow/{alice['id']}", headers=_auth_header(client, 1, "Alice"))

    assert response.status_code == 400


def test_follow_nonexistent_user_returns_404(client):
    _login(client, 1, "Alice")

    response = client.post("/follow/999999", headers=_auth_header(client, 1, "Alice"))

    assert response.status_code == 404


def test_follow_creates_pending_request(client):
    alice = _login(client, 1, "Alice")
    bob = _login(client, 2, "Bob")

    response = client.post(f"/follow/{bob['id']}", headers=_auth_header(client, 1, "Alice"))

    assert response.status_code == 201
    body = response.json()
    assert body["follower_id"] == alice["id"]
    assert body["followee_id"] == bob["id"]
    assert body["status"] == "pending"
    assert body["responded_at"] is None


def test_following_same_user_twice_does_not_duplicate(client):
    _login(client, 1, "Alice")
    bob = _login(client, 2, "Bob")
    auth = _auth_header(client, 1, "Alice")

    first = client.post(f"/follow/{bob['id']}", headers=auth).json()
    second = client.post(f"/follow/{bob['id']}", headers=auth).json()

    assert first["id"] == second["id"]


def test_only_the_followee_can_accept(client):
    alice = _login(client, 1, "Alice")
    bob = _login(client, 2, "Bob")
    _login(client, 3, "Eve")
    client.post(f"/follow/{bob['id']}", headers=_auth_header(client, 1, "Alice"))

    # Eve tries to accept a request that isn't addressed to her.
    response = client.post(
        f"/follow/{alice['id']}/accept", headers=_auth_header(client, 3, "Eve")
    )

    assert response.status_code == 404


def test_followee_can_accept_pending_request(client):
    alice = _login(client, 1, "Alice")
    bob = _login(client, 2, "Bob")
    client.post(f"/follow/{bob['id']}", headers=_auth_header(client, 1, "Alice"))

    response = client.post(
        f"/follow/{alice['id']}/accept", headers=_auth_header(client, 2, "Bob")
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "accepted"
    assert body["responded_at"] is not None


def test_accepting_a_request_that_does_not_exist_returns_404(client):
    _login(client, 1, "Alice")
    _login(client, 2, "Bob")

    response = client.post("/follow/1/accept", headers=_auth_header(client, 2, "Bob"))

    assert response.status_code == 404


def test_followee_can_reject_pending_request(client):
    alice = _login(client, 1, "Alice")
    bob = _login(client, 2, "Bob")
    client.post(f"/follow/{bob['id']}", headers=_auth_header(client, 1, "Alice"))

    reject_response = client.post(
        f"/follow/{alice['id']}/reject", headers=_auth_header(client, 2, "Bob")
    )
    assert reject_response.status_code == 200
    assert reject_response.json()["status"] == "rejected"
    assert reject_response.json()["responded_at"] is not None

    # No longer PENDING — accepting it now should 404.
    accept_response = client.post(
        f"/follow/{alice['id']}/accept", headers=_auth_header(client, 2, "Bob")
    )
    assert accept_response.status_code == 404


def test_requesting_again_after_rejection_resets_to_pending(client):
    alice = _login(client, 1, "Alice")
    bob = _login(client, 2, "Bob")
    auth_alice = _auth_header(client, 1, "Alice")
    client.post(f"/follow/{bob['id']}", headers=auth_alice)
    client.post(f"/follow/{alice['id']}/reject", headers=_auth_header(client, 2, "Bob"))

    # Same (follower, followee) pair — the unique constraint means this
    # has to reset the SAME row, not create a second one.
    retry = client.post(f"/follow/{bob['id']}", headers=auth_alice)

    assert retry.status_code == 201
    body = retry.json()
    assert body["status"] == "pending"
    assert body["responded_at"] is None


def test_unfollow_removes_an_accepted_follow(client):
    alice = _login(client, 1, "Alice")
    bob = _login(client, 2, "Bob")
    auth_alice = _auth_header(client, 1, "Alice")
    client.post(f"/follow/{bob['id']}", headers=auth_alice)
    client.post(f"/follow/{alice['id']}/accept", headers=_auth_header(client, 2, "Bob"))

    response = client.delete(f"/follow/{bob['id']}", headers=auth_alice)

    assert response.status_code == 204
    # Following again afterwards starts a fresh (pending) request.
    refollow = client.post(f"/follow/{bob['id']}", headers=auth_alice).json()
    assert refollow["status"] == "pending"


def test_unfollow_nonexistent_relationship_returns_404(client):
    _login(client, 1, "Alice")
    bob = _login(client, 2, "Bob")

    response = client.delete(f"/follow/{bob['id']}", headers=_auth_header(client, 1, "Alice"))

    assert response.status_code == 404


# --- followers/following lists -------------------------------------------


def test_followers_list_only_includes_accepted_follows(client):
    alice = _login(client, 1, "Alice")
    bob = _login(client, 2, "Bob")
    eve = _login(client, 3, "Eve")
    # Bob follows Alice and gets accepted; Eve follows Alice but stays pending.
    client.post(f"/follow/{alice['id']}", headers=_auth_header(client, 2, "Bob"))
    client.post(f"/follow/{bob['id']}/accept", headers=_auth_header(client, 1, "Alice"))
    client.post(f"/follow/{alice['id']}", headers=_auth_header(client, 3, "Eve"))

    response = client.get(f"/follow/{alice['id']}/followers", headers=_auth_header(client, 1, "Alice"))

    assert response.status_code == 200
    ids = [row["user_id"] for row in response.json()]
    assert ids == [bob["id"]]  # Eve's still-pending request doesn't count
    assert eve  # just to use the variable


def test_following_list_only_includes_accepted_follows(client):
    alice = _login(client, 1, "Alice")
    bob = _login(client, 2, "Bob")
    _login(client, 3, "Eve")
    client.post(f"/follow/{bob['id']}", headers=_auth_header(client, 1, "Alice"))
    client.post(f"/follow/{alice['id']}/accept", headers=_auth_header(client, 2, "Bob"))

    response = client.get(f"/follow/{alice['id']}/following", headers=_auth_header(client, 1, "Alice"))

    assert response.status_code == 200
    body = response.json()
    assert len(body) == 1
    assert body[0]["user_id"] == bob["id"]
    assert body[0]["display_name"] == "Bob"


def test_followers_list_for_nonexistent_user_returns_404(client):
    _login(client, 1, "Alice")

    response = client.get("/follow/999999/followers", headers=_auth_header(client, 1, "Alice"))

    assert response.status_code == 404


def test_public_profile_reports_accepted_follow_counts(client):
    alice = _login(client, 1, "Alice")
    bob = _login(client, 2, "Bob")
    _login(client, 3, "Eve")
    client.post(f"/follow/{alice['id']}", headers=_auth_header(client, 2, "Bob"))
    client.post(f"/follow/{bob['id']}/accept", headers=_auth_header(client, 1, "Alice"))
    # A pending (not yet accepted) follow from Eve shouldn't count.
    client.post(f"/follow/{alice['id']}", headers=_auth_header(client, 3, "Eve"))

    response = client.get(f"/profiles/{alice['id']}", headers=_auth_header(client, 2, "Bob"))

    assert response.json()["followers_count"] == 1
    assert response.json()["following_count"] == 0


# --- incoming follow requests inbox ---------------------------------------


def test_incoming_requests_include_pending_and_history(client):
    alice = _login(client, 1, "Alice")
    bob = _login(client, 2, "Bob")
    carol = _login(client, 3, "Carol")
    auth_alice = _auth_header(client, 1, "Alice")

    # Bob's request to Alice gets accepted; Carol's gets rejected.
    client.post(f"/follow/{alice['id']}", headers=_auth_header(client, 2, "Bob"))
    client.post(f"/follow/{bob['id']}/accept", headers=auth_alice)
    client.post(f"/follow/{alice['id']}", headers=_auth_header(client, 3, "Carol"))
    client.post(f"/follow/{carol['id']}/reject", headers=auth_alice)

    response = client.get("/follow/incoming-requests", headers=auth_alice)

    assert response.status_code == 200
    by_requester = {row["requester"]["user_id"]: row for row in response.json()}
    assert by_requester[bob["id"]]["status"] == "accepted"
    assert by_requester[carol["id"]]["status"] == "rejected"


def test_incoming_requests_flags_whether_i_follow_them_back(client):
    alice = _login(client, 1, "Alice")
    bob = _login(client, 2, "Bob")
    auth_alice = _auth_header(client, 1, "Alice")

    client.post(f"/follow/{alice['id']}", headers=_auth_header(client, 2, "Bob"))
    client.post(f"/follow/{bob['id']}/accept", headers=auth_alice)

    # Before Alice follows Bob back:
    before = client.get("/follow/incoming-requests", headers=auth_alice).json()
    assert before[0]["i_follow_them_back"] is False

    # After Alice follows Bob back:
    client.post(f"/follow/{bob['id']}", headers=auth_alice)
    client.post(f"/follow/{alice['id']}/accept", headers=_auth_header(client, 2, "Bob"))

    after = client.get("/follow/incoming-requests", headers=auth_alice).json()
    assert after[0]["i_follow_them_back"] is True


def test_pending_follow_requests_count_on_me(client):
    alice = _login(client, 1, "Alice")
    auth_alice = _auth_header(client, 1, "Alice")
    bob = _login(client, 2, "Bob")
    _login(client, 3, "Carol")

    assert client.get("/me", headers=auth_alice).json()["pending_follow_requests_count"] == 0

    client.post(f"/follow/{alice['id']}", headers=_auth_header(client, 2, "Bob"))
    client.post(f"/follow/{alice['id']}", headers=_auth_header(client, 3, "Carol"))

    assert client.get("/me", headers=auth_alice).json()["pending_follow_requests_count"] == 2

    # Accepting one drops the count back down.
    client.post(f"/follow/{bob['id']}/accept", headers=auth_alice)
    assert client.get("/me", headers=auth_alice).json()["pending_follow_requests_count"] == 1
