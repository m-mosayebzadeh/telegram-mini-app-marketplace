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
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.chat_session.access import get_participant_session
from app.chat_message.schemas import ChatMessageOut
from app.core.database import get_db
from app.core.storage import save_content_file
from app.models.chat_message import (
    MAX_CHAT_MESSAGE_TEXT_LENGTH,
    MAX_CHAT_VIDEO_DURATION_SECONDS,
    MAX_CHAT_VOICE_DURATION_SECONDS,
    ChatMessage,
    ChatMessageType,
)
from app.models.chat_session import ChatSessionStatus
from app.models.user import User

router = APIRouter(prefix="/chat-sessions", tags=["chat-messages"])


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
    get_participant_session(db, session_id, current_user.id)  # 404s for a stranger
    return (
        db.query(ChatMessage)
        .filter(ChatMessage.chat_session_id == session_id)
        .order_by(ChatMessage.created_at.asc(), ChatMessage.id.asc())
        .all()
    )


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
    chat_session = get_participant_session(db, session_id, current_user.id)

    # A closed session's conversation is read-only — this is the same
    # rule the frontend's composer already enforces (hiding itself once
    # closed), enforced here for real so it can't be bypassed by calling
    # the API directly.
    if chat_session.status != ChatSessionStatus.OPEN:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "This session is closed — the conversation is read-only."
        )

    if message_type == ChatMessageType.TEXT:
        if not text or not text.strip():
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "text is required for a text message.")
        if len(text) > MAX_CHAT_MESSAGE_TEXT_LENGTH:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"text must be at most {MAX_CHAT_MESSAGE_TEXT_LENGTH} characters.",
            )
        file_path = None
        message_duration = None

    elif message_type == ChatMessageType.PHOTO:
        if file is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "file is required for a photo message.")
        file_path = save_content_file(current_user.id, file)
        text = None
        message_duration = None

    elif message_type == ChatMessageType.VIDEO:
        if file is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "file is required for a video message.")
        if duration_seconds is None or not (0 < duration_seconds <= MAX_CHAT_VIDEO_DURATION_SECONDS):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"duration_seconds must be between 1 and {MAX_CHAT_VIDEO_DURATION_SECONDS} for a video message.",
            )
        file_path = save_content_file(current_user.id, file)
        text = None
        message_duration = duration_seconds

    else:  # VOICE — simulated recording, never a real file (see app/models/chat_message.py)
        if duration_seconds is None or not (0 < duration_seconds <= MAX_CHAT_VOICE_DURATION_SECONDS):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"duration_seconds must be between 1 and {MAX_CHAT_VOICE_DURATION_SECONDS} for a voice message.",
            )
        file_path = None
        text = None
        message_duration = duration_seconds

    message = ChatMessage(
        chat_session_id=session_id,
        sender_id=current_user.id,
        type=message_type,
        text=text,
        file_path=file_path,
        duration_seconds=message_duration,
    )
    db.add(message)
    db.commit()
    db.refresh(message)
    return message


@router.get("/{session_id}/messages/{message_id}/file")
def get_message_file(
    session_id: int,
    message_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FileResponse:
    """The actual bytes of a photo/video message — a text or voice
    message has no file at all (voice is a simulated recording, never a
    real one; see app/models/chat_message.py), so both 404 here the same
    as a message that doesn't exist."""
    get_participant_session(db, session_id, current_user.id)

    message = db.get(ChatMessage, message_id)
    if message is None or message.chat_session_id != session_id or message.file_path is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found.")

    return FileResponse(message.file_path)
