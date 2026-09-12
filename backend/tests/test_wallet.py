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
from app.models.credit_ledger import CreditLedgerEntry, LedgerEntryType
from app.models.offer import Offer, OfferServiceType, OfferStatus
from app.models.request import Request, RequestStatus
from app.models.transaction import Transaction, TransactionKind, TransactionStatus
from app.models.withdrawal import BankAccount, Withdrawal
from app.wallet.service import get_balance_toman, get_withdrawable_toman, split_commission
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
        "withdrawal_pending_toman": 0,
        "in_flight_toman": 0,
        "withdrawable_toman": 0,
    }


def test_balance_reflects_ledger_entries(client, db_session):
    auth = _auth_header(1, "Alice")
    alice = client.get("/me", headers=auth).json()
    give_wallet_balance(db_session, alice["id"], amount_toman=120_000)

    response = client.get("/wallet/balance", headers=auth).json()

    assert response["balance_toman"] == 120_000
    assert response["balance_stars_equivalent"] == 120_000 // settings.star_to_toman_rate


# --- what may leave the platform (get_withdrawable_toman) -------------------
#
# Only money EARNED here can be withdrawn: paying topped-up money back out to
# a bank card would turn the marketplace into a currency-exchange route, which
# is both a legal exposure and an obvious laundering path. The rule that makes
# the split computable is that spending drains topped-up money FIRST and only
# reaches earnings once the top-ups are gone — deliberately the version that
# favours the user, since their earnings stay withdrawable for as long as
# possible.


def _sale(db_session, provider_id: int, buyer_id: int, *, amount_toman: int) -> Transaction:
    """One completed sale between two users, at the model level.

    The ledger refuses a SPEND or RECEIVE row that is not attached to a real
    transaction, and a chat transaction needs a real request behind it, so the
    whole little chain has to exist even for an arithmetic test.
    """
    offer = Offer(
        provider_id=provider_id,
        service_type=OfferServiceType.CHAT,
        price_stars=10,
        display_duration_minutes=20,
        title="Test offer",
        description="Test offer",
        status=OfferStatus.ACTIVE,
    )
    db_session.add(offer)
    db_session.flush()
    request = Request(buyer_id=buyer_id, offer_id=offer.id, status=RequestStatus.ACCEPTED)
    db_session.add(request)
    db_session.flush()
    transaction = Transaction(
        kind=TransactionKind.CHAT_REQUEST,
        buyer_id=buyer_id,
        provider_id=provider_id,
        request_id=request.id,
        gross_price_stars=10,
        commission_rate_percent=0,
        commission_stars=0,
        net_provider_stars=10,
        star_to_toman_rate=amount_toman // 10,
        gross_price_toman=amount_toman,
        commission_toman=0,
        net_provider_toman=amount_toman,
        status=TransactionStatus.SUCCEEDED,
    )
    db_session.add(transaction)
    db_session.flush()
    return transaction


def _earn(db_session, provider_id: int, buyer_id: int, *, amount_toman: int) -> None:
    transaction = _sale(db_session, provider_id, buyer_id, amount_toman=amount_toman)
    db_session.add(
        CreditLedgerEntry(
            user_id=provider_id,
            amount_toman=amount_toman,
            type=LedgerEntryType.RECEIVE,
            transaction_id=transaction.id,
        )
    )
    db_session.commit()


def _spend(db_session, spender_id: int, provider_id: int, *, amount_toman: int) -> None:
    transaction = _sale(db_session, provider_id, spender_id, amount_toman=amount_toman)
    db_session.add(
        CreditLedgerEntry(
            user_id=spender_id,
            amount_toman=-amount_toman,
            type=LedgerEntryType.SPEND,
            transaction_id=transaction.id,
        )
    )
    db_session.commit()


def _queue_withdrawal(db_session, user_id: int, *, amount_toman: int) -> Withdrawal:
    """A withdrawal request and the hold it puts on the wallet."""
    bank = BankAccount(
        user_id=user_id,
        holder_name="Test Owner",
        card_number="6037991234567890",
        iban="IR123456789012345678901234",
    )
    db_session.add(bank)
    db_session.flush()
    withdrawal = Withdrawal(
        user_id=user_id,
        bank_account_id=bank.id,
        idempotency_key=f"test-{user_id}-{amount_toman}",
        holder_name=bank.holder_name,
        card_number=bank.card_number,
        iban=bank.iban,
        stars=amount_toman // 1000,
        star_rate=1000,
        fee_percent=0,
        minimum_toman=1,
        gross_toman=amount_toman,
        fee_toman=0,
        net_toman=amount_toman,
        status="pending",
    )
    db_session.add(withdrawal)
    db_session.flush()
    db_session.add(
        CreditLedgerEntry(
            user_id=user_id,
            amount_toman=-amount_toman,
            type=LedgerEntryType.WITHDRAWAL,
            withdrawal_id=withdrawal.id,
        )
    )
    db_session.commit()
    return withdrawal


def test_topped_up_money_is_spendable_but_never_withdrawable(client, db_session):
    alice = client.get("/me", headers=_auth_header(1, "Alice")).json()
    give_wallet_balance(db_session, alice["id"], amount_toman=500_000)

    assert get_balance_toman(db_session, alice["id"]) == 500_000
    assert get_withdrawable_toman(db_session, alice["id"]) == 0


def test_earnings_are_withdrawable(client, db_session):
    alice = client.get("/me", headers=_auth_header(1, "Alice")).json()
    bob = client.get("/me", headers=_auth_header(2, "Bob")).json()
    _earn(db_session, alice["id"], bob["id"], amount_toman=300_000)

    assert get_withdrawable_toman(db_session, alice["id"]) == 300_000


def test_spending_drains_topped_up_money_before_earnings(client, db_session):
    alice = client.get("/me", headers=_auth_header(1, "Alice")).json()
    bob = client.get("/me", headers=_auth_header(2, "Bob")).json()
    give_wallet_balance(db_session, alice["id"], amount_toman=100_000)
    _earn(db_session, alice["id"], bob["id"], amount_toman=90_000)

    # Spending within the top-up leaves every earned Toman withdrawable.
    _spend(db_session, alice["id"], bob["id"], amount_toman=50_000)
    assert get_withdrawable_toman(db_session, alice["id"]) == 90_000

    # Spending past it starts eating into the earnings, and from that point on
    # the ceiling tracks the spendable balance exactly.
    _spend(db_session, alice["id"], bob["id"], amount_toman=100_000)
    assert get_balance_toman(db_session, alice["id"]) == 40_000
    assert get_withdrawable_toman(db_session, alice["id"]) == 40_000


def test_a_queued_withdrawal_lowers_the_ceiling_and_a_refund_restores_it(client, db_session):
    alice = client.get("/me", headers=_auth_header(1, "Alice")).json()
    bob = client.get("/me", headers=_auth_header(2, "Bob")).json()
    _earn(db_session, alice["id"], bob["id"], amount_toman=300_000)

    withdrawal = _queue_withdrawal(db_session, alice["id"], amount_toman=200_000)
    assert get_withdrawable_toman(db_session, alice["id"]) == 100_000

    # A rejected or cancelled withdrawal releases its hold; the money was
    # always earned, so it becomes withdrawable again.
    db_session.add(
        CreditLedgerEntry(
            user_id=alice["id"],
            amount_toman=200_000,
            type=LedgerEntryType.WITHDRAWAL_REFUND,
            withdrawal_id=withdrawal.id,
        )
    )
    db_session.commit()
    assert get_withdrawable_toman(db_session, alice["id"]) == 300_000
