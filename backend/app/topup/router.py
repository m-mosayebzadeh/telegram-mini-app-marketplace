"""
User-facing top-up endpoints: the destination card info, submitting a
new card-to-card request, listing your own history, and fetching a
receipt's bytes (access-checked — see save_receipt_file's docstring).

The admin side (reviewing/approving/rejecting someone else's request)
lives in app/admin/router.py instead — kept separate so this file's
routes are all "things a normal user can do," matching the pattern
already used elsewhere (e.g. app/profile/router.py's router vs
public_router split).
"""

import secrets

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.auth.dependencies import effective_admin_scopes, get_current_user, is_owner
from app.core.config import settings
from app.core.database import get_db
from app.core.rates import get_rates
from app.core.storage import save_receipt_file
from app.models.star_purchase import StarPurchase
from app.models.topup_request import TopUpRequest
from app.models.user import User
from app.telegram_bot import create_star_invoice_link
from app.topup.schemas import StarInvoiceCreate, StarInvoiceOut, TopUpCardInfoOut, TopUpRequestOut

router = APIRouter(prefix="/topup", tags=["topup"])


@router.get("/card-info", response_model=TopUpCardInfoOut)
def get_card_info(
    current_user: User = Depends(get_current_user),  # requires auth; not otherwise used
) -> TopUpCardInfoOut:
    return TopUpCardInfoOut(
        card_number=settings.topup_card_number,
        card_holder_name=settings.topup_card_holder_name,
    )


@router.post("/stars/invoice", response_model=StarInvoiceOut, status_code=status.HTTP_201_CREATED)
def create_star_invoice(
    payload: StarInvoiceCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> StarInvoiceOut:
    """
    Starts a real Telegram Stars purchase: records a PENDING
    StarPurchase row, asks Telegram for a one-time invoice link for it,
    and hands that link back to the frontend to open with
    Telegram.WebApp.openInvoice(). Nothing is credited yet — that only
    happens once app/telegram_webhook/router.py sees Telegram's own
    successful_payment confirmation for this exact invoice_payload.
    """
    if payload.stars <= 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "stars must be positive.")

    # Random and unguessable — this is the one thing tying an incoming
    # webhook payment back to this specific purchase/user, so it must
    # never be something an attacker could predict or reuse.
    invoice_payload = secrets.token_urlsafe(24)

    purchase = StarPurchase(user_id=current_user.id, stars=payload.stars, invoice_payload=invoice_payload)
    db.add(purchase)
    db.commit()

    invoice_link = create_star_invoice_link(
        title="Wallet top-up",
        description=f"{payload.stars} Telegram Stars",
        payload=invoice_payload,
        stars=payload.stars,
    )
    return StarInvoiceOut(invoice_link=invoice_link, purchase_id=purchase.id)


@router.post("/requests", response_model=TopUpRequestOut, status_code=status.HTTP_201_CREATED)
def create_topup_request(
    file: UploadFile = File(...),
    requested_stars: int = Form(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TopUpRequest:
    """
    Submits a new card-to-card top-up request — the rate is frozen
    RIGHT NOW (see TopUpRequest's docstring), not re-read later, so a
    rate change between submission and admin review never silently
    changes what the user thought they were asking for.
    """
    if requested_stars <= 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "requested_stars must be positive.")

    receipt_path = save_receipt_file(current_user.id, file)
    rate = get_rates(db).star_to_toman_rate

    topup_request = TopUpRequest(
        user_id=current_user.id,
        receipt_file_path=receipt_path,
        requested_stars=requested_stars,
        star_rate_at_request=rate,
        requested_toman_amount=requested_stars * rate,
    )
    db.add(topup_request)
    db.commit()
    db.refresh(topup_request)
    return topup_request


@router.get("/requests/mine", response_model=list[TopUpRequestOut])
def list_my_topup_requests(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[TopUpRequest]:
    return (
        db.query(TopUpRequest)
        .filter(TopUpRequest.user_id == current_user.id)
        .order_by(TopUpRequest.created_at.desc())
        .all()
    )


def _can_view_receipt(db: Session, viewer: User, topup_request: TopUpRequest) -> bool:
    if viewer.id == topup_request.user_id:
        return True
    if is_owner(viewer):
        return True
    return "finance.topups" in effective_admin_scopes(db, viewer.id)


@router.get("/requests/{request_id}/receipt")
def get_topup_receipt(
    request_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FileResponse:
    topup_request = db.get(TopUpRequest, request_id)
    if topup_request is None or not _can_view_receipt(db, current_user, topup_request):
        # 404, not 403 — same "don't even confirm this id exists to
        # someone who shouldn't see it" instinct used everywhere else
        # (see app/content/router.py's _get_visible_content).
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Top-up request not found.")
    return FileResponse(topup_request.receipt_file_path)


@router.get('/stars/purchases/{purchase_id}')
def star_purchase_status(purchase_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    from app.models.credit_ledger import CreditLedgerEntry
    purchase = db.get(StarPurchase, purchase_id)
    if not purchase or purchase.user_id != current_user.id:
        raise HTTPException(404, 'Purchase not found.')
    entry = db.query(CreditLedgerEntry).filter_by(star_purchase_id=purchase.id).first()
    return {'id': purchase.id, 'status': purchase.status.value, 'credited_toman': entry.amount_toman if entry else None}
