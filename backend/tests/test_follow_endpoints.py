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
    assert reject_response.status_code == 204

    # The request is gone — accepting it now should 404.
    accept_response = client.post(
        f"/follow/{alice['id']}/accept", headers=_auth_header(client, 2, "Bob")
    )
    assert accept_response.status_code == 404


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
