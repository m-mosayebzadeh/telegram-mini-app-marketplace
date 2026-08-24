"""
Integration tests for GET/PUT /profile/me.
"""

from tests.helpers import sign_init_data

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
        json={"avatar_url": "https://example.com/a.jpg", "bio": "Hello there"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["avatar_url"] == "https://example.com/a.jpg"
    assert body["bio"] == "Hello there"


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
