"""Integration tests for GET /profiles/{user_id}."""

from tests.helpers import sign_init_data


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
