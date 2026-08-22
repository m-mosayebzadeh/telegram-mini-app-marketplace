"""
Request endpoints: create, list (buyer's own / incoming for an offer),
accept, reject.

Business rules from TECHNICAL_REQUIREMENTS.md section 4:
  - a buyer can't request their own offer
  - re-requesting the same offer while a live request already exists is
    idempotent (returns the existing one, no duplicate)
  - a provider can have at most ONE open accepted request in total,
    across every offer they have — not per offer
  - rejecting always requires a reason
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.core.database import get_db
from app.core.time import utcnow
from app.models.offer import Offer, OfferStatus
from app.models.request import Request, RequestStatus
from app.models.user import User
from app.request.schemas import RequestCreate, RequestOut, RequestReject

router = APIRouter(prefix="/requests", tags=["requests"])


def _has_open_accepted_request(db: Session, provider_id: int) -> bool:
    """Whether `provider_id` already has ANY accepted request, on ANY of
    their offers — the global one-open-chat-at-a-time rule."""
    return (
        db.query(Request)
        .join(Offer, Request.offer_id == Offer.id)
        .filter(Offer.provider_id == provider_id, Request.status == RequestStatus.ACCEPTED)
        .first()
        is not None
    )


def _get_incoming_request(db: Session, request_id: int, provider_id: int) -> Request:
    """Loads a request and confirms it's addressed to `provider_id` — used
    by accept/reject so only the actual provider can respond to it."""
    req = db.get(Request, request_id)
    if req is None or req.offer.provider_id != provider_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Request not found.")
    return req


@router.post("", response_model=RequestOut, status_code=status.HTTP_201_CREATED)
def create_request(
    payload: RequestCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Request:
    offer = db.get(Offer, payload.offer_id)
    if offer is None or offer.status != OfferStatus.ACTIVE:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Offer not found.")
    if offer.provider_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="You can't request your own offer."
        )

    existing = (
        db.query(Request)
        .filter(
            Request.buyer_id == current_user.id,
            Request.offer_id == offer.id,
            Request.status.in_([RequestStatus.PENDING, RequestStatus.ACCEPTED]),
        )
        .first()
    )
    if existing is not None:
        return existing

    new_request = Request(buyer_id=current_user.id, offer_id=offer.id)
    db.add(new_request)
    db.commit()
    db.refresh(new_request)
    return new_request


@router.get("/mine", response_model=list[RequestOut])
def list_my_requests(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[Request]:
    """Everything the current user has requested, as a buyer."""
    return db.query(Request).filter(Request.buyer_id == current_user.id).all()


@router.get("", response_model=list[RequestOut])
def list_requests_for_offer(
    offer_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[Request]:
    """Incoming requests for one of the current user's own offers."""
    offer = db.get(Offer, offer_id)
    if offer is None or offer.provider_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Offer not found.")
    return db.query(Request).filter(Request.offer_id == offer_id).all()


@router.post("/{request_id}/accept", response_model=RequestOut)
def accept_request(
    request_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Request:
    req = _get_incoming_request(db, request_id, current_user.id)
    if req.status != RequestStatus.PENDING:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Only a pending request can be accepted."
        )
    if _has_open_accepted_request(db, current_user.id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You already have an open accepted request — finish it before accepting another.",
        )

    req.status = RequestStatus.ACCEPTED
    req.responded_at = utcnow()
    db.commit()
    db.refresh(req)
    return req


@router.post("/{request_id}/reject", response_model=RequestOut)
def reject_request(
    request_id: int,
    payload: RequestReject,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Request:
    req = _get_incoming_request(db, request_id, current_user.id)
    if req.status != RequestStatus.PENDING:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Only a pending request can be rejected."
        )

    req.status = RequestStatus.REJECTED
    req.reason = payload.reason
    req.responded_at = utcnow()
    db.commit()
    db.refresh(req)
    return req
