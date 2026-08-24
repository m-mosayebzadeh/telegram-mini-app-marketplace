"""
Tests for the wallet: split_commission()'s rounding rule (unit-level,
since it's pure arithmetic with no database involved), plus the balance
endpoint (integration-level, since "what's my balance" only means
something once there's a real user, and possibly some ledger entries,
behind it).

The full charge/pay flow (a real Transaction plus its three ledger
entries) is exercised in test_request_payment.py and
test_content_endpoints.py, against a real buyer/provider/priced item.
"""

import pytest

from app.core.config import settings
from app.wallet.service import split_commission
from tests.helpers import give_wallet_balance, sign_init_data


def _auth_header(telegram_id: int, first_name: str = "Test") -> dict:
    return {"X-Telegram-Init-Data": sign_init_data({"id": telegram_id, "first_name": first_name})}


# --- split_commission() ----------------------------------------------------


@pytest.mark.parametrize(
    "gross_stars,commission_percent,expected_commission,expected_net",
    [
        (40, 10, 4, 36),  # divides evenly
        (25, 10, 2, 23),  # 2.5 -> rounds DOWN; the extra half-star goes to the provider
        (100, 5, 5, 95),  # the content commission rate
        (1, 10, 0, 1),  # smallest possible price: commission floors to 0
        (0, 10, 0, 0),  # degenerate, but shouldn't raise
    ],
)
def test_split_commission_rounds_in_providers_favor(
    gross_stars, commission_percent, expected_commission, expected_net
):
    commission_stars, net_provider_stars = split_commission(gross_stars, commission_percent)

    assert commission_stars == expected_commission
    assert net_provider_stars == expected_net
    # The split must always account for the whole price, no matter how
    # the rounding falls -- the same invariant Transaction's
    # ck_star_split_sums_to_gross CHECK constraint enforces at the
    # database level.
    assert commission_stars + net_provider_stars == gross_stars


# --- GET /wallet/balance ----------------------------------------------------


def test_balance_is_zero_for_a_brand_new_user(client):
    auth = _auth_header(1, "Alice")
    client.get("/me", headers=auth)  # creates the User row, no ledger entries yet

    response = client.get("/wallet/balance", headers=auth)

    assert response.status_code == 200
    assert response.json() == {
        "balance_toman": 0,
        "balance_stars_equivalent": 0,
        "pending_toman": 0,
    }


def test_balance_reflects_ledger_entries(client, db_session):
    auth = _auth_header(1, "Alice")
    alice = client.get("/me", headers=auth).json()
    give_wallet_balance(db_session, alice["id"], amount_toman=120_000)

    response = client.get("/wallet/balance", headers=auth).json()

    assert response["balance_toman"] == 120_000
    assert response["balance_stars_equivalent"] == 120_000 // settings.star_to_toman_rate
