"""
Offer endpoints: create/get/list/update/activate/deactivate/delete.

Every business rule here comes straight from TECHNICAL_REQUIREMENTS.md
section 4:
  - at most MAX_ACTIVE_OFFERS_PER_USER offers with status ACTIVE per user
  - fully locked from editing once it has any live (pending/accepted)
    request — not just its price/duration
  - can't be deleted while it has an ACCEPTED request that's still
    unfinished (unpaid, or paid with its chat session still OPEN);
    deleting cancels any PENDING ones instead of leaving them dangling
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.core.database import get_db
from app.core.time import utcnow
from app.models.chat_session import ChatSession, ChatSessionStatus
from app.models.offer import Offer, OfferStatus
from app.models.request import OFFER_DELETED_REASON, Request, RequestStatus
from app.models.user import User
from app.offer.schemas import OfferCreate, OfferOut, OfferUpdate

router = APIRouter(prefix="/offers", tags=["offers"])

MAX_ACTIVE_OFFERS_PER_USER = 5


def _count_active_offers(db: Session, provider_id: int) -> int:
    return (
        db.query(Offer)
        .filter(Offer.provider_id == provider_id, Offer.status == OfferStatus.ACTIVE)
        .count()
    )


def _has_live_request(db: Session, offer_id: int) -> bool:
    """A request that's still unresolved — blocks editing (see module docstring)."""
    return (
        db.query(Request)
        .filter(
            Request.offer_id == offer_id,
            Request.status.in_([RequestStatus.PENDING, RequestStatus.ACCEPTED]),
        )
        .first()
        is not None
    )


def _has_unfinished_accepted_request(db: Session, offer_id: int) -> bool:
    """
    The refined delete-lock TECHNICAL_REQUIREMENTS.md section 4 already
    previewed once chat sessions existed: an ACCEPTED request only
    blocks deletion while it's still "in flight" — either not yet paid
    (no ChatSession exists for it yet) or paid and its session is still
    OPEN. Once that session is CLOSED, the request stays ACCEPTED forever
    as a historical record, but no longer blocks anything.
    """
    accepted_requests = (
        db.query(Request)
        .filter(Request.offer_id == offer_id, Request.status == RequestStatus.ACCEPTED)
        .all()
    )
    for request in accepted_requests:
        session = db.query(ChatSession).filter(ChatSession.request_id == request.id).first()
        if session is None or session.status == ChatSessionStatus.OPEN:
            return True
    return False


def _get_owned_offer(db: Session, offer_id: int, owner_id: int) -> Offer:
    offer = db.get(Offer, offer_id)
    if offer is None or offer.provider_id != owner_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Offer not found.")
    return offer


@router.post("", response_model=OfferOut, status_code=status.HTTP_201_CREATED)
def create_offer(
    payload: OfferCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Offer:
    if _count_active_offers(db, current_user.id) >= MAX_ACTIVE_OFFERS_PER_USER:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"You can have at most {MAX_ACTIVE_OFFERS_PER_USER} active offers at a time.",
        )

    offer = Offer(
        provider_id=current_user.id,
        price_stars=payload.price_stars,
        display_duration_minutes=payload.display_duration_minutes,
        description=payload.description,
    )
    db.add(offer)
    db.commit()
    db.refresh(offer)
    return offer


@router.get("/{offer_id}", response_model=OfferOut)
def get_offer(
    offer_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Offer:
    offer = db.get(Offer, offer_id)
    is_owner = offer is not None and offer.provider_id == current_user.id
    # Non-owners can't see an offer that's been taken off the market —
    # 404, not a "status: inactive" response, so it disappears the same
    # way a deleted offer would.
    if offer is None or (offer.status != OfferStatus.ACTIVE and not is_owner):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Offer not found.")
    return offer


@router.get("", response_model=list[OfferOut])
def list_offers(
    provider_id: int | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[Offer]:
    """
    Two modes, chosen by whether provider_id is given:

    - provider_id given: that one provider's offers. ACTIVE only, unless
      the caller IS that provider, who also sees their own INACTIVE ones
      (e.g. to manage their own listings).
    - provider_id omitted: marketplace-wide discovery — every ACTIVE
      offer from every provider. This is the "Customer Discovery" browse
      view (TECHNICAL_REQUIREMENTS.md) that was missing until now; a
      buyer had no way to find offers without already knowing a specific
      provider_id. Never includes INACTIVE offers here, even the
      caller's own — browse those via provider_id=<your own id> instead.
    """
    query = db.query(Offer).filter(Offer.status == OfferStatus.ACTIVE)
    if provider_id is not None:
        query = query.filter(Offer.provider_id == provider_id)
        if provider_id == current_user.id:
            # Drop the ACTIVE-only filter for your own listing so you
            # can see (and manage) your own INACTIVE offers too.
            query = db.query(Offer).filter(Offer.provider_id == provider_id)
    return query.all()


@router.patch("/{offer_id}", response_model=OfferOut)
def update_offer(
    offer_id: int,
    payload: OfferUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Offer:
    offer = _get_owned_offer(db, offer_id, current_user.id)
    if _has_live_request(db, offer.id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This offer has a pending or accepted request and can no longer be edited. "
            "Delete it and create a new offer instead.",
        )

    if payload.price_stars is not None:
        offer.price_stars = payload.price_stars
    if payload.display_duration_minutes is not None:
        offer.display_duration_minutes = payload.display_duration_minutes
    if payload.description is not None:
        offer.description = payload.description

    db.commit()
    db.refresh(offer)
    return offer


@router.post("/{offer_id}/activate", response_model=OfferOut)
def activate_offer(
    offer_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Offer:
    offer = _get_owned_offer(db, offer_id, current_user.id)
    if offer.status == OfferStatus.ACTIVE:
        return offer  # already active — idempotent, not an error

    if _count_active_offers(db, current_user.id) >= MAX_ACTIVE_OFFERS_PER_USER:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"You can have at most {MAX_ACTIVE_OFFERS_PER_USER} active offers at a time.",
        )

    offer.status = OfferStatus.ACTIVE
    db.commit()
    db.refresh(offer)
    return offer


@router.post("/{offer_id}/deactivate", response_model=OfferOut)
def deactivate_offer(
    offer_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Offer:
    offer = _get_owned_offer(db, offer_id, current_user.id)
    offer.status = OfferStatus.INACTIVE
    db.commit()
    db.refresh(offer)
    return offer


@router.delete("/{offer_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_offer(
    offer_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    offer = _get_owned_offer(db, offer_id, current_user.id)

    if _has_unfinished_accepted_request(db, offer.id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This offer has an accepted request whose chat session is still open "
            "(or not yet paid for) and can't be deleted yet.",
        )

    pending_requests = (
        db.query(Request)
        .filter(Request.offer_id == offer.id, Request.status == RequestStatus.PENDING)
        .all()
    )
    for pending in pending_requests:
        pending.status = RequestStatus.CANCELLED
        pending.reason = OFFER_DELETED_REASON
        pending.responded_at = utcnow()

    db.delete(offer)
    db.commit()
