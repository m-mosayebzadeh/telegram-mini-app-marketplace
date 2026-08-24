"""Integration tests for the request endpoints."""

from tests.helpers import sign_init_data


def _auth_header(telegram_id: int, first_name: str = "Test") -> dict:
    return {"X-Telegram-Init-Data": sign_init_data({"id": telegram_id, "first_name": first_name})}


def _login(client, telegram_id: int, first_name: str = "Test") -> dict:
    return client.get("/me", headers=_auth_header(telegram_id, first_name)).json()


def _create_offer(client, auth: dict, **overrides):
    payload = {
        "price_stars": 10,
        "display_duration_minutes": 30,
        "description": "A nice chat",
    }
    payload.update(overrides)
    return client.post("/offers", headers=auth, json=payload).json()


# --- creating a request ---------------------------------------------------


def test_create_request(client):
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    _login(client, 1, "Alice")
    _login(client, 2, "Bob")
    offer = _create_offer(client, auth_a)

    response = client.post("/requests", headers=auth_b, json={"offer_id": offer["id"]})

    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "pending"
    assert body["offer_id"] == offer["id"]


def test_cannot_request_your_own_offer(client):
    auth = _auth_header(1, "Alice")
    _login(client, 1, "Alice")
    offer = _create_offer(client, auth)

    response = client.post("/requests", headers=auth, json={"offer_id": offer["id"]})

    assert response.status_code == 400


def test_cannot_request_an_inactive_offer(client):
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    _login(client, 1, "Alice")
    _login(client, 2, "Bob")
    offer = _create_offer(client, auth_a)
    client.post(f"/offers/{offer['id']}/deactivate", headers=auth_a)

    response = client.post("/requests", headers=auth_b, json={"offer_id": offer["id"]})

    assert response.status_code == 404


def test_requesting_the_same_offer_twice_does_not_duplicate(client):
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    _login(client, 1, "Alice")
    _login(client, 2, "Bob")
    offer = _create_offer(client, auth_a)

    first = client.post("/requests", headers=auth_b, json={"offer_id": offer["id"]}).json()
    second = client.post("/requests", headers=auth_b, json={"offer_id": offer["id"]}).json()

    assert first["id"] == second["id"]


def test_cannot_request_a_second_offer_from_a_provider_while_one_is_already_live(client):
    """
    A buyer only gets one live (pending/accepted) request per PROVIDER
    at a time — across every offer that provider has, not just the one
    they already requested. Different from the idempotent same-offer
    case above: this is a genuinely different offer, so it's rejected
    outright instead of silently returning the existing request.
    """
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    _login(client, 1, "Alice")
    _login(client, 2, "Bob")
    offer1 = _create_offer(client, auth_a)
    offer2 = _create_offer(client, auth_a)
    client.post("/requests", headers=auth_b, json={"offer_id": offer1["id"]})

    response = client.post("/requests", headers=auth_b, json={"offer_id": offer2["id"]})

    assert response.status_code == 400


def test_can_request_a_different_provider_while_one_request_is_already_live(client):
    """The one-live-request rule is per PROVIDER, not global — a buyer
    can have live requests with several different providers at once."""
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    auth_c = _auth_header(3, "Carol")
    _login(client, 1, "Alice")
    _login(client, 2, "Bob")
    _login(client, 3, "Carol")
    offer_alice = _create_offer(client, auth_a)
    offer_carol = _create_offer(client, auth_c)
    client.post("/requests", headers=auth_b, json={"offer_id": offer_alice["id"]})

    response = client.post("/requests", headers=auth_b, json={"offer_id": offer_carol["id"]})

    assert response.status_code == 201


def test_can_request_a_different_offer_from_same_provider_after_first_is_rejected(client):
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    _login(client, 1, "Alice")
    _login(client, 2, "Bob")
    offer1 = _create_offer(client, auth_a)
    offer2 = _create_offer(client, auth_a)
    req1 = client.post("/requests", headers=auth_b, json={"offer_id": offer1["id"]}).json()
    client.post(f"/requests/{req1['id']}/reject", headers=auth_a, json={"reason": "no"})

    response = client.post("/requests", headers=auth_b, json={"offer_id": offer2["id"]})

    assert response.status_code == 201


# --- listing ---------------------------------------------------------------


def test_list_mine_and_list_for_offer(client):
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    _login(client, 1, "Alice")
    _login(client, 2, "Bob")
    offer = _create_offer(client, auth_a)
    client.post("/requests", headers=auth_b, json={"offer_id": offer["id"]})

    mine = client.get("/requests/mine", headers=auth_b).json()
    assert len(mine) == 1

    incoming = client.get("/requests", headers=auth_a, params={"offer_id": offer["id"]}).json()
    assert len(incoming) == 1


def test_only_the_provider_can_list_requests_for_an_offer(client):
    auth_a = _auth_header(1, "Alice")
    auth_c = _auth_header(3, "Carol")
    _login(client, 1, "Alice")
    _login(client, 3, "Carol")
    offer = _create_offer(client, auth_a)

    response = client.get("/requests", headers=auth_c, params={"offer_id": offer["id"]})

    assert response.status_code == 404


# --- accept / reject ---------------------------------------------------


def test_provider_can_accept_a_pending_request(client):
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    _login(client, 1, "Alice")
    _login(client, 2, "Bob")
    offer = _create_offer(client, auth_a)
    req = client.post("/requests", headers=auth_b, json={"offer_id": offer["id"]}).json()

    response = client.post(f"/requests/{req['id']}/accept", headers=auth_a)

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "accepted"
    assert body["responded_at"] is not None


def test_only_the_provider_can_accept(client):
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    auth_c = _auth_header(3, "Carol")
    _login(client, 1, "Alice")
    _login(client, 2, "Bob")
    _login(client, 3, "Carol")
    offer = _create_offer(client, auth_a)
    req = client.post("/requests", headers=auth_b, json={"offer_id": offer["id"]}).json()

    response = client.post(f"/requests/{req['id']}/accept", headers=auth_c)

    assert response.status_code == 404


def test_rejecting_requires_a_reason(client):
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    _login(client, 1, "Alice")
    _login(client, 2, "Bob")
    offer = _create_offer(client, auth_a)
    req = client.post("/requests", headers=auth_b, json={"offer_id": offer["id"]}).json()

    response = client.post(f"/requests/{req['id']}/reject", headers=auth_a, json={"reason": ""})

    assert response.status_code == 422


def test_provider_can_reject_with_a_reason(client):
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    _login(client, 1, "Alice")
    _login(client, 2, "Bob")
    offer = _create_offer(client, auth_a)
    req = client.post("/requests", headers=auth_b, json={"offer_id": offer["id"]}).json()

    response = client.post(
        f"/requests/{req['id']}/reject", headers=auth_a, json={"reason": "Not available"}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "rejected"
    assert body["reason"] == "Not available"


def test_cannot_accept_an_already_resolved_request(client):
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    _login(client, 1, "Alice")
    _login(client, 2, "Bob")
    offer = _create_offer(client, auth_a)
    req = client.post("/requests", headers=auth_b, json={"offer_id": offer["id"]}).json()
    client.post(f"/requests/{req['id']}/reject", headers=auth_a, json={"reason": "no"})

    response = client.post(f"/requests/{req['id']}/accept", headers=auth_a)

    assert response.status_code == 400


def test_provider_cannot_accept_a_second_request_while_one_is_already_open(client):
    """The global rule: one open accepted request in total, across every
    offer the provider has — not per offer."""
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    auth_c = _auth_header(3, "Carol")
    _login(client, 1, "Alice")
    _login(client, 2, "Bob")
    _login(client, 3, "Carol")
    offer1 = _create_offer(client, auth_a)
    offer2 = _create_offer(client, auth_a)
    req1 = client.post("/requests", headers=auth_b, json={"offer_id": offer1["id"]}).json()
    req2 = client.post("/requests", headers=auth_c, json={"offer_id": offer2["id"]}).json()

    first_accept = client.post(f"/requests/{req1['id']}/accept", headers=auth_a)
    assert first_accept.status_code == 200

    second_accept = client.post(f"/requests/{req2['id']}/accept", headers=auth_a)
    assert second_accept.status_code == 400
