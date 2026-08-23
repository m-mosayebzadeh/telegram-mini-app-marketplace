"""Integration tests for the offer endpoints."""

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
        "terms": "Be nice",
    }
    payload.update(overrides)
    return client.post("/offers", headers=auth, json=payload)


# --- create / read -------------------------------------------------------


def test_create_offer_does_not_require_a_profile(client):
    auth = _auth_header(1, "Alice")
    _login(client, 1, "Alice")

    response = _create_offer(client, auth)

    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "active"
    assert body["service_type"] == "chat"


def test_create_offer_rejects_non_positive_price(client):
    auth = _auth_header(1, "Alice")
    _login(client, 1, "Alice")

    response = _create_offer(client, auth, price_stars=0)

    assert response.status_code == 422


def test_sixth_active_offer_is_rejected(client):
    auth = _auth_header(1, "Alice")
    _login(client, 1, "Alice")
    for _ in range(5):
        assert _create_offer(client, auth).status_code == 201

    response = _create_offer(client, auth)

    assert response.status_code == 400


def test_stranger_cannot_see_an_inactive_offer(client):
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    _login(client, 1, "Alice")
    _login(client, 2, "Bob")
    offer = _create_offer(client, auth_a).json()
    client.post(f"/offers/{offer['id']}/deactivate", headers=auth_a)

    response = client.get(f"/offers/{offer['id']}", headers=auth_b)
    assert response.status_code == 404

    # The owner can still see it.
    own_view = client.get(f"/offers/{offer['id']}", headers=auth_a)
    assert own_view.status_code == 200


def test_listing_only_shows_active_offers_to_strangers(client):
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    alice = _login(client, 1, "Alice")
    _login(client, 2, "Bob")
    active = _create_offer(client, auth_a).json()
    inactive = _create_offer(client, auth_a).json()
    client.post(f"/offers/{inactive['id']}/deactivate", headers=auth_a)

    stranger_view = client.get("/offers", headers=auth_b, params={"provider_id": alice["id"]}).json()
    assert [o["id"] for o in stranger_view] == [active["id"]]

    owner_view = client.get("/offers", headers=auth_a, params={"provider_id": alice["id"]}).json()
    assert {o["id"] for o in owner_view} == {active["id"], inactive["id"]}


# --- discovery (no provider_id) --------------------------------------------


def test_discovery_lists_active_offers_from_every_provider(client):
    """
    GET /offers with no provider_id at all is the marketplace-wide
    browse view (TECHNICAL_REQUIREMENTS.md's "Customer Discovery") — a
    buyer who doesn't already know a specific provider's id.
    """
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    auth_c = _auth_header(3, "Carol")
    _login(client, 1, "Alice")
    _login(client, 2, "Bob")
    _login(client, 3, "Carol")
    alice_offer = _create_offer(client, auth_a).json()
    carol_offer = _create_offer(client, auth_c).json()

    response = client.get("/offers", headers=auth_b)

    assert response.status_code == 200
    ids = {o["id"] for o in response.json()}
    assert ids == {alice_offer["id"], carol_offer["id"]}


def test_discovery_never_includes_inactive_offers_even_your_own(client):
    auth_a = _auth_header(1, "Alice")
    _login(client, 1, "Alice")
    active = _create_offer(client, auth_a).json()
    inactive = _create_offer(client, auth_a).json()
    client.post(f"/offers/{inactive['id']}/deactivate", headers=auth_a)

    response = client.get("/offers", headers=auth_a).json()

    assert [o["id"] for o in response] == [active["id"]]


# --- editing lock ----------------------------------------------------------


def test_offer_is_editable_before_any_request(client):
    auth = _auth_header(1, "Alice")
    _login(client, 1, "Alice")
    offer = _create_offer(client, auth).json()

    response = client.patch(f"/offers/{offer['id']}", headers=auth, json={"price_stars": 99})

    assert response.status_code == 200
    assert response.json()["price_stars"] == 99


def test_offer_is_locked_once_it_has_a_pending_request(client):
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    _login(client, 1, "Alice")
    _login(client, 2, "Bob")
    offer = _create_offer(client, auth_a).json()
    client.post("/requests", headers=auth_b, json={"offer_id": offer["id"]})

    response = client.patch(f"/offers/{offer['id']}", headers=auth_a, json={"price_stars": 99})

    assert response.status_code == 400


def test_offer_is_editable_again_after_its_only_request_is_rejected(client):
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    _login(client, 1, "Alice")
    _login(client, 2, "Bob")
    offer = _create_offer(client, auth_a).json()
    req = client.post("/requests", headers=auth_b, json={"offer_id": offer["id"]}).json()
    client.post(f"/requests/{req['id']}/reject", headers=auth_a, json={"reason": "no thanks"})

    response = client.patch(f"/offers/{offer['id']}", headers=auth_a, json={"price_stars": 99})

    assert response.status_code == 200


# --- delete ------------------------------------------------------------


def test_delete_offer_with_no_requests(client):
    auth = _auth_header(1, "Alice")
    _login(client, 1, "Alice")
    offer = _create_offer(client, auth).json()

    response = client.delete(f"/offers/{offer['id']}", headers=auth)

    assert response.status_code == 204
    assert client.get(f"/offers/{offer['id']}", headers=auth).status_code == 404


def test_delete_offer_cancels_pending_requests(client):
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    _login(client, 1, "Alice")
    _login(client, 2, "Bob")
    offer = _create_offer(client, auth_a).json()
    req = client.post("/requests", headers=auth_b, json={"offer_id": offer["id"]}).json()

    client.delete(f"/offers/{offer['id']}", headers=auth_a)

    mine = client.get("/requests/mine", headers=auth_b).json()
    cancelled = next(r for r in mine if r["id"] == req["id"])
    assert cancelled["status"] == "cancelled"
    assert cancelled["reason"] == "Offer was deleted by the provider."


def test_cannot_delete_offer_with_an_accepted_request(client):
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    _login(client, 1, "Alice")
    _login(client, 2, "Bob")
    offer = _create_offer(client, auth_a).json()
    req = client.post("/requests", headers=auth_b, json={"offer_id": offer["id"]}).json()
    client.post(f"/requests/{req['id']}/accept", headers=auth_a)

    response = client.delete(f"/offers/{offer['id']}", headers=auth_a)

    assert response.status_code == 400


# --- activate / deactivate -------------------------------------------------


def test_reactivating_respects_the_five_offer_cap(client):
    auth = _auth_header(1, "Alice")
    _login(client, 1, "Alice")
    offers = [_create_offer(client, auth).json() for _ in range(5)]
    client.post(f"/offers/{offers[0]['id']}/deactivate", headers=auth)
    # A 6th one fills the freed-up slot.
    _create_offer(client, auth)

    response = client.post(f"/offers/{offers[0]['id']}/activate", headers=auth)

    assert response.status_code == 400
