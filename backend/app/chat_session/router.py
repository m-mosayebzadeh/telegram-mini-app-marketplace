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
    accept_extension,
    can_stop_at_block_end,
    cancel_stop_at_block_end,
    close_and_settle,
    close_if_due,
    due_end,
    is_in_last_block,
    release_extension_hold,
    request_extension,
    request_stop_at_block_end,
)
from app.wallet.service import InsufficientBalanceError
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


@router.get("/live", response_model=ChatSessionOut | None)
def read_my_live_session(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChatSessionOut | None:
    """
    The one session this user is in the middle of, if any.

    Deliberately its own small endpoint rather than a flag on /me: the app
    shows a bar on every screen while a session is running, and that bar has
    to stay right after the app is closed, reopened, or crashes. Deriving it
    from the server on each navigation is what makes it survive all three —
    there is no local state to lose.

    Only ONE can exist at a time, which is the same rule that stops anyone
    holding two live interactions at once.
    """
    sessions = (
        db.query(ChatSession)
        .join(Request, ChatSession.request_id == Request.id)
        .join(Offer, Request.offer_id == Offer.id)
        .filter(
            or_(Request.buyer_id == current_user.id, Offer.provider_id == current_user.id),
            ChatSession.status == ChatSessionStatus.OPEN,
        )
        .all()
    )
    for chat_session in sessions:
        # A session whose time ran out is only closed when someone looks at
        # it, and this endpoint is exactly such a look.
        if close_if_due(db, chat_session).status == ChatSessionStatus.OPEN:
            return to_chat_session_out(db, chat_session, current_user.id)
    return None


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

    # Whoever closes, every finished block belongs to the provider; only the
    # block still running depends on who stopped it. A session the provider
    # never started costs the buyer nothing at all, whoever closes it.
    is_buyer = chat_session.request.buyer_id == current_user.id
    if chat_session.started_at is None:
        reason = EndReason.NOT_STARTED
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


def _open_started_session(db: Session, session_id: int, user_id: int) -> ChatSession:
    """A session of the caller's that is running right now — the only kind an
    extension can apply to."""
    chat_session = close_if_due(db, get_participant_session(db, session_id, user_id))
    if chat_session.status != ChatSessionStatus.OPEN:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="This session is already closed."
        )
    if chat_session.started_at is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This session has not started yet.",
        )
    return chat_session


@router.post("/{session_id}/stop-at-block-end", response_model=ChatSessionOut)
def stop_at_block_end(
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChatSessionOut:
    """
    Asks for the session to end when the running block does, rather than
    carrying on into the next one.

    It costs exactly the same as closing right now — the running block is paid
    for either way — so what it buys is the rest of the time already paid for,
    and protection from an accident: without it, anyone who does not want the
    next block has to watch the clock and press close before the boundary, and
    being a few seconds late costs a whole block.

    Either participant may ask. It can be taken back at any time before the
    boundary arrives.
    """
    lock_finances(db)
    chat_session = _open_started_session(db, session_id, current_user.id)
    if chat_session.close_at_block_end_by_user_id is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This session is already set to stop at the end of the block.",
        )
    if not can_stop_at_block_end(chat_session, utcnow()):
        # Only reachable in the last block, where the session ends anyway.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"reason": "already_last_block"},
        )

    request_stop_at_block_end(chat_session, current_user.id, utcnow())
    db.commit()
    db.refresh(chat_session)
    return to_chat_session_out(db, chat_session, current_user.id)


@router.delete("/{session_id}/stop-at-block-end", response_model=ChatSessionOut)
def cancel_stop_at_block_end_request(
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChatSessionOut:
    """Changing your mind. Only whoever asked can take it back — the other
    participant cannot quietly overrule a decision to stop."""
    lock_finances(db)
    chat_session = _open_started_session(db, session_id, current_user.id)
    if chat_session.close_at_block_end_by_user_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Nothing is set to stop."
        )
    if chat_session.close_at_block_end_by_user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only whoever asked to stop can take it back.",
        )

    cancel_stop_at_block_end(chat_session)
    db.commit()
    db.refresh(chat_session)
    return to_chat_session_out(db, chat_session, current_user.id)


@router.post("/{session_id}/extension", response_model=ChatSessionOut)
def request_session_extension(
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChatSessionOut:
    """
    Asks for one more block.

    Only the buyer may ask, and only ever for a single block at a time —
    though they may ask again as often as they like. A provider cannot offer
    an extension: being able to would turn a conversation into a sales pitch
    and bring back exactly the incentive to stretch things out that selling in
    blocks exists to remove.
    """
    lock_finances(db)
    chat_session = _open_started_session(db, session_id, current_user.id)
    if chat_session.request.buyer_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the buyer can ask to extend a session.",
        )
    if chat_session.extension_requested_at is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="An extension is already waiting for an answer.",
        )
    if chat_session.close_at_block_end_by_user_id is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"reason": "stopping_at_block_end"},
        )
    if not is_in_last_block(chat_session, utcnow()):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"reason": "not_in_last_block"},
        )

    try:
        request_extension(db, chat_session, current_user.id)
    except InsufficientBalanceError as exc:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail={
                "reason": "insufficient_balance",
                "needed_toman": exc.needed_toman,
                "available_toman": exc.available_toman,
            },
        ) from exc

    db.commit()
    db.refresh(chat_session)
    return to_chat_session_out(db, chat_session, current_user.id)


@router.post("/{session_id}/extension/accept", response_model=ChatSessionOut)
def accept_session_extension(
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChatSessionOut:
    """The provider agreeing to keep going. Their time, their call."""
    lock_finances(db)
    chat_session = _open_started_session(db, session_id, current_user.id)
    if chat_session.request.offer.provider_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the provider can answer an extension request.",
        )
    if chat_session.extension_requested_at is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Nothing is waiting for an answer."
        )

    accept_extension(db, chat_session)
    db.commit()
    db.refresh(chat_session)
    return to_chat_session_out(db, chat_session, current_user.id)


@router.post("/{session_id}/extension/decline", response_model=ChatSessionOut)
def decline_session_extension(
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChatSessionOut:
    """
    Saying no. The held block goes straight back to the buyer, and the session
    carries on to its existing end — declining more time is not ending early.
    """
    lock_finances(db)
    chat_session = _open_started_session(db, session_id, current_user.id)
    if chat_session.request.offer.provider_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the provider can answer an extension request.",
        )
    if chat_session.extension_requested_at is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Nothing is waiting for an answer."
        )

    release_extension_hold(db, chat_session)
    db.commit()
    db.refresh(chat_session)
    return to_chat_session_out(db, chat_session, current_user.id)


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
