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
from app.models.chat_session import ChatSession
from app.models.request import EXPIRED_REASON, UNPAID_REASON, Request, RequestStatus


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


def pay_by(request: Request, window_minutes: int):
    """When a confirmed request stops waiting for its payment.

    Counted from the moment the offerer confirmed (responded_at), which is
    the moment the requester was told they could pay.
    """
    if request.responded_at is None:
        return None
    return request.responded_at + timedelta(minutes=window_minutes)


def unpaid(db: Session, request: Request) -> bool:
    """Confirmed and not yet paid: there is no session behind it."""
    return (
        request.status == RequestStatus.ACCEPTED
        and db.query(ChatSession.id).filter(ChatSession.request_id == request.id).first() is None
    )


def expire_unpaid_if_due(db: Session, requests: list[Request]) -> list[Request]:
    """
    Closes confirmed requests that were not paid in time, and returns them.

    Without this a requester who never pays would hold the offerer's one open
    slot for ever — which is exactly what an owner's test ran into: a request
    confirmed two hours earlier and never paid refused every new confirmation.

    Lazy like everything else here: checked when somebody reads, never by
    something ticking. The apps count down to the same deadline and read again
    the moment it passes, so in practice it closes on time. The requests that
    closed are handed back so the caller can tell both people at once.
    """
    if not requests:
        return []
    window = get_rates(db).start_window_minutes
    now = utcnow()
    closed: list[Request] = []
    for request in requests:
        if request.status != RequestStatus.ACCEPTED:
            continue
        deadline = pay_by(request, window)
        if deadline is None or now < deadline or not unpaid(db, request):
            continue
        request.status = RequestStatus.CANCELLED
        request.reason = UNPAID_REASON
        # When it actually ran out, not when somebody happened to look.
        request.responded_at = deadline
        closed.append(request)
    if closed:
        db.commit()
    return closed


def sweep(db: Session, requests: list[Request]) -> list[Request]:
    """Both lazy deadlines at once: unanswered requests and unpaid ones.
    Returns the ones that closed for not being paid, to be announced."""
    expire_requests_if_due(db, requests)
    return expire_unpaid_if_due(db, requests)
