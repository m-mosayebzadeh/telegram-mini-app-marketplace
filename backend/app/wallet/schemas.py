from datetime import datetime

from pydantic import BaseModel


class BalanceOut(BaseModel):
    withdrawal_pending_toman: int = 0
    # Spendable right now — the sum of this user's own ledger entries.
    balance_toman: int
    # A display-only estimate ("about how many Stars can I spend right
    # now"), computed with floor division. Never used to decide whether
    # a charge succeeds — every real charge is computed from the priced
    # item's own Star amount (see app/wallet/service.py), not from this.
    balance_stars_equivalent: int
    # Earned as a provider from CHAT_REQUEST transactions, but not yet
    # spendable — held until the paid-for chat session closes cleanly
    # (see release_transaction() in app/wallet/service.py). Always 0
    # today, since nothing releases a transaction yet; shown anyway so
    # the field exists ahead of chat sessions landing.
    pending_toman: int
    # Everything that exists but is not available right now, as one number:
    # a buyer's payment for a chat still in progress, a provider's earnings
    # inside the release grace period, and any withdrawal already queued.
    # The wallet screen deliberately shows this instead of four separate
    # figures — the distinctions matter to us, not to the person looking.
    in_flight_toman: int = 0
    # The part of the balance that may be paid out to a bank account: only
    # what was earned here, never what was topped up (see
    # get_withdrawable_toman() for the full rule). Surfaced for the withdraw
    # screen, which is the only place the number is actionable.
    withdrawable_toman: int = 0


class TransactionOut(BaseModel):
    id: int
    kind: str
    buyer_id: int
    provider_id: int
    request_id: int | None
    content_id: int | None
    gross_price_stars: int
    commission_rate_percent: int
    commission_stars: int
    net_provider_stars: int
    star_to_toman_rate: int
    gross_price_toman: int
    commission_toman: int
    net_provider_toman: int
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}
