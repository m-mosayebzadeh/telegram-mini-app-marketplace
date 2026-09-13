"""
ChatMessage: one message inside a chat session's conversation — text,
photo, video, or voice, per TECHNICAL_REQUIREMENTS.md section 12 (only
these four message types are ever allowed, no arbitrary file uploads).

Photo, video and voice all carry a real uploaded file, stored the same
way as app/models/content.py's Content via app/core/storage.py.

Voice is the one type whose file is OPTIONAL, and only for a historical
reason: recording used to be simulated -- the frontend timed a fake
recording and sent only its length -- so messages from before real audio
existed have a duration and nothing to play. They must keep rendering,
so the CHECK below permits a NULL file_path for voice and the frontend
shows those without a play control rather than offering one that cannot
work. New voice messages always carry audio.
"""

import enum
from datetime import datetime

from sqlalchemy import CheckConstraint, Enum, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.time import UTCDateTime, utcnow

# Policy limits (not hard technical ones) — mirrors
# app/models/content.py's MAX_VIDEO_DURATION_SECONDS pattern.
MAX_CHAT_VIDEO_DURATION_SECONDS = 60
MAX_CHAT_VOICE_DURATION_SECONDS = 120
MAX_CHAT_MESSAGE_TEXT_LENGTH = 4000


class ChatMessageType(str, enum.Enum):
    TEXT = "text"
    PHOTO = "photo"
    VIDEO = "video"
    VOICE = "voice"


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    chat_session_id: Mapped[int] = mapped_column(ForeignKey("chat_sessions.id"), index=True)
    sender_id: Mapped[int] = mapped_column(ForeignKey("users.id"))

    type: Mapped[ChatMessageType] = mapped_column(
        Enum(ChatMessageType, values_callable=lambda enum_cls: [e.value for e in enum_cls]),
    )

    # Only meaningful (non-NULL) for TEXT — see the CHECK constraint below.
    text: Mapped[str | None] = mapped_column(String(MAX_CHAT_MESSAGE_TEXT_LENGTH), nullable=True)

    # Only meaningful (non-NULL) for PHOTO/VIDEO — same idea as
    # Content.original_file_path: a plain local path today, never
    # exposed directly through the API (clients fetch bytes through an
    # access-checked route — see app/chat_message/router.py).
    file_path: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Meaningful for VIDEO and VOICE only — NULL for TEXT/PHOTO.
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)

    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)

    __table_args__ = (
        # Each message type has exactly one valid shape — text carries
        # only text, photo carries only a file, video carries a file AND
        # a duration, voice carries ONLY a duration (no file — see this
        # module's docstring on why a voice file is optional.
        CheckConstraint(
            "(type = 'text' AND text IS NOT NULL AND file_path IS NULL AND duration_seconds IS NULL) OR "
            "(type = 'photo' AND file_path IS NOT NULL AND text IS NULL AND duration_seconds IS NULL) OR "
            "(type = 'video' AND file_path IS NOT NULL AND duration_seconds IS NOT NULL AND text IS NULL) OR "
            "(type = 'voice' AND duration_seconds IS NOT NULL AND text IS NULL)",
            name="ck_chat_message_fields_match_type",
        ),
    )
