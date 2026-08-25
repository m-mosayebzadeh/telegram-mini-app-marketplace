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
from app.chat_session.access import get_participant_session
from app.chat_session.schemas import ChatSessionOut, ChatSessionParticipantOut
from app.core.config import settings
from app.core.database import get_db
from app.core.time import utcnow
from app.models.chat_session import ChatSession, ChatSessionStatus
from app.models.offer import Offer
from app.models.profile import Profile
from app.models.request import Request
from app.models.user import User

router = APIRouter(prefix="/chat-sessions", tags=["chat-sessions"])


def _to_chat_session_out(db: Session, chat_session: ChatSession, viewer_id: int) -> ChatSessionOut:
    """Builds the enriched response for one session, from `viewer_id`'s
    point of view. Every route below returns through this instead of
    handing back the bare ORM row, so the chat screen's header and
    session-details panel always have what they need in one call — see
    ChatSessionOut's docstring-equivalent comments in schemas.py."""
    request = chat_session.request
    offer = request.offer
    transaction = chat_session.transaction

    is_buyer = request.buyer_id == viewer_id
    my_role = "buyer" if is_buyer else "provider"
    other_user_id = offer.provider_id if is_buyer else request.buyer_id

    other_user = db.get(User, other_user_id)
    # A Profile row is optional (see app/models/profile.py) — a user who
    # never set one up simply shows no avatar, same fallback used
    # everywhere else a PublicProfile-shaped avatar is displayed.
    other_profile = db.query(Profile).filter(Profile.user_id == other_user_id).first()

    return ChatSessionOut(
        id=chat_session.id,
        request_id=chat_session.request_id,
        transaction_id=chat_session.transaction_id,
        status=chat_session.status.value,
        opened_at=chat_session.opened_at,
        closed_at=chat_session.closed_at,
        closed_by_user_id=chat_session.closed_by_user_id,
        my_role=my_role,
        other_participant=ChatSessionParticipantOut(
            user_id=other_user_id,
            display_name=other_user.display_name,
            username=other_user.username,
            avatar_url=other_profile.avatar_url if other_profile else None,
        ),
        offer_title=offer.title,
        price_stars=offer.price_stars,
        display_duration_minutes=offer.display_duration_minutes,
        disputed=transaction.disputed_at is not None,
        transaction_status=transaction.status.value,
    )


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
    return [_to_chat_session_out(db, s, current_user.id) for s in sessions]


@router.get("/{session_id}", response_model=ChatSessionOut)
def get_session(
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChatSessionOut:
    chat_session = get_participant_session(db, session_id, current_user.id)
    return _to_chat_session_out(db, chat_session, current_user.id)


@router.post("/{session_id}/close", response_model=ChatSessionOut)
def close_session(
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChatSessionOut:
    chat_session = get_participant_session(db, session_id, current_user.id)
    if chat_session.status != ChatSessionStatus.OPEN:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="This session is already closed."
        )

    chat_session.status = ChatSessionStatus.CLOSED
    chat_session.closed_at = utcnow()
    chat_session.closed_by_user_id = current_user.id
    db.commit()
    db.refresh(chat_session)
    return _to_chat_session_out(db, chat_session, current_user.id)


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
    return _to_chat_session_out(db, chat_session, current_user.id)
