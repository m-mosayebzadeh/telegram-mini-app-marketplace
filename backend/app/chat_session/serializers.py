"""Turning a ChatSession row into the response both routers hand back.

Lives outside the routers because a session is created on the request side
(paying for an accepted request opens it) and read on the session side, and
both have to describe it the same way.
"""
from sqlalchemy.orm import Session

from app.chat_session.schemas import ChatSessionOut, ChatSessionParticipantOut
from app.models.chat_session import ChatSession
from app.models.user import User
from app.profile.photos import get_current_avatar_url
from app.models.chat_session import ChatSessionStatus
from app.core.time import utcnow
from app.wallet.blocks import can_stop_at_block_end, due_end, is_in_last_block


def to_chat_session_out(db: Session, chat_session: ChatSession, viewer_id: int) -> ChatSessionOut:
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
            avatar_url=get_current_avatar_url(db, other_user_id),
        ),
        offer_title=offer.title,
        price_drops=offer.price_drops,
        session_duration_seconds=offer.session_duration_seconds,
        reserved_blocks=chat_session.reserved_blocks,
        block_duration_seconds=chat_session.block_duration_seconds,
        block_price_drops=chat_session.block_price_drops,
        started_at=chat_session.started_at,
        ends_at=due_end(chat_session),
        close_at_block_end_by_user_id=chat_session.close_at_block_end_by_user_id,
        i_asked_to_stop=chat_session.close_at_block_end_by_user_id == viewer_id,
        can_stop_at_block_end=can_stop_at_block_end(chat_session, utcnow()),
        extension_pending=chat_session.extension_requested_at is not None,
        can_request_extension=(
            is_buyer
            and chat_session.status == ChatSessionStatus.OPEN
            and chat_session.started_at is not None
            and chat_session.extension_requested_at is None
            # Asking for more time and asking to stop are opposites, so the
            # screen never shows both at once.
            and chat_session.close_at_block_end_by_user_id is None
            and is_in_last_block(chat_session, utcnow())
        ),
        consumed_blocks=chat_session.consumed_blocks,
        end_reason=chat_session.end_reason,
        i_confirmed_settlement=(
            chat_session.settlement_confirmed_by_buyer_at
            if is_buyer
            else chat_session.settlement_confirmed_by_provider_at
        )
        is not None,
        they_confirmed_settlement=(
            chat_session.settlement_confirmed_by_provider_at
            if is_buyer
            else chat_session.settlement_confirmed_by_buyer_at
        )
        is not None,
        disputed=transaction is not None and transaction.disputed_at is not None,
        transaction_status=transaction.status.value if transaction is not None else None,
        archived=chat_session.archived_by_buyer if is_buyer else chat_session.archived_by_provider,
    )
