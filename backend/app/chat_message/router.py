"""
Chat message endpoints: list a session's conversation, send a message,
fetch a photo/video message's file bytes.

Real, persisted messages — replacing the frontend's earlier mock-only
message layer (see docs/TECHNICAL_REQUIREMENTS.md section 12, item 43:
"session data real, message data mock" was always meant to be temporary,
swappable behind lib/chatMessageApi.ts without touching any component).
There is no real-time push here (no websockets) — the frontend polls
GET .../messages on an interval while a session is open, the simplest
approach that still lets two real participants actually see each
other's messages, which is the whole point of this backend existing.

Every route re-checks the caller is actually a participant in the
session (see app/chat_session/access.py) — a stranger gets a plain 404,
same as every other "only the people involved" check in this app.
"""

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.live.events import announce_message
from app.models.message_actions import HiddenMessage
from app.auth.dependencies import get_current_user
from app.chat_session.access import get_participant_session
from app.conversation.service import touch
from app.wallet.blocks import close_if_due, start_clock
from app.chat_message.schemas import ChatMessageOut
from app.chat_message.service import build_message
from app.core.database import get_db
from app.core.storage import save_content_file
from app.models.chat_message import (
    MAX_CHAT_MESSAGE_TEXT_LENGTH,
    MAX_CHAT_VIDEO_DURATION_SECONDS,
    MAX_CHAT_VOICE_DURATION_SECONDS,
    ChatMessage,
    ChatMessageType,
)
from app.models.chat_session import ChatSession, ChatSessionStatus
from app.models.conversation import ConversationParticipant
from app.models.user import User

router = APIRouter(prefix="/chat-sessions", tags=["chat-messages"])


def list_conversation_messages(
    db: Session, conversation_id: int, viewer_id: int
) -> list[ChatMessage]:
    """Every message of a thread that this person can still see, oldest
    first.

    Someone who cleared the conversation sees only what arrived afterwards,
    and someone who removed a single past session does not see that
    session's messages — both are one-sided, so this is per viewer rather
    than per thread.
    """
    query = (
        db.query(ChatMessage)
        .filter(
            ChatMessage.conversation_id == conversation_id,
            # Deleted for everyone: gone from the thread, with no trace left
            # in its place (the owner's decision), though the row stays.
            ChatMessage.deleted_at.is_(None),
            # Deleted by this person for themselves only.
            ~select(HiddenMessage.message_id)
            .where(
                HiddenMessage.user_id == viewer_id,
                HiddenMessage.message_id == ChatMessage.id,
            )
            .exists(),
        )
        .order_by(ChatMessage.created_at.asc(), ChatMessage.id.asc())
    )

    participant = db.scalar(
        select(ConversationParticipant).where(
            ConversationParticipant.conversation_id == conversation_id,
            ConversationParticipant.user_id == viewer_id,
        )
    )
    if participant is not None and participant.cleared_at is not None:
        query = query.filter(ChatMessage.created_at > participant.cleared_at)

    removed = removed_session_ids(db, conversation_id, viewer_id)
    if removed:
        query = query.filter(
            or_(
                ChatMessage.chat_session_id.is_(None),
                ChatMessage.chat_session_id.not_in(removed),
            )
        )
    return query.all()


def removed_session_ids(db: Session, conversation_id: int, viewer_id: int) -> list[int]:
    """The paid sessions in this thread that this person has removed from
    their own side."""
    sessions = db.scalars(
        select(ChatSession).where(ChatSession.conversation_id == conversation_id)
    ).all()
    return [
        s.id
        for s in sessions
        if (
            s.deleted_by_buyer_at is not None
            if s.request.buyer_id == viewer_id
            else s.deleted_by_provider_at is not None
        )
    ]


@router.get("/{session_id}/messages", response_model=list[ChatMessageOut])
def list_messages(
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ChatMessage]:
    """Every message in this session, oldest first. No pagination yet —
    fine for how small a real conversation in this app is expected to
    stay; the frontend already takes a plain array (see
    frontend/src/components/chat/MessageList.tsx), so adding pagination
    later doesn't require touching it."""
    chat_session = get_participant_session(db, session_id, current_user.id)  # 404s for a stranger
    return list_conversation_messages(db, chat_session.conversation_id, current_user.id)


@router.post("/{session_id}/messages", response_model=ChatMessageOut, status_code=status.HTTP_201_CREATED)
def send_message(
    session_id: int,
    message_type: ChatMessageType = Form(..., alias="type"),
    text: str | None = Form(None),
    duration_seconds: int | None = Form(None),
    file: UploadFile | None = File(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChatMessage:
    # Reading the session is also when its own clock gets checked, so a
    # message can never land in a session whose time already ran out.
    chat_session = close_if_due(db, get_participant_session(db, session_id, current_user.id))

    # A closed session's conversation is read-only — this is the same
    # rule the frontend's composer already enforces (hiding itself once
    # closed), enforced here for real so it can't be bypassed by calling
    # the API directly.
    if chat_session.status != ChatSessionStatus.OPEN:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "This session is closed — the conversation is read-only."
        )

    message = build_message(
        conversation_id=chat_session.conversation_id,
        chat_session_id=session_id,
        sender_id=current_user.id,
        message_type=message_type,
        text=text,
        duration_seconds=duration_seconds,
        file=file,
    )
    db.add(message)

    # The provider's first message is what starts the session: until they
    # arrive, the buyer is not paying for anything. The buyer may write while
    # waiting — that is only natural — and it starts nothing.
    if current_user.id == chat_session.request.offer.provider_id:
        start_clock(db, chat_session)

    touch(chat_session.conversation, message.created_at)
    db.commit()
    db.refresh(message)
    announce_message(db, chat_session.conversation, message)
    return message


@router.get("/{session_id}/messages/{message_id}/file")
def get_message_file(
    session_id: int,
    message_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FileResponse:
    """
    The actual bytes of a photo, video or voice message.

    A text message has no file, and neither do voice messages recorded
    before real audio existed (see send_message). Both 404 here, the same
    as a message that does not exist -- the caller cannot tell the
    difference and does not need to.
    """
    chat_session = get_participant_session(db, session_id, current_user.id)

    message = db.get(ChatMessage, message_id)
    if (
        message is None
        or message.conversation_id != chat_session.conversation_id
        or message.file_path is None
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found.")

    return FileResponse(message.file_path)
