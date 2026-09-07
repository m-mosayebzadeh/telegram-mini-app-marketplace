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
        "title": "Chat with me",
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
    body = response.json()["detail"]
    assert body["reason"] == "live_request_with_provider"
    # Lets the frontend deep-link straight to the request that's
    # actually blocking this one (see OfferDetail.tsx).
    first_request_id = client.get("/requests/mine", headers=auth_b).json()[0]["id"]
    assert body["existing_request_id"] == first_request_id


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


def test_activity_feed_rows_are_enriched_with_offer_price_and_counterpart_info(client):
    """The unified Activity feed row denormalizes everything the
    one-line list needs to render without a second round trip: the
    offer's own price (not just its title), and the OTHER party's
    username/avatar alongside their display name — see
    RequestActivityOut."""
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    _login(client, 1, "Alice")
    _login(client, 2, "Bob")
    offer = _create_offer(client, auth_a, price_stars=42)
    client.post("/requests", headers=auth_b, json={"offer_id": offer["id"]})

    row = client.get("/requests/activity", headers=auth_b).json()[0]

    assert row["offer_price_stars"] == 42
    assert row["counterpart_user_id"] == offer["provider_id"]
    assert row["counterpart_display_name"] == "Alice"
    # Neither logged in with a username, and neither ever uploaded a
    # profile photo — both come back None, not an error.
    assert row["counterpart_username"] is None
    assert row["counterpart_avatar_url"] is None


def test_incoming_requests_are_enriched_with_the_buyers_own_info(client):
    # The incoming-requests row shows the requester's avatar/name
    # directly (no second round trip per row) — see
    # IncomingRequestOut/list_requests_for_offer.
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    _login(client, 1, "Alice")
    bob = _login(client, 2, "Bob")
    offer = _create_offer(client, auth_a)
    client.post("/requests", headers=auth_b, json={"offer_id": offer["id"]})

    incoming = client.get("/requests", headers=auth_a, params={"offer_id": offer["id"]}).json()

    assert incoming[0]["buyer_id"] == bob["id"]
    assert incoming[0]["buyer_display_name"] == "Bob"
    # Bob never uploaded a profile photo — no avatar to show, not an error.
    assert incoming[0]["buyer_avatar_url"] is None


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


# --- daily request cap (MAX_DAILY_REQUESTS_PER_BUYER) -----------------


def _login_provider_with_offer(client, telegram_id: int):
    """A fresh provider with one offer — used to send the buyer's daily
    cap tests each request to a DIFFERENT provider, so the "one live
    request per provider" rule never interferes with what's actually
    being tested here."""
    auth = _auth_header(telegram_id, f"Provider{telegram_id}")
    _login(client, telegram_id, f"Provider{telegram_id}")
    return _create_offer(client, auth)


def test_the_11th_request_today_is_blocked_with_a_structured_error(client):
    buyer = _auth_header(50, "Buyer")
    _login(client, 50, "Buyer")

    for provider_id in range(60, 70):  # 10 different providers
        offer = _login_provider_with_offer(client, provider_id)
        response = client.post("/requests", headers=buyer, json={"offer_id": offer["id"]})
        assert response.status_code == 201

    eleventh_offer = _login_provider_with_offer(client, 70)
    response = client.post("/requests", headers=buyer, json={"offer_id": eleventh_offer["id"]})

    assert response.status_code == 400
    body = response.json()["detail"]
    assert body["reason"] == "daily_cap_reached"
    assert body["limit"] == 10


def test_a_request_the_provider_rejected_frees_up_the_daily_cap_slot(client):
    buyer = _auth_header(51, "Buyer")
    _login(client, 51, "Buyer")

    requests = []
    for provider_id in range(80, 90):  # 10 different providers
        provider_auth = _auth_header(provider_id, f"Provider{provider_id}")
        offer = _login_provider_with_offer(client, provider_id)
        req = client.post("/requests", headers=buyer, json={"offer_id": offer["id"]}).json()
        requests.append((provider_auth, req))

    # Still at the cap...
    eleventh_offer = _login_provider_with_offer(client, 90)
    blocked = client.post("/requests", headers=buyer, json={"offer_id": eleventh_offer["id"]})
    assert blocked.status_code == 400

    # ...but a provider REJECTING one of today's requests frees its slot
    # back up — it wasn't the buyer spending it on purpose.
    provider_auth, req = requests[0]
    client.post(f"/requests/{req['id']}/reject", headers=provider_auth, json={"reason": "no"})

    response = client.post("/requests", headers=buyer, json={"offer_id": eleventh_offer["id"]})
    assert response.status_code == 201


def test_a_request_the_buyer_cancelled_still_counts_toward_the_daily_cap(client):
    buyer = _auth_header(52, "Buyer")
    _login(client, 52, "Buyer")

    first_offer = _login_provider_with_offer(client, 100)
    first_req = client.post("/requests", headers=buyer, json={"offer_id": first_offer["id"]}).json()
    client.post(f"/requests/{first_req['id']}/cancel", headers=buyer)

    for provider_id in range(101, 110):  # 9 more, for 10 total today
        offer = _login_provider_with_offer(client, provider_id)
        client.post("/requests", headers=buyer, json={"offer_id": offer["id"]})

    eleventh_offer = _login_provider_with_offer(client, 110)
    response = client.post("/requests", headers=buyer, json={"offer_id": eleventh_offer["id"]})

    # Cancelling the first one did NOT free its slot — the buyer is
    # still at 10 "spent" requests today, even though one of them shows
    # as cancelled now.
    assert response.status_code == 400
    assert response.json()["detail"]["reason"] == "daily_cap_reached"


# --- cancel -------------------------------------------------------------


def test_buyer_can_cancel_their_own_pending_request(client):
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    _login(client, 1, "Alice")
    _login(client, 2, "Bob")
    offer = _create_offer(client, auth_a)
    req = client.post("/requests", headers=auth_b, json={"offer_id": offer["id"]}).json()

    response = client.post(f"/requests/{req['id']}/cancel", headers=auth_b)

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "cancelled"
    assert body["reason"] == "Cancelled by the buyer."
    assert body["responded_at"] is not None


def test_only_the_buyer_can_cancel_their_own_request(client):
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    _login(client, 1, "Alice")
    _login(client, 2, "Bob")
    offer = _create_offer(client, auth_a)
    req = client.post("/requests", headers=auth_b, json={"offer_id": offer["id"]}).json()

    # Not even the provider (whose own offer this is) can cancel it —
    # only the buyer who made it.
    response = client.post(f"/requests/{req['id']}/cancel", headers=auth_a)

    assert response.status_code == 404


def test_cannot_cancel_an_already_accepted_request(client):
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    _login(client, 1, "Alice")
    _login(client, 2, "Bob")
    offer = _create_offer(client, auth_a)
    req = client.post("/requests", headers=auth_b, json={"offer_id": offer["id"]}).json()
    client.post(f"/requests/{req['id']}/accept", headers=auth_a)

    response = client.post(f"/requests/{req['id']}/cancel", headers=auth_b)

    assert response.status_code == 400


def test_cancelling_frees_the_live_request_with_provider_slot(client):
    """Once cancelled, the buyer's request is no longer "live" against
    that provider — they can immediately request a different offer from
    the same provider (see _live_request_with_provider)."""
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    _login(client, 1, "Alice")
    _login(client, 2, "Bob")
    offer1 = _create_offer(client, auth_a)
    offer2 = _create_offer(client, auth_a)
    req1 = client.post("/requests", headers=auth_b, json={"offer_id": offer1["id"]}).json()
    client.post(f"/requests/{req1['id']}/cancel", headers=auth_b)

    response = client.post("/requests", headers=auth_b, json={"offer_id": offer2["id"]})

    assert response.status_code == 201
