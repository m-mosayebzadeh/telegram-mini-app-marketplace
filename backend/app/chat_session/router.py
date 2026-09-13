"""
Chat session endpoints: view, close, dispute.

There is no "open" endpoint — a session is created automatically the
moment a request's payment succeeds (see app/request/router.py's
pay_for_request), so a paid request can never end up without one.

Closing and disputing are governed by TECHNICAL_REQUIREMENTS.md's "مدل
مالی و اعتبار":
  - either participant can close, only while OPEN
  - closing does NOT release the held funds immediately — see
    app/wallet/service.py's release_due_chat_transactions() for the
    grace-period auto-release this sets up instead
  - only the participant who did NOT close it can dispute, only while
    still within the grace period, only once
"""

from app.core.rates import lock_finances
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.chat_session.access import get_participant_session
from app.wallet.service import release_transaction
from app.wallet.blocks import (
    EndReason,
    close_and_settle,
    close_if_due,
    due_end,
    provider_has_spoken,
)
from app.chat_session.schemas import ChatSessionOut
from app.chat_session.serializers import to_chat_session_out
from app.core.config import settings
from app.core.database import get_db
from app.core.time import utcnow
from app.models.chat_session import ChatSession, ChatSessionStatus
from app.models.offer import Offer
from app.models.request import Request
from app.models.user import User
from app.profile.photos import get_current_avatar_url

router = APIRouter(prefix="/chat-sessions", tags=["chat-sessions"])


@router.get("/mine", response_model=list[ChatSessionOut])
def list_my_sessions(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ChatSessionOut]:
    """Every session current_user is part of, as either buyer or
    provider, open or closed."""
    sessions = (
        db.query(ChatSession)
        .join(Request, ChatSession.request_id == Request.id)
        .join(Offer, Request.offer_id == Offer.id)
        .filter(or_(Request.buyer_id == current_user.id, Offer.provider_id == current_user.id))
        .all()
    )
    # Reading the list is also when each session's own clock gets checked —
    # the lazy sweep that stands in for a scheduler (see close_if_due).
    return [to_chat_session_out(db, close_if_due(db, s), current_user.id) for s in sessions]


@router.get("/{session_id}", response_model=ChatSessionOut)
def get_session(
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChatSessionOut:
    chat_session = close_if_due(db, get_participant_session(db, session_id, current_user.id))
    return to_chat_session_out(db, chat_session, current_user.id)


@router.post("/{session_id}/close", response_model=ChatSessionOut)
def close_session(
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChatSessionOut:
    chat_session = close_if_due(db, get_participant_session(db, session_id, current_user.id))
    if chat_session.status != ChatSessionStatus.OPEN:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="This session is already closed."
        )

    # Whoever closes, every finished block belongs to the provider. Only the
    # block still running depends on who stopped it — and a provider who never
    # said anything at all costs the buyer nothing (see app/wallet/blocks.py).
    is_buyer = chat_session.request.buyer_id == current_user.id
    if not provider_has_spoken(db, chat_session):
        reason = EndReason.PROVIDER_SILENT
    else:
        reason = EndReason.BUYER_CLOSED if is_buyer else EndReason.PROVIDER_CLOSED
    close_and_settle(
        db, chat_session, reason=reason, closed_by_user_id=current_user.id, at=utcnow()
    )
    db.commit()
    db.refresh(chat_session)
    return to_chat_session_out(db, chat_session, current_user.id)


def _set_archived(db: Session, session_id: int, current_user: User, archived: bool) -> ChatSessionOut:
    """Shared body for /archive and /unarchive — sets whichever of the
    two per-viewer flags belongs to the caller's own role in this
    session, never the other participant's."""
    chat_session = get_participant_session(db, session_id, current_user.id)
    is_buyer = chat_session.request.buyer_id == current_user.id
    if is_buyer:
        chat_session.archived_by_buyer = archived
    else:
        chat_session.archived_by_provider = archived
    db.commit()
    db.refresh(chat_session)
    return to_chat_session_out(db, chat_session, current_user.id)


@router.post("/{session_id}/archive", response_model=ChatSessionOut)
def archive_session(
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChatSessionOut:
    """Moves this session out of the caller's main Chats list into their
    Archived one (see ChatSession.archived_by_buyer/archived_by_provider's
    docstring) — purely a per-viewer display preference, changes nothing
    about the session's real status or the other participant's view."""
    return _set_archived(db, session_id, current_user, archived=True)


@router.post("/{session_id}/unarchive", response_model=ChatSessionOut)
def unarchive_session(
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChatSessionOut:
    return _set_archived(db, session_id, current_user, archived=False)


def _has_confirmed(chat_session: ChatSession, user_id: int) -> bool:
    """Whether this participant has already signed off on the settlement."""
    if chat_session.request.buyer_id == user_id:
        return chat_session.settlement_confirmed_by_buyer_at is not None
    return chat_session.settlement_confirmed_by_provider_at is not None


@router.post("/{session_id}/confirm-settlement", response_model=ChatSessionOut)
def confirm_settlement(
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChatSessionOut:
    """
    Says "this was fine" about a finished session.

    The settlement window exists to give an unhappy participant time to freeze
    the money. When BOTH sides have said there is nothing to freeze, waiting
    out the rest of it protects nobody — so the provider is paid immediately.

    Confirming gives up the caller's own right to dispute this session. It does
    not touch the other participant's, who may still be deciding.
    """
    lock_finances(db)
    chat_session = get_participant_session(db, session_id, current_user.id)
    if chat_session.status != ChatSessionStatus.CLOSED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only a closed session can be settled.",
        )

    transaction = chat_session.transaction
    if transaction is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This session cost nothing, so there is nothing to settle.",
        )
    if transaction.disputed_at is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This session is disputed; it is for support to resolve.",
        )

    now = utcnow()
    if chat_session.request.buyer_id == current_user.id:
        chat_session.settlement_confirmed_by_buyer_at = (
            chat_session.settlement_confirmed_by_buyer_at or now
        )
    else:
        chat_session.settlement_confirmed_by_provider_at = (
            chat_session.settlement_confirmed_by_provider_at or now
        )

    if (
        chat_session.settlement_confirmed_by_buyer_at is not None
        and chat_session.settlement_confirmed_by_provider_at is not None
    ):
        release_transaction(db, transaction)

    db.commit()
    db.refresh(chat_session)
    return to_chat_session_out(db, chat_session, current_user.id)


@router.post("/{session_id}/dispute", response_model=ChatSessionOut)
def dispute_session(
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChatSessionOut:
    """
    Freezes this session's transaction so the grace-period auto-release
    skips it — the entire "something went wrong" mechanism for this
    phase (see app/models/transaction.py's disputed_at). Resolving a
    frozen transaction — releasing it anyway, or refunding the buyer —
    isn't built yet; that's the same deferred report/complaint system
    TECHNICAL_REQUIREMENTS.md section 7 already flags as an open decision.
    """
    lock_finances(db)
    chat_session = get_participant_session(db, session_id, current_user.id)
    if chat_session.status != ChatSessionStatus.CLOSED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only a closed session can be disputed.",
        )
    if chat_session.closed_by_user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You closed this session yourself — only the other participant can dispute it.",
        )

    transaction = chat_session.transaction
    if transaction is None:
        # Nothing was consumed, so nothing is being held and there is nothing
        # to argue about — the buyer already has all of their money back.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This session cost nothing, so there is nothing to dispute.",
        )
    if transaction.disputed_at is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="This session is already disputed."
        )
    if _has_confirmed(chat_session, current_user.id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You already confirmed this settlement, so you cannot dispute it.",
        )

    grace_deadline = chat_session.closed_at + timedelta(hours=settings.chat_release_grace_hours)
    if utcnow() > grace_deadline:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The dispute window for this session has passed.",
        )

    transaction.disputed_at = utcnow()
    db.commit()
    db.refresh(chat_session)
    return to_chat_session_out(db, chat_session, current_user.id)
