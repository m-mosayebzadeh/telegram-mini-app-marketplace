"""
Integration tests for audience group create/list/get/delete and
member add/remove.
"""

from tests.helpers import sign_init_data


def _login(client, telegram_id: int, first_name: str = "Test") -> dict:
    init_data = sign_init_data({"id": telegram_id, "first_name": first_name})
    return client.get("/me", headers={"X-Telegram-Init-Data": init_data}).json()


def _auth_header(telegram_id: int, first_name: str = "Test") -> dict:
    return {"X-Telegram-Init-Data": sign_init_data({"id": telegram_id, "first_name": first_name})}


def test_create_group_starts_with_no_members(client):
    auth = _auth_header(1, "Alice")
    _login(client, 1, "Alice")

    response = client.post("/audience-groups", headers=auth, json={"name": "Friends"})

    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "Friends"
    assert body["members"] == []


def test_list_only_returns_my_own_groups(client):
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    _login(client, 1, "Alice")
    _login(client, 2, "Bob")
    client.post("/audience-groups", headers=auth_a, json={"name": "Friends"})
    client.post("/audience-groups", headers=auth_b, json={"name": "Coworkers"})

    response = client.get("/audience-groups", headers=auth_a)

    names = [g["name"] for g in response.json()]
    assert names == ["Friends"]


def test_getting_someone_elses_group_returns_404(client):
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    _login(client, 1, "Alice")
    _login(client, 2, "Bob")
    group = client.post("/audience-groups", headers=auth_a, json={"name": "Friends"}).json()

    response = client.get(f"/audience-groups/{group['id']}", headers=auth_b)

    assert response.status_code == 404


def test_add_member_to_group(client):
    alice_auth = _auth_header(1, "Alice")
    _login(client, 1, "Alice")
    bob = _login(client, 2, "Bob")
    group = client.post("/audience-groups", headers=alice_auth, json={"name": "Friends"}).json()

    response = client.post(
        f"/audience-groups/{group['id']}/members/{bob['id']}", headers=alice_auth
    )

    assert response.status_code == 201
    member_ids = [m["user_id"] for m in response.json()["members"]]
    assert member_ids == [bob["id"]]


def test_adding_the_same_member_twice_does_not_duplicate(client):
    alice_auth = _auth_header(1, "Alice")
    _login(client, 1, "Alice")
    bob = _login(client, 2, "Bob")
    group = client.post("/audience-groups", headers=alice_auth, json={"name": "Friends"}).json()

    client.post(f"/audience-groups/{group['id']}/members/{bob['id']}", headers=alice_auth)
    response = client.post(
        f"/audience-groups/{group['id']}/members/{bob['id']}", headers=alice_auth
    )

    assert len(response.json()["members"]) == 1


def test_adding_a_nonexistent_user_returns_404(client):
    alice_auth = _auth_header(1, "Alice")
    _login(client, 1, "Alice")
    group = client.post("/audience-groups", headers=alice_auth, json={"name": "Friends"}).json()

    response = client.post(f"/audience-groups/{group['id']}/members/999999", headers=alice_auth)

    assert response.status_code == 404


def test_cannot_add_members_to_someone_elses_group(client):
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    _login(client, 1, "Alice")
    bob = _login(client, 2, "Bob")
    group = client.post("/audience-groups", headers=auth_a, json={"name": "Friends"}).json()

    # Bob tries to add himself to Alice's group.
    response = client.post(
        f"/audience-groups/{group['id']}/members/{bob['id']}", headers=auth_b
    )

    assert response.status_code == 404


def test_remove_member(client):
    alice_auth = _auth_header(1, "Alice")
    _login(client, 1, "Alice")
    bob = _login(client, 2, "Bob")
    group = client.post("/audience-groups", headers=alice_auth, json={"name": "Friends"}).json()
    client.post(f"/audience-groups/{group['id']}/members/{bob['id']}", headers=alice_auth)

    response = client.delete(
        f"/audience-groups/{group['id']}/members/{bob['id']}", headers=alice_auth
    )
    assert response.status_code == 204

    updated = client.get(f"/audience-groups/{group['id']}", headers=alice_auth).json()
    assert updated["members"] == []


def test_removing_a_non_member_returns_404(client):
    alice_auth = _auth_header(1, "Alice")
    _login(client, 1, "Alice")
    bob = _login(client, 2, "Bob")
    group = client.post("/audience-groups", headers=alice_auth, json={"name": "Friends"}).json()

    response = client.delete(
        f"/audience-groups/{group['id']}/members/{bob['id']}", headers=alice_auth
    )

    assert response.status_code == 404


def test_delete_group_removes_it(client):
    alice_auth = _auth_header(1, "Alice")
    _login(client, 1, "Alice")
    bob = _login(client, 2, "Bob")
    group = client.post("/audience-groups", headers=alice_auth, json={"name": "Friends"}).json()
    client.post(f"/audience-groups/{group['id']}/members/{bob['id']}", headers=alice_auth)

    delete_response = client.delete(f"/audience-groups/{group['id']}", headers=alice_auth)
    assert delete_response.status_code == 204

    get_response = client.get(f"/audience-groups/{group['id']}", headers=alice_auth)
    assert get_response.status_code == 404
