"""
Tests for the admin-access mechanism (app/auth/dependencies.py's
require_owner/require_admin, app/admin/router.py's grants) and the
manual card-to-card top-up flow (app/topup/router.py,
app/admin/router.py's review endpoints) — see
TECHNICAL_REQUIREMENTS.md, "پنل مدیریتی" and "شارژ کارت‌به‌کارت".
"""

import io

import pytest

from app.core.config import settings
from tests.helpers import sign_init_data

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


def test_only_owner_can_manage_grants(client):
    # A scoped admin (not the owner) still can't hand out grants.
    client.post("/admin/grants", headers=OWNER_HEADER, json={"telegram_id": 1002, "scopes": ["wallet_topups"]})
    response = client.post(
        "/admin/grants", headers=OTHER_HEADER, json={"telegram_id": 1001, "scopes": ["wallet_topups"]}
    )
    assert response.status_code == 403


def test_scoped_grant_lets_a_non_owner_review_topups(client):
    # `other` has no access yet.
    assert client.get("/admin/topup-requests", headers=OTHER_HEADER).status_code == 403

    grant = client.post(
        "/admin/grants", headers=OWNER_HEADER, json={"telegram_id": 1002, "scopes": ["wallet_topups"]}
    )
    assert grant.status_code == 201

    assert client.get("/admin/topup-requests", headers=OTHER_HEADER).status_code == 200


def test_grant_requires_the_target_to_have_logged_in_at_least_once(client):
    response = client.post(
        "/admin/grants", headers=OWNER_HEADER, json={"telegram_id": 424242, "scopes": ["wallet_topups"]}
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


# --- /admin/me (never 403s, see app/admin/router.py) ------------------


def test_my_admin_access_reports_owner(client):
    response = client.get("/admin/me", headers=OWNER_HEADER)
    assert response.status_code == 200
    assert response.json() == {"is_owner": True, "scopes": []}


def test_my_admin_access_reports_no_access_for_a_plain_user(client):
    response = client.get("/admin/me", headers=BUYER_HEADER)
    assert response.status_code == 200
    assert response.json() == {"is_owner": False, "scopes": []}


def test_my_admin_access_reports_granted_scopes(client):
    client.get("/me", headers=OTHER_HEADER)  # so a User row for 1002 exists to grant to
    grant = client.post(
        "/admin/grants", headers=OWNER_HEADER, json={"telegram_id": 1002, "scopes": ["wallet_topups"]}
    )
    assert grant.status_code == 201
    response = client.get("/admin/me", headers=OTHER_HEADER)
    assert response.status_code == 200
    assert response.json() == {"is_owner": False, "scopes": ["wallet_topups"]}


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
