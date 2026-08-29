"""
Admin-only endpoints: managing who else has admin access (owner-only),
and reviewing top-up requests (owner, or anyone granted the
"wallet_topups" scope — see app/auth/dependencies.py's require_admin).
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.admin.schemas import (
    AdminGrantCreate,
    AdminGrantOut,
    AdminTopUpRequestOut,
    MyAdminAccessOut,
    TopUpRequesterOut,
)
from app.auth.dependencies import get_current_user, is_owner, require_admin, require_owner
from app.core.database import get_db
from app.models.admin_grant import AdminGrant
from app.models.topup_request import TopUpRequest, TopUpStatus
from app.models.user import User
from app.topup.schemas import TopUpApproveIn, TopUpRejectIn
from app.core.time import utcnow
from app.wallet.service import credit_topup

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/me", response_model=MyAdminAccessOut)
def get_my_admin_access(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> MyAdminAccessOut:
    """
    Never 403s — this is the one admin route anyone can call, so the
    frontend has a cheap way to ask "should I even show admin UI to
    this person" without treating a plain 403 from a real admin route
    as the answer (see lib/adminApi.ts's isAdmin() on the frontend).
    """
    if is_owner(current_user):
        return MyAdminAccessOut(is_owner=True, scopes=[])
    grant = db.query(AdminGrant).filter(AdminGrant.user_id == current_user.id).first()
    return MyAdminAccessOut(is_owner=False, scopes=grant.scopes if grant else [])


def _grant_out(grant: AdminGrant, user: User) -> AdminGrantOut:
    return AdminGrantOut(
        id=grant.id,
        user_id=grant.user_id,
        display_name=user.display_name,
        username=user.username,
        scopes=grant.scopes,
        granted_by_user_id=grant.granted_by_user_id,
        created_at=grant.created_at,
    )


@router.get("/grants", response_model=list[AdminGrantOut])
def list_grants(
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
) -> list[AdminGrantOut]:
    grants = db.query(AdminGrant).all()
    return [_grant_out(g, db.get(User, g.user_id)) for g in grants]


@router.post("/grants", response_model=AdminGrantOut, status_code=status.HTTP_201_CREATED)
def create_grant(
    payload: AdminGrantCreate,
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
) -> AdminGrantOut:
    target = db.query(User).filter(User.telegram_id == payload.telegram_id).first()
    if target is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "No user found with that Telegram id — they need to open the app at least once first.",
        )

    existing = db.query(AdminGrant).filter(AdminGrant.user_id == target.id).first()
    if existing is not None:
        existing.scopes = payload.scopes
        db.commit()
        db.refresh(existing)
        return _grant_out(existing, target)

    grant = AdminGrant(user_id=target.id, scopes=payload.scopes, granted_by_user_id=current_user.id)
    db.add(grant)
    db.commit()
    db.refresh(grant)
    return _grant_out(grant, target)


@router.delete("/grants/{grant_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_grant(
    grant_id: int,
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
) -> None:
    grant = db.get(AdminGrant, grant_id)
    if grant is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Grant not found.")
    db.delete(grant)
    db.commit()


def _topup_out(topup_request: TopUpRequest, requester: User) -> AdminTopUpRequestOut:
    return AdminTopUpRequestOut(
        id=topup_request.id,
        requester=TopUpRequesterOut(
            user_id=requester.id, display_name=requester.display_name, username=requester.username
        ),
        requested_stars=topup_request.requested_stars,
        star_rate_at_request=topup_request.star_rate_at_request,
        requested_toman_amount=topup_request.requested_toman_amount,
        status=topup_request.status.value,
        final_toman_amount=topup_request.final_toman_amount,
        transaction_reference=topup_request.transaction_reference,
        rejection_reason=topup_request.rejection_reason,
        reviewed_by_user_id=topup_request.reviewed_by_user_id,
        reviewed_at=topup_request.reviewed_at,
        created_at=topup_request.created_at,
    )


@router.get("/topup-requests", response_model=list[AdminTopUpRequestOut])
def list_topup_requests(
    status_filter: str | None = None,
    current_user: User = Depends(require_admin("wallet_topups")),
    db: Session = Depends(get_db),
) -> list[AdminTopUpRequestOut]:
    """status_filter defaults to showing everything; pass e.g.
    ?status_filter=pending to narrow it — the review queue's default
    view, while approved/rejected stay available as history."""
    query = db.query(TopUpRequest)
    if status_filter:
        query = query.filter(TopUpRequest.status == TopUpStatus(status_filter))
    requests = query.order_by(TopUpRequest.created_at.desc()).all()
    return [_topup_out(r, db.get(User, r.user_id)) for r in requests]


def _get_pending_request(db: Session, request_id: int) -> TopUpRequest:
    topup_request = db.get(TopUpRequest, request_id)
    if topup_request is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Top-up request not found.")
    if topup_request.status != TopUpStatus.PENDING:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This request was already reviewed.")
    return topup_request


@router.post("/topup-requests/{request_id}/approve", response_model=AdminTopUpRequestOut)
def approve_topup_request(
    request_id: int,
    payload: TopUpApproveIn,
    current_user: User = Depends(require_admin("wallet_topups")),
    db: Session = Depends(get_db),
) -> AdminTopUpRequestOut:
    if payload.final_toman_amount <= 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "final_toman_amount must be positive.")

    topup_request = _get_pending_request(db, request_id)

    credit_topup(db, user_id=topup_request.user_id, amount_toman=payload.final_toman_amount)

    topup_request.status = TopUpStatus.APPROVED
    topup_request.final_toman_amount = payload.final_toman_amount
    topup_request.transaction_reference = payload.transaction_reference
    topup_request.reviewed_by_user_id = current_user.id
    topup_request.reviewed_at = utcnow()

    db.commit()
    db.refresh(topup_request)
    return _topup_out(topup_request, db.get(User, topup_request.user_id))


@router.post("/topup-requests/{request_id}/reject", response_model=AdminTopUpRequestOut)
def reject_topup_request(
    request_id: int,
    payload: TopUpRejectIn,
    current_user: User = Depends(require_admin("wallet_topups")),
    db: Session = Depends(get_db),
) -> AdminTopUpRequestOut:
    topup_request = _get_pending_request(db, request_id)

    topup_request.status = TopUpStatus.REJECTED
    topup_request.rejection_reason = payload.reason
    topup_request.reviewed_by_user_id = current_user.id
    topup_request.reviewed_at = utcnow()

    db.commit()
    db.refresh(topup_request)
    return _topup_out(topup_request, db.get(User, topup_request.user_id))
