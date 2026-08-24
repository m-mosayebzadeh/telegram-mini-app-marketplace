from datetime import datetime

from pydantic import BaseModel


class BalanceOut(BaseModel):
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
