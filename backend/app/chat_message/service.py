"""
Validating and building a message, in one place.

Both the paid-session route and the free-conversation route accept the
same kinds of message with the same rules; the difference between them is
only WHICH kinds are allowed at that moment, which is the capability
check and lives elsewhere. Keeping the validation here means the two
routes cannot drift into disagreeing about what a valid voice message is.
"""

from fastapi import HTTPException, UploadFile, status

from app.core.storage import save_content_file
from app.models.chat_message import (
    MAX_CHAT_MESSAGE_TEXT_LENGTH,
    MAX_CHAT_VIDEO_DURATION_SECONDS,
    MAX_CHAT_VOICE_DURATION_SECONDS,
    ChatMessage,
    ChatMessageType,
)
from app.models.conversation import (
    CAP_PHOTO,
    CAP_TEXT,
    CAP_VIDEO,
    CAP_VOICE,
)

#: Which capability each message type needs. A type with no entry here
#: cannot be sent at all, which is the safe direction: a new type is
#: refused until somebody deliberately says what unlocks it.
CAPABILITY_FOR_TYPE = {
    ChatMessageType.TEXT: CAP_TEXT,
    ChatMessageType.PHOTO: CAP_PHOTO,
    ChatMessageType.VIDEO: CAP_VIDEO,
    ChatMessageType.VOICE: CAP_VOICE,
}


def require_capability(
    message_type: ChatMessageType, allowed: list[str]
) -> None:
    """Refuses a message type this conversation cannot carry right now.

    409 rather than 403: nothing is wrong with the caller or the message,
    it is the conversation's current state that does not permit it — and
    buying a session changes that state, which is exactly what a 409
    means.
    """
    needed = CAPABILITY_FOR_TYPE.get(message_type)
    if needed is None or needed not in allowed:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail={
                "reason": "capability_not_available",
                "message_type": message_type.value,
                "allowed": allowed,
            },
        )


def build_message(
    *,
    conversation_id: int,
    chat_session_id: int | None,
    sender_id: int,
    message_type: ChatMessageType,
    text: str | None,
    duration_seconds: int | None,
    file: UploadFile | None,
) -> ChatMessage:
    """Checks one message and returns it, unsaved.

    Any uploaded file is written to disk here, so a caller that raises
    afterwards leaves an orphaned file rather than a broken row — the
    safer of the two, and the same order the route used before.
    """
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
        file_path = save_content_file(sender_id, file)
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
        file_path = save_content_file(sender_id, file)
        text = None
        message_duration = duration_seconds

    else:  # VOICE
        if duration_seconds is None or not (0 < duration_seconds <= MAX_CHAT_VOICE_DURATION_SECONDS):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"duration_seconds must be between 1 and {MAX_CHAT_VOICE_DURATION_SECONDS} for a voice message.",
            )
        # Real audio now. The file stays OPTIONAL rather than required,
        # because older messages recorded before audio existed have no
        # bytes and must keep rendering; the frontend shows those without
        # a play control instead of offering one that cannot work.
        file_path = None if file is None else save_content_file(sender_id, file)
        text = None
        message_duration = duration_seconds

    return ChatMessage(
        conversation_id=conversation_id,
        chat_session_id=chat_session_id,
        sender_id=sender_id,
        type=message_type,
        text=text,
        file_path=file_path,
        duration_seconds=message_duration,
    )
