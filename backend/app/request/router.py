"""
Request endpoints: create, list (buyer's own / incoming for an offer),
accept, reject.

Business rules from TECHNICAL_REQUIREMENTS.md section 4:
  - a buyer can't request their own offer
  - a buyer can only have ONE live (pending/accepted) request to a given
    PROVIDER at a time — across every offer that provider has, not per
    offer. Re-requesting the exact same offer while it's still live is
    idempotent (returns the existing one); requesting a DIFFERENT offer
    from the same provider while one is already live is rejected.
  - a provider can have at most ONE open accepted request in total,
    across every offer they have — not per offer
  - rejecting always requires a reason
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.core.database import get_db
from app.core.rates import get_rates
from app.core.time import utcnow
from app.models.chat_session import ChatSession, ChatSessionStatus
from app.models.offer import Offer, OfferStatus
from app.models.request import Request, RequestStatus
from app.models.transaction import Transaction, TransactionKind
from app.models.user import User
from app.request.schemas import RequestActivityOut, RequestCreate, RequestOut, RequestReject
from app.wallet.schemas import TransactionOut
from app.wallet.service import InsufficientBalanceError, pay_for_item

router = APIRouter(prefix="/requests", tags=["requests"])


def _is_request_still_live(db: Session, request: Request) -> bool:
    """
    PENDING is always live. ACCEPTED is only live until its chat session
    closes — Request.status stays "accepted" forever afterwards, as a
    historical record (see app/models/chat_session.py's docstring), so
    without checking the session too, a provider's very first accepted
    request would block every future accept forever, and a buyer could
    never request that same provider again either. Same refinement as
    app/offer/router.py's _has_unfinished_accepted_request.
    """
    if request.status == RequestStatus.PENDING:
        return True
    if request.status != RequestStatus.ACCEPTED:
        return False
    session = db.query(ChatSession).filter(ChatSession.request_id == request.id).first()
    return session is None or session.status == ChatSessionStatus.OPEN


def _live_request_with_provider(db: Session, buyer_id: int, provider_id: int) -> Request | None:
    """
    The buyer's current pending/accepted-and-not-yet-finished request
    against ANY of provider_id's offers, if any — a buyer can only have
    one live request per provider at a time (see module docstring).
    Joins through Offer because Request only stores offer_id, not
    provider_id directly (the provider is always reached via
    request.offer.provider_id).
    """
    candidates = (
        db.query(Request)
        .join(Offer, Request.offer_id == Offer.id)
        .filter(
            Request.buyer_id == buyer_id,
            Offer.provider_id == provider_id,
            Request.status.in_([RequestStatus.PENDING, RequestStatus.ACCEPTED]),
        )
        .all()
    )
    return next((r for r in candidates if _is_request_still_live(db, r)), None)


def _has_open_accepted_request(db: Session, provider_id: int) -> bool:
    """Whether `provider_id` already has an accepted-and-not-yet-finished
    request, on ANY of their offers — the global one-open-chat-at-a-time
    rule."""
    accepted_requests = (
        db.query(Request)
        .join(Offer, Request.offer_id == Offer.id)
        .filter(Offer.provider_id == provider_id, Request.status == RequestStatus.ACCEPTED)
        .all()
    )
    return any(_is_request_still_live(db, r) for r in accepted_requests)


def _get_incoming_request(db: Session, request_id: int, provider_id: int) -> Request:
    """Loads a request and confirms it's addressed to `provider_id` — used
    by accept/reject so only the actual provider can respond to it."""
    req = db.get(Request, request_id)
    if req is None or req.offer.provider_id != provider_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Request not found.")
    return req


def _get_buyers_request(db: Session, request_id: int, buyer_id: int) -> Request:
    """Loads a request and confirms `buyer_id` is the one who made it —
    used by pay, so only the actual buyer can pay for their own request."""
    req = db.get(Request, request_id)
    if req is None or req.buyer_id != buyer_id:
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

    existing = _live_request_with_provider(db, current_user.id, offer.provider_id)
    if existing is not None:
        if existing.offer_id == offer.id:
            # Re-requesting the exact same offer: idempotent, no duplicate.
            return existing
        # A live request on a DIFFERENT offer from the same provider:
        # blocked, not silently redirected — a buyer only gets one live
        # conversation-in-progress per provider.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You already have a pending or accepted request with this provider "
            "(on a different offer). Wait for it to be resolved before requesting another.",
        )

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


@router.get("/activity", response_model=list[RequestActivityOut])
def list_activity_requests(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[RequestActivityOut]:
    """
    The Activity tab's unified Requests feed: everything the current
    user is part of, either sent (as buyer) or received (as provider on
    one of their own offers), together, newest first. Separate from
    /mine (kept as-is for existing buyer-only screens) since this one
    needs the join through Offer to also catch received requests, plus
    the denormalized fields RequestActivityOut adds.
    """
    rows = (
        db.query(Request, Offer)
        .join(Offer, Request.offer_id == Offer.id)
        .filter(or_(Request.buyer_id == current_user.id, Offer.provider_id == current_user.id))
        .order_by(Request.created_at.desc())
        .all()
    )

    out: list[RequestActivityOut] = []
    for request, offer in rows:
        sent = request.buyer_id == current_user.id
        counterpart_id = offer.provider_id if sent else request.buyer_id
        counterpart = db.get(User, counterpart_id)
        out.append(
            RequestActivityOut(
                id=request.id,
                offer_id=offer.id,
                offer_title=offer.title,
                status=request.status.value,
                reason=request.reason,
                created_at=request.created_at,
                responded_at=request.responded_at,
                direction="sent" if sent else "received",
                counterpart_user_id=counterpart_id,
                counterpart_display_name=counterpart.display_name if counterpart else "",
            )
        )
    return out


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


@router.post("/{request_id}/pay", response_model=TransactionOut, status_code=status.HTTP_201_CREATED)
def pay_for_request(
    request_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Transaction:
    """
    The buyer's payment step — only reachable after the provider has
    accepted (TECHNICAL_REQUIREMENTS.md: payment always comes after
    acceptance, never before; there's no way to reach this endpoint from
    a PENDING request). Charges the buyer's wallet and pays the provider
    their net share via app/wallet/service.py — see
    TECHNICAL_REQUIREMENTS.md, "مدل مالی و اعتبار" for the full design.

    Also opens the ChatSession this payment is for, right here — never a
    separate action, so a paid request can never end up without one (see
    app/models/chat_session.py).
    """
    req = _get_buyers_request(db, request_id, current_user.id)
    if req.status != RequestStatus.ACCEPTED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only an accepted request can be paid for.",
        )

    already_paid = (
        db.query(Transaction)
        .filter(
            Transaction.kind == TransactionKind.CHAT_REQUEST,
            Transaction.request_id == req.id,
        )
        .first()
    )
    if already_paid is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This request has already been paid for.",
        )

    try:
        transaction = pay_for_item(
            db,
            kind=TransactionKind.CHAT_REQUEST,
            buyer_id=current_user.id,
            provider_id=req.offer.provider_id,
            gross_price_stars=req.offer.price_stars,
            commission_rate_percent=get_rates(db).chat_commission_percent,
            request_id=req.id,
        )
    except InsufficientBalanceError as exc:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail={
                "reason": "insufficient_balance",
                "needed_toman": exc.needed_toman,
                "available_toman": exc.available_toman,
            },
        ) from exc

    # pay_for_item() already flushed, so transaction.id is set here.
    db.add(ChatSession(request_id=req.id, transaction_id=transaction.id))

    db.commit()
    db.refresh(transaction)
    return transaction
