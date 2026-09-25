from datetime import datetime

from pydantic import BaseModel


class BalanceOut(BaseModel):
    withdrawal_pending_toman: int = 0
    # Spendable right now — the sum of this user's own ledger entries.
    balance_toman: int
    # A display-only figure ("about how many Photons can I spend right
    # now"), computed with floor division. Never used to decide whether a
    # charge succeeds -- every real charge is computed from the priced
    # item's own Photon amount (see app/wallet/service.py), not from this.
    balance_photons_equivalent: int
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
    gross_price_photons: int
    commission_rate_percent: int
    commission_photons: int
    net_provider_photons: int
    photon_to_toman_rate: int
    gross_price_toman: int
    commission_toman: int
    net_provider_toman: int
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


class WalletHistoryOut(BaseModel):
    """One thing that happened to this wallet.

    Deliberately says nothing about who was on the other side: a list that
    reads "25 Photons from Sara" is a problem the moment someone glances at the
    screen. What it was about is here, because a history that cannot be checked
    against anything is not a history; who it was with is one tap away, on the
    thing itself.
    """

    #: top_up | withdrawal | withdrawal_refund | chat_earning | chat_payment |
    #: content_sale | content_purchase
    kind: str
    #: in_progress | awaiting_settlement | disputed | settled — anything but
    #: the last can still change, which is why it is shown at all.
    status: str
    #: Positive came in, negative went out.
    amount_photons: int
    amount_toman: int
    at: datetime
    #: An offer's title, when there is one. Never a person's name.
    subject: str | None
    #: Where tapping this row leads, when it leads anywhere. Both None for a
    #: top-up or a withdrawal, and for content the seller has deleted — which
    #: they can no longer open.
    chat_session_id: int | None
    content_id: int | None
