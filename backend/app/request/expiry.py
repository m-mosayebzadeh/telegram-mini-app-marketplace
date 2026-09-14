"""
Letting offers and requests run out, without anything that ticks.

Both deadlines are checked at the moment somebody reads the thing, which is the
same lazy pattern the wallet uses to release due transactions and sessions use
to close themselves. Nothing runs in the background, and the state is simply
correct whenever it is next looked at.

The two are read from the rates row rather than fixed in code: the right
numbers are a judgement about how busy the market is, which will change.
"""
from datetime import timedelta

from sqlalchemy.orm import Session

from app.core.rates import get_rates
from app.core.time import utcnow
from app.models.offer import Offer, OfferStatus
from app.models.request import EXPIRED_REASON, Request, RequestStatus


def offer_expires_at(offer: Offer, expiry_days: int):
    """A listing goes stale: an offer from somebody who has since left is worse
    than no offer at all, because a buyer spends a request finding out."""
    return offer.created_at + timedelta(days=expiry_days)


def expire_offer_if_due(db: Session, offer: Offer) -> Offer:
    """Takes a stale offer off the market. It is not deleted — the provider can
    put it back with one tap, and its requests still point at it."""
    if offer.status != OfferStatus.ACTIVE or offer.deleted_at is not None:
        return offer
    if utcnow() < offer_expires_at(offer, get_rates(db).offer_expiry_days):
        return offer

    offer.status = OfferStatus.INACTIVE
    db.commit()
    db.refresh(offer)
    return offer


def expire_requests_if_due(db: Session, requests: list[Request]) -> None:
    """
    Closes requests nobody answered in time.

    A request left pending forever is worse than a rejected one: it holds the
    buyer's one-live-request-per-provider slot and tells them nothing. Cancelled
    with its own reason, so "nobody answered" stays tellable apart from "they
    said no" and from "I changed my mind" — which is what the buyer's trust
    summary depends on.
    """
    if not requests:
        return
    deadline = utcnow() - timedelta(hours=get_rates(db).request_expiry_hours)
    changed = False
    for request in requests:
        if request.status != RequestStatus.PENDING or request.created_at > deadline:
            continue
        request.status = RequestStatus.CANCELLED
        request.reason = EXPIRED_REASON
        request.responded_at = utcnow()
        changed = True
    if changed:
        db.commit()
