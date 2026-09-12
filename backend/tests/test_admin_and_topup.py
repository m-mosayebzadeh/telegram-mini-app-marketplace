"""
Tests for the admin-access mechanism (app/auth/dependencies.py's
require_owner/require_admin/effective_admin_scopes, app/admin/router.py's
role & assistant & user-management endpoints) and the manual
card-to-card top-up flow (app/topup/router.py, app/admin/router.py's
review endpoints) — see TECHNICAL_REQUIREMENTS.md, "پنل مدیریتی" and
"شارژ کارت‌به‌کارت".
"""

import io

import pytest

from app.core.config import settings
from tests.helpers import give_wallet_balance, make_test_image_bytes, sign_init_data

OWNER_TELEGRAM_ID = 900000001


@pytest.fixture(autouse=True)
def owner_configured():
    """Every test in this file gets a real owner_telegram_id — settings
    defaults to None (see app/core/config.py), which would make
    require_owner reject everyone, including the "owner" these tests
    exercise. Restored after each test, the same isolation pattern
    conftest.py's isolated_uploads_dir fixture uses."""
    original = settings.owner_telegram_id
    settings.owner_telegram_id = OWNER_TELEGRAM_ID
    yield
    settings.owner_telegram_id = original


def _auth_header(telegram_id: int, first_name: str = "Test", username: str | None = None) -> dict:
    user = {"id": telegram_id, "first_name": first_name}
    if username:
        user["username"] = username
    return {"X-Telegram-Init-Data": sign_init_data(user)}


def _receipt_file():
    return {"file": ("receipt.jpg", io.BytesIO(b"fake receipt bytes"), "image/jpeg")}


OWNER_HEADER = _auth_header(OWNER_TELEGRAM_ID, "Owner")
BUYER_HEADER = _auth_header(1001, "Buyer", "buyer_dev")
OTHER_HEADER = _auth_header(1002, "Other", "other_dev")


def _grant_scope(client, target_header: dict, scopes: list[str], role_name: str = "test-role") -> int:
    """
    The role-based equivalent of what used to be a single
    `POST /admin/grants` call: creates a fresh role with these scopes
    (owner-only) and assigns it to whoever `target_header` belongs to
    (who must have already logged in at least once, so their `User`
    row exists — see app/admin/router.py's assign_role). Returns the
    new role's id, in case a test wants to deactivate/delete it later.
    """
    user_id = client.get("/me", headers=target_header).json()["id"]
    role = client.post("/admin/roles", headers=OWNER_HEADER, json={"name": role_name, "scopes": scopes})
    assert role.status_code == 201, role.text
    role_id = role.json()["id"]
    assign = client.post(f"/admin/users/{user_id}/roles", headers=OWNER_HEADER, json={"role_id": role_id})
    assert assign.status_code == 201, assign.text
    return role_id


# --- creating a request ------------------------------------------------


def test_create_topup_request_freezes_rate_and_amount(client):
    response = client.post(
        "/topup/requests",
        headers=BUYER_HEADER,
        data={"requested_stars": "50"},
        files=_receipt_file(),
    )
    assert response.status_code == 201
    body = response.json()
    assert body["requested_stars"] == 50
    assert body["star_rate_at_request"] == settings.star_to_toman_rate
    assert body["requested_toman_amount"] == 50 * settings.star_to_toman_rate
    assert body["status"] == "pending"


def test_requested_stars_must_be_positive(client):
    response = client.post(
        "/topup/requests",
        headers=BUYER_HEADER,
        data={"requested_stars": "0"},
        files=_receipt_file(),
    )
    assert response.status_code == 400


# --- access control ------------------------------------------------------


def test_non_admin_gets_403_on_admin_routes(client):
    response = client.get("/admin/topup-requests", headers=BUYER_HEADER)
    assert response.status_code == 403


def test_only_owner_can_manage_roles_and_assignments(client):
    # A non-owner (not holding any role themselves) can't create a
    # role, assign one, or revoke one — role/assistant management is
    # owner-only, same as require_owner everywhere else.
    client.get("/me", headers=OTHER_HEADER)
    create = client.post(
        "/admin/roles", headers=OTHER_HEADER, json={"name": "sneaky", "scopes": ["finance.topups"]}
    )
    assert create.status_code == 403

    role_id = _grant_scope(client, BUYER_HEADER, ["finance.topups"], role_name="topup-reviewer")

    buyer_id = client.get("/me", headers=BUYER_HEADER).json()["id"]
    assign = client.post(
        f"/admin/users/{buyer_id}/roles", headers=OTHER_HEADER, json={"role_id": role_id}
    )
    assert assign.status_code == 403


def test_scoped_role_lets_a_non_owner_review_topups(client):
    # `other` has no access yet.
    assert client.get("/admin/topup-requests", headers=OTHER_HEADER).status_code == 403

    _grant_scope(client, OTHER_HEADER, ["finance.topups"])

    assert client.get("/admin/topup-requests", headers=OTHER_HEADER).status_code == 200


def test_assigning_role_to_unknown_user_404s(client):
    role = client.post(
        "/admin/roles", headers=OWNER_HEADER, json={"name": "ghost-role", "scopes": ["finance.topups"]}
    )
    response = client.post(
        "/admin/users/424242/roles", headers=OWNER_HEADER, json={"role_id": role.json()["id"]}
    )
    assert response.status_code == 404


# --- approve / reject ------------------------------------------------------


def test_approve_credits_the_requesters_wallet(client):
    create = client.post(
        "/topup/requests", headers=BUYER_HEADER, data={"requested_stars": "10"}, files=_receipt_file()
    )
    request_id = create.json()["id"]

    before = client.get("/wallet/balance", headers=BUYER_HEADER).json()["balance_toman"]

    approve = client.post(
        f"/admin/topup-requests/{request_id}/approve",
        headers=OWNER_HEADER,
        json={"final_toman_amount": 40000, "transaction_reference": "TRX-1"},
    )
    assert approve.status_code == 200
    body = approve.json()
    assert body["status"] == "approved"
    assert body["final_toman_amount"] == 40000
    assert body["transaction_reference"] == "TRX-1"

    after = client.get("/wallet/balance", headers=BUYER_HEADER).json()["balance_toman"]
    assert after == before + 40000


def test_reject_records_reason_and_never_touches_the_wallet(client):
    create = client.post(
        "/topup/requests", headers=BUYER_HEADER, data={"requested_stars": "10"}, files=_receipt_file()
    )
    request_id = create.json()["id"]
    before = client.get("/wallet/balance", headers=BUYER_HEADER).json()["balance_toman"]

    reject = client.post(
        f"/admin/topup-requests/{request_id}/reject",
        headers=OWNER_HEADER,
        json={"reason": "رسید ناواضح بود"},
    )
    assert reject.status_code == 200
    body = reject.json()
    assert body["status"] == "rejected"
    assert body["rejection_reason"] == "رسید ناواضح بود"

    after = client.get("/wallet/balance", headers=BUYER_HEADER).json()["balance_toman"]
    assert after == before


def test_already_reviewed_request_cannot_be_reviewed_again(client):
    create = client.post(
        "/topup/requests", headers=BUYER_HEADER, data={"requested_stars": "10"}, files=_receipt_file()
    )
    request_id = create.json()["id"]
    client.post(
        f"/admin/topup-requests/{request_id}/reject", headers=OWNER_HEADER, json={"reason": "test"}
    )

    second = client.post(
        f"/admin/topup-requests/{request_id}/approve",
        headers=OWNER_HEADER,
        json={"final_toman_amount": 1000, "transaction_reference": "x"},
    )
    assert second.status_code == 400


# --- receipt access ------------------------------------------------------


def test_receipt_only_visible_to_requester_and_admins(client):
    create = client.post(
        "/topup/requests", headers=BUYER_HEADER, data={"requested_stars": "10"}, files=_receipt_file()
    )
    request_id = create.json()["id"]

    assert client.get(f"/topup/requests/{request_id}/receipt", headers=BUYER_HEADER).status_code == 200
    assert client.get(f"/topup/requests/{request_id}/receipt", headers=OWNER_HEADER).status_code == 200
    # Some other, unrelated user has no reason to see this.
    assert client.get(f"/topup/requests/{request_id}/receipt", headers=OTHER_HEADER).status_code == 404


def test_receipt_visible_to_a_scoped_finance_topups_role_holder(client):
    """Regression test: _can_view_receipt used to query AdminGrant.scopes
    directly, which stopped existing once the role-based redesign moved
    scopes onto Role instead (see app/topup/router.py)."""
    create = client.post(
        "/topup/requests", headers=BUYER_HEADER, data={"requested_stars": "10"}, files=_receipt_file()
    )
    request_id = create.json()["id"]

    client.get("/me", headers=OTHER_HEADER)
    _grant_scope(client, OTHER_HEADER, ["finance.topups"])

    assert client.get(f"/topup/requests/{request_id}/receipt", headers=OTHER_HEADER).status_code == 200


# --- /admin/me (never 403s, see app/admin/router.py) ------------------


def test_my_admin_access_reports_owner(client):
    response = client.get("/admin/me", headers=OWNER_HEADER)
    assert response.status_code == 200
    assert response.json() == {"is_owner": True, "scopes": []}


def test_my_admin_access_reports_no_access_for_a_plain_user(client):
    response = client.get("/admin/me", headers=BUYER_HEADER)
    assert response.status_code == 200
    assert response.json() == {"is_owner": False, "scopes": []}


def test_my_admin_access_reports_scopes_from_an_assigned_role(client):
    client.get("/me", headers=OTHER_HEADER)  # so a User row for 1002 exists to grant to
    _grant_scope(client, OTHER_HEADER, ["finance.topups"])
    response = client.get("/admin/me", headers=OTHER_HEADER)
    assert response.status_code == 200
    assert response.json() == {"is_owner": False, "scopes": ["finance.topups"]}


# --- first-login username collision (see app/auth/dependencies.py) ---------


def test_first_login_falls_back_to_no_username_on_collision(client):
    """A real regression test for the bug this exact scenario surfaced
    during manual testing: since User.username became unique, two
    different Telegram accounts whose initData both claim the same
    username must not crash first login with a raw IntegrityError."""
    first = client.get("/me", headers=_auth_header(2001, "First", "shared_name"))
    assert first.status_code == 200
    assert first.json()["username"] == "shared_name"

    second = client.get("/me", headers=_auth_header(2002, "Second", "shared_name"))
    assert second.status_code == 200
    assert second.json()["username"] is None


# --- platform rates (finance.rates scope) -----------------------------


def test_rates_default_from_settings(client):
    response = client.get("/admin/rates", headers=OWNER_HEADER)
    assert response.status_code == 200
    body = response.json()
    assert body["star_to_toman_rate"] == settings.star_to_toman_rate
    assert body["withdrawal_commission_percent"] == 10
    assert body["complaint_commission_percent"] == 0
    assert body["minimum_withdrawal_toman"] == 500_000


def test_rates_forbidden_without_scope(client):
    response = client.get("/admin/rates", headers=BUYER_HEADER)
    assert response.status_code == 403


def test_owner_can_update_rates_and_it_affects_pricing(client):
    update = client.put(
        "/admin/rates",
        headers=OWNER_HEADER,
        json={"star_to_toman_rate": 5000, "withdrawal_commission_percent": 12, "complaint_commission_percent": 7, "minimum_withdrawal_toman": 500000},
    )
    assert update.status_code == 200
    assert update.json()["star_to_toman_rate"] == 5000

    pricing = client.get("/pricing", headers=BUYER_HEADER)
    assert pricing.json() == {
        "star_to_toman_rate": 5000,
        "withdrawal_commission_percent": 12,
        "complaint_commission_percent": 7,
        "minimum_withdrawal_toman": 500000,
    }


def test_scoped_role_for_rates_only_covers_rates(client):
    client.get("/me", headers=OTHER_HEADER)
    _grant_scope(client, OTHER_HEADER, ["finance.rates"])
    assert client.get("/admin/rates", headers=OTHER_HEADER).status_code == 200
    assert client.get("/admin/topup-requests", headers=OTHER_HEADER).status_code == 403


# --- roles ("نقش و دسترسی") --------------------------------------------


def test_create_and_list_roles_reports_member_count(client):
    create = client.post(
        "/admin/roles", headers=OWNER_HEADER, json={"name": "Support", "scopes": ["finance.topups"]}
    )
    assert create.status_code == 201
    body = create.json()
    assert body["name"] == "Support"
    assert body["is_active"] is True
    assert body["member_count"] == 0

    _grant_scope(client, BUYER_HEADER, [], role_name="Support-2")

    listing = client.get("/admin/roles", headers=OWNER_HEADER).json()
    names = {r["name"]: r["member_count"] for r in listing}
    assert names["Support"] == 0
    assert names["Support-2"] == 1


def test_duplicate_role_name_is_rejected(client):
    client.post("/admin/roles", headers=OWNER_HEADER, json={"name": "Support", "scopes": []})
    response = client.post("/admin/roles", headers=OWNER_HEADER, json={"name": "Support", "scopes": []})
    assert response.status_code == 400


def test_update_role_renames_and_replaces_scopes(client):
    role = client.post(
        "/admin/roles", headers=OWNER_HEADER, json={"name": "Support", "scopes": ["finance.topups"]}
    ).json()

    update = client.patch(
        f"/admin/roles/{role['id']}",
        headers=OWNER_HEADER,
        json={"name": "Finance Support", "scopes": ["finance.topups", "finance.rates"]},
    )
    assert update.status_code == 200
    body = update.json()
    assert body["name"] == "Finance Support"
    assert set(body["scopes"]) == {"finance.topups", "finance.rates"}


def test_deactivating_a_role_strips_scopes_without_touching_the_assignment(client):
    role_id = _grant_scope(client, OTHER_HEADER, ["finance.topups"])
    assert client.get("/admin/topup-requests", headers=OTHER_HEADER).status_code == 200

    deactivate = client.post(f"/admin/roles/{role_id}/deactivate", headers=OWNER_HEADER)
    assert deactivate.status_code == 200
    assert deactivate.json()["is_active"] is False

    # Access is gone while inactive...
    assert client.get("/admin/topup-requests", headers=OTHER_HEADER).status_code == 403
    # ...but the assignment itself is untouched: `other` still shows up
    # holding the role (just inactive), so no one needs to re-assign it.
    their_roles = client.get(
        f"/admin/users/{client.get('/me', headers=OTHER_HEADER).json()['id']}/roles", headers=OWNER_HEADER
    ).json()
    assert any(r["role_id"] == role_id and r["is_active"] is False for r in their_roles)

    # Reactivating restores access immediately, with no reassignment.
    reactivate = client.post(f"/admin/roles/{role_id}/activate", headers=OWNER_HEADER)
    assert reactivate.status_code == 200
    assert client.get("/admin/topup-requests", headers=OTHER_HEADER).status_code == 200


def test_deleting_a_role_removes_it_and_every_assignment(client):
    role_id = _grant_scope(client, OTHER_HEADER, ["finance.topups"])

    delete = client.delete(f"/admin/roles/{role_id}", headers=OWNER_HEADER)
    assert delete.status_code == 204

    assert client.get(f"/admin/roles/{role_id}", headers=OWNER_HEADER).status_code == 404
    assert client.get("/admin/topup-requests", headers=OTHER_HEADER).status_code == 403
    other_id = client.get("/me", headers=OTHER_HEADER).json()["id"]
    assert client.get(f"/admin/users/{other_id}/roles", headers=OWNER_HEADER).json() == []


def test_assigning_the_same_role_twice_is_a_no_op(client):
    role_id = _grant_scope(client, OTHER_HEADER, ["finance.topups"])
    other_id = client.get("/me", headers=OTHER_HEADER).json()["id"]

    again = client.post(
        f"/admin/users/{other_id}/roles", headers=OWNER_HEADER, json={"role_id": role_id}
    )
    assert again.status_code == 201  # still reports success, just doesn't duplicate

    roles = client.get(f"/admin/users/{other_id}/roles", headers=OWNER_HEADER).json()
    assert len([r for r in roles if r["role_id"] == role_id]) == 1


def test_revoke_role_removes_it_and_revoking_again_404s(client):
    role_id = _grant_scope(client, OTHER_HEADER, ["finance.topups"])
    other_id = client.get("/me", headers=OTHER_HEADER).json()["id"]

    revoke = client.delete(f"/admin/users/{other_id}/roles/{role_id}", headers=OWNER_HEADER)
    assert revoke.status_code == 204
    assert client.get("/admin/topup-requests", headers=OTHER_HEADER).status_code == 403

    again = client.delete(f"/admin/users/{other_id}/roles/{role_id}", headers=OWNER_HEADER)
    assert again.status_code == 404


def test_list_role_members_returns_current_holders(client):
    role_id = _grant_scope(client, OTHER_HEADER, ["finance.topups"])
    members = client.get(f"/admin/roles/{role_id}/members", headers=OWNER_HEADER).json()
    assert len(members) == 1
    assert members[0]["is_assistant"] is True
    assert members[0]["username"] == "other_dev"


# --- assistants & user search ("دستیاران") ------------------------------


def test_list_assistants_only_includes_users_holding_a_role(client):
    client.get("/me", headers=BUYER_HEADER)  # logged in, but not an assistant
    _grant_scope(client, OTHER_HEADER, ["finance.topups"])

    assistants = client.get("/admin/assistants", headers=OWNER_HEADER).json()
    ids = {a["user_id"] for a in assistants}
    other_id = client.get("/me", headers=OTHER_HEADER).json()["id"]
    buyer_id = client.get("/me", headers=BUYER_HEADER).json()["id"]
    assert other_id in ids
    assert buyer_id not in ids


def test_search_users_matches_by_name_and_flags_assistants(client):
    client.get("/me", headers=_auth_header(3001, "Searchable", "findme"))
    _grant_scope(client, OTHER_HEADER, ["finance.topups"])

    results = client.get("/admin/users/search", headers=OWNER_HEADER, params={"q": "findme"}).json()
    assert len(results) == 1
    assert results[0]["username"] == "findme"
    assert results[0]["is_assistant"] is False

    other_results = client.get(
        "/admin/users/search", headers=OWNER_HEADER, params={"q": "other_dev"}
    ).json()
    assert other_results[0]["is_assistant"] is True


def test_search_users_respects_limit(client):
    for i in range(4001, 4008):
        client.get("/me", headers=_auth_header(i, "Bulk"))
    results = client.get("/admin/users/search", headers=OWNER_HEADER, params={"q": "Bulk", "limit": 5}).json()
    assert len(results) == 5


def test_non_owner_cannot_reach_assistant_or_user_management_routes(client):
    client.get("/me", headers=BUYER_HEADER)
    buyer_id = client.get("/me", headers=BUYER_HEADER).json()["id"]
    assert client.get("/admin/assistants", headers=OTHER_HEADER).status_code == 403
    assert client.get("/admin/users/search", headers=OTHER_HEADER).status_code == 403
    assert client.get(f"/admin/users/{buyer_id}", headers=OTHER_HEADER).status_code == 403
    assert client.post(f"/admin/users/{buyer_id}/block", headers=OTHER_HEADER).status_code == 403


# --- users section ("کاربران") ------------------------------------------


def test_get_user_detail_reports_status_and_balance(client, db_session):
    buyer = client.get("/me", headers=BUYER_HEADER).json()
    give_wallet_balance(db_session, buyer["id"], amount_toman=12345)

    detail = client.get(f"/admin/users/{buyer['id']}", headers=OWNER_HEADER)
    assert detail.status_code == 200
    body = detail.json()
    assert body["user_id"] == buyer["id"]
    assert body["status"] == "active"
    assert body["balance_toman"] == 12345
    assert body["pending_toman"] == 0


def test_block_and_unblock_user(client):
    buyer = client.get("/me", headers=BUYER_HEADER).json()

    block = client.post(f"/admin/users/{buyer['id']}/block", headers=OWNER_HEADER)
    assert block.status_code == 200
    assert block.json()["status"] == "blocked"

    unblock = client.post(f"/admin/users/{buyer['id']}/unblock", headers=OWNER_HEADER)
    assert unblock.status_code == 200
    assert unblock.json()["status"] == "active"


def test_admin_can_list_and_delete_a_users_offer(client):
    alice = client.get("/me", headers=BUYER_HEADER).json()
    offer = client.post(
        "/offers",
        headers=BUYER_HEADER,
        json={
            "price_stars": 10,
            "display_duration_minutes": 30,
            "title": "Chat with me",
            "description": "A nice chat",
        },
    ).json()

    listed = client.get(f"/admin/users/{alice['id']}/offers", headers=OWNER_HEADER).json()
    assert any(o["id"] == offer["id"] for o in listed)

    delete = client.delete(f"/admin/offers/{offer['id']}", headers=OWNER_HEADER)
    assert delete.status_code == 204
    assert client.get(f"/offers/{offer['id']}", headers=BUYER_HEADER).status_code == 404


def test_admin_delete_offer_still_blocks_on_an_open_accepted_request(client):
    """The admin delete path reuses the exact same safety rule as a
    provider deleting their own offer (see app/offer/router.py's
    _has_unfinished_accepted_request) — it doesn't get to skip it just
    because an admin is doing the deleting."""
    client.get("/me", headers=BUYER_HEADER)
    offer = client.post(
        "/offers",
        headers=BUYER_HEADER,
        json={
            "price_stars": 10,
            "display_duration_minutes": 30,
            "title": "Chat with me",
            "description": "A nice chat",
        },
    ).json()
    req = client.post("/requests", headers=OTHER_HEADER, json={"offer_id": offer["id"]}).json()
    client.post(f"/requests/{req['id']}/accept", headers=BUYER_HEADER)

    response = client.delete(f"/admin/offers/{offer['id']}", headers=OWNER_HEADER)
    assert response.status_code == 400


def test_admin_can_list_and_delete_a_users_content(client):
    alice = client.get("/me", headers=BUYER_HEADER).json()
    content = client.post(
        "/content",
        headers=BUYER_HEADER,
        files={"file": ("test.jpg", make_test_image_bytes(), "image/jpeg")},
        data={"content_type": "photo", "is_paid": "false", "has_spoiler": "false", "audience_type": "public"},
    ).json()

    listed = client.get(f"/admin/users/{alice['id']}/content", headers=OWNER_HEADER).json()
    assert any(c["id"] == content["id"] for c in listed)

    delete = client.delete(f"/admin/content/{content['id']}", headers=OWNER_HEADER)
    assert delete.status_code == 204
    assert client.get(f"/content/{content['id']}", headers=BUYER_HEADER).status_code == 404


def test_admin_requests_list_includes_both_sent_and_received(client):
    alice = client.get("/me", headers=BUYER_HEADER).json()
    offer = client.post(
        "/offers",
        headers=BUYER_HEADER,
        json={
            "price_stars": 10,
            "display_duration_minutes": 30,
            "title": "Chat with me",
            "description": "A nice chat",
        },
    ).json()
    client.post("/requests", headers=OTHER_HEADER, json={"offer_id": offer["id"]})

    rows = client.get(f"/admin/users/{alice['id']}/requests", headers=OWNER_HEADER).json()
    assert len(rows) == 1
    assert rows[0]["direction"] == "received"
    assert rows[0]["counterpart_user_id"] == client.get("/me", headers=OTHER_HEADER).json()["id"]
    assert rows[0]["offer_price_stars"] == 10
