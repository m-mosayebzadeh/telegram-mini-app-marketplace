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

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.chat_session.schemas import ChatSessionOut
from app.core.config import settings
from app.core.database import get_db
from app.core.time import utcnow
from app.models.chat_session import ChatSession, ChatSessionStatus
from app.models.offer import Offer
from app.models.request import Request
from app.models.user import User

router = APIRouter(prefix="/chat-sessions", tags=["chat-sessions"])


def _get_participant_session(db: Session, session_id: int, user_id: int) -> ChatSession:
    """Loads a session and confirms `user_id` is either its buyer or its
    provider — used by every route below, so a stranger gets a plain 404,
    same pattern as every other "only the people involved" check in this
    app."""
    chat_session = db.get(ChatSession, session_id)
    if chat_session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat session not found.")

    request = chat_session.request
    is_buyer = request.buyer_id == user_id
    is_provider = request.offer.provider_id == user_id
    if not (is_buyer or is_provider):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat session not found.")

    return chat_session


@router.get("/mine", response_model=list[ChatSessionOut])
def list_my_sessions(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ChatSession]:
    """Every session current_user is part of, as either buyer or
    provider, open or closed."""
    return (
        db.query(ChatSession)
        .join(Request, ChatSession.request_id == Request.id)
        .join(Offer, Request.offer_id == Offer.id)
        .filter(or_(Request.buyer_id == current_user.id, Offer.provider_id == current_user.id))
        .all()
    )


@router.get("/{session_id}", response_model=ChatSessionOut)
def get_session(
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChatSession:
    return _get_participant_session(db, session_id, current_user.id)


@router.post("/{session_id}/close", response_model=ChatSessionOut)
def close_session(
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChatSession:
    chat_session = _get_participant_session(db, session_id, current_user.id)
    if chat_session.status != ChatSessionStatus.OPEN:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="This session is already closed."
        )

    chat_session.status = ChatSessionStatus.CLOSED
    chat_session.closed_at = utcnow()
    chat_session.closed_by_user_id = current_user.id
    db.commit()
    db.refresh(chat_session)
    return chat_session


@router.post("/{session_id}/dispute", response_model=ChatSessionOut)
def dispute_session(
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChatSession:
    """
    Freezes this session's transaction so the grace-period auto-release
    skips it — the entire "something went wrong" mechanism for this
    phase (see app/models/transaction.py's disputed_at). Resolving a
    frozen transaction — releasing it anyway, or refunding the buyer —
    isn't built yet; that's the same deferred report/complaint system
    TECHNICAL_REQUIREMENTS.md section 7 already flags as an open decision.
    """
    chat_session = _get_participant_session(db, session_id, current_user.id)
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
    if transaction.disputed_at is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="This session is already disputed."
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
    return chat_session
