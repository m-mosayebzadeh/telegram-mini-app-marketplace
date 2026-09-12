"""
Admin-only endpoints:
  - roles & who holds them ("دستیاران" — owner-only)
  - reviewing top-up requests, and reading/editing platform rates
    (owner, or anyone granted the matching scope)
  - browsing/moderating any user's own offers/content/requests/chat
    sessions/transactions, and blocking/unblocking them ("کاربران" —
    owner-only for now, same as role management; see
    TECHNICAL_REQUIREMENTS.md)
"""

from app.core.rates import lock_finances
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.admin.schemas import (
    AdminChatSessionOut,
    AdminTopUpRequestOut,
    AdminUserDetailOut,
    AdminUserSummaryOut,
    MyAdminAccessOut,
    PlatformRatesOut,
    PlatformRatesUpdate,
    RoleAssign,
    RoleCreate,
    RoleOut,
    RoleUpdate,
    TopUpRequesterOut,
    UserRoleOut,
)
from app.auth.dependencies import effective_admin_scopes, get_current_user, is_owner, require_admin, require_owner
from app.content.schemas import ContentOut
from app.core.database import get_db
from app.core.rates import get_rates
from app.core.storage import delete_content_file
from app.core.time import utcnow
from app.models.admin_grant import AdminGrant
from app.models.chat_session import ChatSession
from app.models.content import Content
from app.models.like import Like
from app.models.offer import Offer
from app.models.request import Request, RequestStatus, OFFER_DELETED_REASON
from app.models.role import Role
from app.models.topup_request import TopUpRequest, TopUpStatus
from app.models.transaction import Transaction
from app.models.user import User, UserStatus
from app.offer.router import _has_unfinished_accepted_request
from app.offer.schemas import OfferOut
from app.profile.photos import get_current_avatar_url
from app.request.schemas import RequestActivityOut
from app.topup.schemas import TopUpApproveIn, TopUpRejectIn
from app.wallet.schemas import TransactionOut
from app.wallet.service import credit_topup, get_balance_toman, get_pending_provider_toman

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
    return MyAdminAccessOut(is_owner=False, scopes=sorted(effective_admin_scopes(db, current_user.id)))


# --- roles ("نقش و دسترسی") -------------------------------------------------


def _role_out(db: Session, role: Role) -> RoleOut:
    member_count = db.query(AdminGrant).filter(AdminGrant.role_id == role.id).count()
    return RoleOut(
        id=role.id,
        name=role.name,
        scopes=role.scopes,
        is_active=role.is_active,
        created_at=role.created_at,
        member_count=member_count,
    )


@router.get("/roles", response_model=list[RoleOut])
def list_roles(current_user: User = Depends(require_owner), db: Session = Depends(get_db)) -> list[RoleOut]:
    roles = db.query(Role).order_by(Role.created_at.desc()).all()
    return [_role_out(db, r) for r in roles]


@router.post("/roles", response_model=RoleOut, status_code=status.HTTP_201_CREATED)
def create_role(
    payload: RoleCreate, current_user: User = Depends(require_owner), db: Session = Depends(get_db)
) -> RoleOut:
    if db.query(Role).filter(Role.name == payload.name).first() is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "A role with this name already exists.")
    role = Role(name=payload.name, scopes=payload.scopes)
    db.add(role)
    db.commit()
    db.refresh(role)
    return _role_out(db, role)


def _get_role(db: Session, role_id: int) -> Role:
    role = db.get(Role, role_id)
    if role is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Role not found.")
    return role


@router.get("/roles/{role_id}", response_model=RoleOut)
def get_role(
    role_id: int, current_user: User = Depends(require_owner), db: Session = Depends(get_db)
) -> RoleOut:
    return _role_out(db, _get_role(db, role_id))


@router.patch("/roles/{role_id}", response_model=RoleOut)
def update_role(
    role_id: int,
    payload: RoleUpdate,
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
) -> RoleOut:
    role = _get_role(db, role_id)
    if payload.name is not None and payload.name != role.name:
        if db.query(Role).filter(Role.name == payload.name, Role.id != role_id).first() is not None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "A role with this name already exists.")
        role.name = payload.name
    if payload.scopes is not None:
        role.scopes = payload.scopes
    db.commit()
    db.refresh(role)
    return _role_out(db, role)


@router.post("/roles/{role_id}/activate", response_model=RoleOut)
def activate_role(
    role_id: int, current_user: User = Depends(require_owner), db: Session = Depends(get_db)
) -> RoleOut:
    role = _get_role(db, role_id)
    role.is_active = True
    db.commit()
    db.refresh(role)
    return _role_out(db, role)


@router.post("/roles/{role_id}/deactivate", response_model=RoleOut)
def deactivate_role(
    role_id: int, current_user: User = Depends(require_owner), db: Session = Depends(get_db)
) -> RoleOut:
    """
    A soft toggle: the role row and everyone's assignment to it stay
    exactly as they are — only its scopes stop counting for
    effective_admin_scopes() while it's inactive (see
    app/auth/dependencies.py). Reactivating it later restores every
    current holder's access without anyone needing to be re-assigned.
    """
    role = _get_role(db, role_id)
    role.is_active = False
    db.commit()
    db.refresh(role)
    return _role_out(db, role)


@router.delete("/roles/{role_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_role(
    role_id: int, current_user: User = Depends(require_owner), db: Session = Depends(get_db)
) -> None:
    """Permanent, unlike deactivating: the role AND every assignment to
    it are gone for good."""
    role = _get_role(db, role_id)
    db.query(AdminGrant).filter(AdminGrant.role_id == role_id).delete()
    db.delete(role)
    db.commit()


def _user_summary(user: User, avatar_url: str | None, is_assistant: bool) -> AdminUserSummaryOut:
    return AdminUserSummaryOut(
        user_id=user.id,
        display_name=user.display_name,
        username=user.username,
        avatar_url=avatar_url,
        is_assistant=is_assistant,
    )


@router.get("/roles/{role_id}/members", response_model=list[AdminUserSummaryOut])
def list_role_members(
    role_id: int, current_user: User = Depends(require_owner), db: Session = Depends(get_db)
) -> list[AdminUserSummaryOut]:
    _get_role(db, role_id)  # 404 if the role itself doesn't exist
    grants = db.query(AdminGrant).filter(AdminGrant.role_id == role_id).all()
    out = []
    for grant in grants:
        user = db.get(User, grant.user_id)
        if user is None:
            continue
        out.append(_user_summary(user, get_current_avatar_url(db, user.id), is_assistant=True))
    return out


# --- assistants ("دستیاران" — search + per-user role assignment) -----------


@router.get("/assistants", response_model=list[AdminUserSummaryOut])
def list_assistants(current_user: User = Depends(require_owner), db: Session = Depends(get_db)) -> list[AdminUserSummaryOut]:
    """Everyone holding at least one role, regardless of whether that
    role is currently active — the default view before a search starts
    (see the frontend's Assistants search page)."""
    user_ids = {row[0] for row in db.query(AdminGrant.user_id).distinct().all()}
    out = []
    for user_id in user_ids:
        user = db.get(User, user_id)
        if user is None:
            continue
        out.append(_user_summary(user, get_current_avatar_url(db, user.id), is_assistant=True))
    return out


@router.get("/users/search", response_model=list[AdminUserSummaryOut])
def search_users(
    q: str = "",
    limit: int = 5,
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
) -> list[AdminUserSummaryOut]:
    """
    Used by BOTH the Assistants search box (limit=5, the frontend
    itself waits for 3+ characters before calling this — no need to
    enforce that server-side too) and the plain "کاربران" browse list
    (a higher limit, q optional). Matches on username OR first/last
    name, case-insensitively.
    """
    query = db.query(User)
    if q:
        like = f"%{q}%"
        query = query.filter(
            or_(User.username.ilike(like), User.first_name.ilike(like), User.last_name.ilike(like))
        )
    users = query.order_by(User.joined_at.desc()).limit(limit).all()

    assistant_ids = {row[0] for row in db.query(AdminGrant.user_id).distinct().all()}
    return [
        _user_summary(u, get_current_avatar_url(db, u.id), is_assistant=u.id in assistant_ids) for u in users
    ]


@router.get("/users/{user_id}/roles", response_model=list[UserRoleOut])
def list_user_roles(
    user_id: int, current_user: User = Depends(require_owner), db: Session = Depends(get_db)
) -> list[UserRoleOut]:
    grants = db.query(AdminGrant).filter(AdminGrant.user_id == user_id).all()
    out = []
    for grant in grants:
        role = db.get(Role, grant.role_id)
        if role is None:
            continue
        out.append(UserRoleOut(role_id=role.id, role_name=role.name, is_active=role.is_active))
    return out


@router.post("/users/{user_id}/roles", response_model=UserRoleOut, status_code=status.HTTP_201_CREATED)
def assign_role(
    user_id: int,
    payload: RoleAssign,
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
) -> UserRoleOut:
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found.")
    role = _get_role(db, payload.role_id)

    existing = (
        db.query(AdminGrant)
        .filter(AdminGrant.user_id == user_id, AdminGrant.role_id == role.id)
        .first()
    )
    if existing is None:
        db.add(AdminGrant(user_id=user_id, role_id=role.id, granted_by_user_id=current_user.id))
        db.commit()

    return UserRoleOut(role_id=role.id, role_name=role.name, is_active=role.is_active)


@router.delete("/users/{user_id}/roles/{role_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_role(
    user_id: int,
    role_id: int,
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
) -> None:
    grant = (
        db.query(AdminGrant)
        .filter(AdminGrant.user_id == user_id, AdminGrant.role_id == role_id)
        .first()
    )
    if grant is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This user doesn't hold that role.")
    db.delete(grant)
    db.commit()


# --- users ("کاربران" — browse/moderate anyone's account) -------------------


def _get_target_user(db: Session, user_id: int) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found.")
    return user


@router.get("/users/{user_id}", response_model=AdminUserDetailOut)
def get_user_detail(
    user_id: int, current_user: User = Depends(require_owner), db: Session = Depends(get_db)
) -> AdminUserDetailOut:
    user = _get_target_user(db, user_id)
    return AdminUserDetailOut(
        user_id=user.id,
        display_name=user.display_name,
        username=user.username,
        avatar_url=get_current_avatar_url(db, user.id),
        telegram_id=user.telegram_id,
        joined_at=user.joined_at,
        status=user.status.value,
        balance_toman=get_balance_toman(db, user.id),
        pending_toman=get_pending_provider_toman(db, user.id),
    )


@router.post("/users/{user_id}/block", response_model=AdminUserDetailOut)
def block_user(
    user_id: int, current_user: User = Depends(require_owner), db: Session = Depends(get_db)
) -> AdminUserDetailOut:
    user = _get_target_user(db, user_id)
    user.status = UserStatus.BLOCKED
    db.commit()
    return get_user_detail(user_id, current_user, db)


@router.post("/users/{user_id}/unblock", response_model=AdminUserDetailOut)
def unblock_user(
    user_id: int, current_user: User = Depends(require_owner), db: Session = Depends(get_db)
) -> AdminUserDetailOut:
    user = _get_target_user(db, user_id)
    user.status = UserStatus.ACTIVE
    db.commit()
    return get_user_detail(user_id, current_user, db)


@router.get("/users/{user_id}/offers", response_model=list[OfferOut])
def list_user_offers_admin(
    user_id: int, current_user: User = Depends(require_owner), db: Session = Depends(get_db)
) -> list[Offer]:
    """Every offer this user has, active or not — an admin isn't
    limited to the ACTIVE-only view a stranger would get."""
    return db.query(Offer).filter(Offer.provider_id == user_id).order_by(Offer.created_at.desc()).all()


@router.delete("/offers/{offer_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_offer_admin(
    offer_id: int, current_user: User = Depends(require_owner), db: Session = Depends(get_db)
) -> None:
    """Same safety rule as a provider deleting their own offer (never
    rip one out from under a still-unfinished paid session) — just
    without the ownership requirement, since this is an admin action."""
    offer = db.get(Offer, offer_id)
    if offer is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Offer not found.")

    if _has_unfinished_accepted_request(db, offer.id):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "This offer has an accepted request whose chat session is still open "
            "(or not yet paid for) and can't be deleted yet.",
        )

    pending_requests = (
        db.query(Request).filter(Request.offer_id == offer.id, Request.status == RequestStatus.PENDING).all()
    )
    for pending in pending_requests:
        pending.status = RequestStatus.CANCELLED
        pending.reason = OFFER_DELETED_REASON
        pending.responded_at = utcnow()

    db.delete(offer)
    db.commit()


def _admin_content_out(db: Session, content: Content) -> ContentOut:
    like_count = db.query(Like).filter(Like.content_id == content.id).count()
    return ContentOut(
        id=content.id,
        user_id=content.user_id,
        content_type=content.content_type.value,
        duration_seconds=content.duration_seconds,
        is_paid=content.is_paid,
        price_stars=content.price_stars,
        has_spoiler=content.has_spoiler,
        audience_type=content.audience_type.value,
        is_pinned=content.is_pinned,
        created_at=content.created_at,
        # An admin bypasses every normal audience/spoiler/payment rule —
        # this is the moderation view, not a real viewer's own.
        can_see_original=True,
        like_count=like_count,
        liked_by_me=False,
    )


@router.get("/users/{user_id}/content", response_model=list[ContentOut])
def list_user_content_admin(
    user_id: int, current_user: User = Depends(require_owner), db: Session = Depends(get_db)
) -> list[ContentOut]:
    items = db.query(Content).filter(Content.user_id == user_id).order_by(Content.created_at.desc()).all()
    return [_admin_content_out(db, c) for c in items]


@router.delete("/content/{content_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_content_admin(
    content_id: int, current_user: User = Depends(require_owner), db: Session = Depends(get_db)
) -> None:
    content = db.get(Content, content_id)
    if content is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Content not found.")
    delete_content_file(content.original_file_path)
    db.delete(content)
    db.commit()


@router.get("/users/{user_id}/requests", response_model=list[RequestActivityOut])
def list_user_requests_admin(
    user_id: int, current_user: User = Depends(require_owner), db: Session = Depends(get_db)
) -> list[RequestActivityOut]:
    """Same shape as the Activity tab's own unified feed
    (app/request/router.py's list_activity_requests), just computed
    relative to `user_id` instead of the caller."""
    rows = (
        db.query(Request, Offer)
        .join(Offer, Request.offer_id == Offer.id)
        .filter(or_(Request.buyer_id == user_id, Offer.provider_id == user_id))
        .order_by(Request.created_at.desc())
        .all()
    )
    out: list[RequestActivityOut] = []
    for request, offer in rows:
        sent = request.buyer_id == user_id
        counterpart_id = offer.provider_id if sent else request.buyer_id
        counterpart = db.get(User, counterpart_id)
        out.append(
            RequestActivityOut(
                id=request.id,
                offer_id=offer.id,
                offer_title=offer.title,
                offer_price_stars=offer.price_stars,
                status=request.status.value,
                reason=request.reason,
                created_at=request.created_at,
                responded_at=request.responded_at,
                direction="sent" if sent else "received",
                counterpart_user_id=counterpart_id,
                counterpart_display_name=counterpart.display_name if counterpart else "",
                counterpart_username=counterpart.username if counterpart else None,
                counterpart_avatar_url=get_current_avatar_url(db, counterpart_id) if counterpart else None,
            )
        )
    return out


@router.get("/users/{user_id}/chat-sessions", response_model=list[AdminChatSessionOut])
def list_user_chat_sessions_admin(
    user_id: int, current_user: User = Depends(require_owner), db: Session = Depends(get_db)
) -> list[AdminChatSessionOut]:
    rows = (
        db.query(ChatSession, Request, Offer)
        .join(Request, ChatSession.request_id == Request.id)
        .join(Offer, Request.offer_id == Offer.id)
        .filter(or_(Request.buyer_id == user_id, Offer.provider_id == user_id))
        .order_by(ChatSession.opened_at.desc())
        .all()
    )
    out: list[AdminChatSessionOut] = []
    for session, request, offer in rows:
        is_buyer = request.buyer_id == user_id
        other_id = offer.provider_id if is_buyer else request.buyer_id
        other = db.get(User, other_id)
        out.append(
            AdminChatSessionOut(
                id=session.id,
                offer_title=offer.title,
                other_user_id=other_id,
                other_display_name=other.display_name if other else "",
                status=session.status.value,
                opened_at=session.opened_at,
                closed_at=session.closed_at,
            )
        )
    return out


@router.get("/users/{user_id}/transactions", response_model=list[TransactionOut])
def list_user_transactions_admin(
    user_id: int, current_user: User = Depends(require_owner), db: Session = Depends(get_db)
) -> list[Transaction]:
    return (
        db.query(Transaction)
        .filter(or_(Transaction.buyer_id == user_id, Transaction.provider_id == user_id))
        .order_by(Transaction.created_at.desc())
        .all()
    )


# --- top-up review -----------------------------------------------------


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
    current_user: User = Depends(require_admin("finance.topups")),
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
    current_user: User = Depends(require_admin("finance.topups")),
    db: Session = Depends(get_db),
) -> AdminTopUpRequestOut:
    if payload.final_toman_amount <= 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "final_toman_amount must be positive.")

    lock_finances(db)
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
    current_user: User = Depends(require_admin("finance.topups")),
    db: Session = Depends(get_db),
) -> AdminTopUpRequestOut:
    lock_finances(db)
    topup_request = _get_pending_request(db, request_id)

    topup_request.status = TopUpStatus.REJECTED
    topup_request.rejection_reason = payload.reason
    topup_request.reviewed_by_user_id = current_user.id
    topup_request.reviewed_at = utcnow()

    db.commit()
    db.refresh(topup_request)
    return _topup_out(topup_request, db.get(User, topup_request.user_id))


@router.get("/rates", response_model=PlatformRatesOut)
def get_platform_rates(
    current_user: User = Depends(require_admin("finance.rates")),
    db: Session = Depends(get_db),
) -> PlatformRatesOut:
    return get_rates(db)


@router.put("/rates", response_model=PlatformRatesOut)
def update_platform_rates(
    payload: PlatformRatesUpdate,
    current_user: User = Depends(require_admin("finance.rates")),
    db: Session = Depends(get_db),
) -> PlatformRatesOut:
    """
    Only changes what's used for NEW transactions/top-ups from now on —
    every past Transaction/CreditLedgerEntry/TopUpRequest already stored
    its own frozen rate/commission at the time it was created, and
    that never changes retroactively (see PlatformRates' docstring).
    """
    lock_finances(db)
    rates = get_rates(db)
    rates.star_to_toman_rate = payload.star_to_toman_rate
    rates.chat_commission_percent = payload.chat_commission_percent
    rates.content_commission_percent = payload.content_commission_percent
    rates.withdrawal_commission_percent = payload.withdrawal_commission_percent
    rates.complaint_commission_percent = payload.complaint_commission_percent
    rates.minimum_withdrawal_toman = payload.minimum_withdrawal_toman
    db.commit()
    db.refresh(rates)
    return rates
