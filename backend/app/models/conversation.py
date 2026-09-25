"""
Conversation: a thread between people, and the owner of every message in
it (see TECHNICAL_REQUIREMENTS.md section 24).

Three ideas are kept apart here on purpose, because collapsing them is
what makes a messaging model impossible to extend later:

  WHO is in it          -> Conversation + ConversationParticipant
  WHAT may be done      -> capabilities, a set rather than a type
  WHY it is allowed     -> the free baseline, a paid session, or an event

In particular "text / voice / video" are NOT three kinds of conversation.
A video call with someone is part of the same relationship as the text
they sent yesterday, so it belongs in the same thread; making them
separate kinds would give one person three histories and three rows in
the chat list. They are capabilities that a conversation has, or does
not have, at a given moment.

That is also what makes the next features cheap: a video call is one
more capability, and a three-person event chat is one more participant
row. Neither needs a new table or a new kind of thread.
"""

from datetime import datetime

from sqlalchemy import (
    JSON,
    CheckConstraint,
    ForeignKey,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.core.time import UTCDateTime, utcnow

# --- kinds -------------------------------------------------------------
#
# The kind says how the thread is FORMED, not what can be done in it.
# DIRECT is the ordinary one-to-one thread, of which two people have
# exactly one, for good. GROUP and EVENT both hold any number of people;
# they are separated only because an event has an organiser and a
# lifetime, and a group does not.
CONVERSATION_DIRECT = "direct"
CONVERSATION_GROUP = "group"
CONVERSATION_EVENT = "event"
CONVERSATION_KINDS = (CONVERSATION_DIRECT, CONVERSATION_GROUP, CONVERSATION_EVENT)

# --- capabilities ------------------------------------------------------
#
# What may happen inside a conversation. Stored as a list of these
# strings rather than as booleans, so adding one later is a value, not a
# migration on every table that cares.
CAP_TEXT = "text"
CAP_STICKER = "sticker"
CAP_GIF = "gif"
CAP_VOICE = "voice"
CAP_PHOTO = "photo"
CAP_VIDEO = "video"
CAP_CALL_VOICE = "call_voice"
CAP_CALL_VIDEO = "call_video"

#: What anyone can do, with anyone, for free.
#:
#: Voice and photographs joined text here by the owner's decision: many
#: people would rather speak than type, and nobody pays to send a voice
#: note or a picture — so holding them back sold nothing and only made the
#: free conversation worse. What a paid session sells is the guarantee
#: around paying a stranger, and later the calls; not the message types.
FREE_CAPABILITIES = (CAP_TEXT, CAP_STICKER, CAP_VOICE, CAP_PHOTO)

#: What a paid session adds while it is running. The calls are absent on
#: purpose — they are not built yet, and listing a capability nothing can
#: perform would be a promise the app does not keep.
PAID_SESSION_CAPABILITIES = (
    CAP_TEXT,
    CAP_STICKER,
    CAP_GIF,
    CAP_VOICE,
    CAP_PHOTO,
    CAP_VIDEO,
)


class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[int] = mapped_column(primary_key=True)

    kind: Mapped[str] = mapped_column(String(16), default=CONVERSATION_DIRECT)

    # The two people of a DIRECT thread, written smallest id first and
    # joined with a colon ("7:12"). It exists for one reason: to make "these
    # two people already have a thread" a uniqueness rule the database
    # enforces, rather than a race between two requests that both look and
    # then both insert. NULL for group and event threads, which may have any
    # number of people and no such rule.
    direct_key: Mapped[str | None] = mapped_column(String(64), nullable=True)

    # What may be done here before any session or event is taken into
    # account. A direct thread starts at the free baseline; an event is
    # given whatever its organiser chose.
    # A JSON array rather than a join table: capabilities are read on every
    # message and never queried across conversations.
    base_capabilities: Mapped[list[str]] = mapped_column(
        JSON, default=lambda: list(FREE_CAPABILITIES)
    )

    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    # The last message's time, copied here so the chat list can be ordered
    # without touching the messages table. NULL means nobody has written
    # yet — a thread can exist before its first message, because paying for
    # a session creates one.
    last_message_at: Mapped[datetime | None] = mapped_column(
        UTCDateTime, nullable=True, index=True
    )

    participants: Mapped[list["ConversationParticipant"]] = relationship(
        back_populates="conversation", cascade="all, delete-orphan"
    )
    messages: Mapped[list["ChatMessage"]] = relationship(
        back_populates="conversation", cascade="all, delete-orphan"
    )
    sessions: Mapped[list["ChatSession"]] = relationship(back_populates="conversation")

    __table_args__ = (
        CheckConstraint(
            "kind IN ('direct', 'group', 'event')", name="ck_conversation_kind"
        ),
        # A direct thread must carry its key and the others must not, so the
        # uniqueness rule below can never be sidestepped by leaving it empty.
        CheckConstraint(
            "(kind = 'direct' AND direct_key IS NOT NULL) OR "
            "(kind <> 'direct' AND direct_key IS NULL)",
            name="ck_conversation_direct_key",
        ),
        UniqueConstraint("direct_key", name="uq_conversation_direct_key"),
    )

    @staticmethod
    def direct_key_for(one_user_id: int, other_user_id: int) -> str:
        """The key for the thread between these two, in the fixed order the
        column stores. Use it both to create and to look up, so the two can
        never disagree and produce a duplicate thread."""
        low, high = sorted((one_user_id, other_user_id))
        return f"{low}:{high}"

    def participant_for(self, user_id: int) -> "ConversationParticipant | None":
        for participant in self.participants:
            if participant.user_id == user_id and participant.left_at is None:
                return participant
        return None

    def includes(self, user_id: int) -> bool:
        return self.participant_for(user_id) is not None

    def other_user_id(self, user_id: int) -> int | None:
        """The person on the far side of a DIRECT thread. Meaningless for a
        group, where there is no single other side."""
        if self.kind != CONVERSATION_DIRECT:
            return None
        for participant in self.participants:
            if participant.user_id != user_id:
                return participant.user_id
        return None


class ConversationParticipant(Base):
    """One person's membership of, and private view onto, a conversation.

    Everything here is one-sided by design. Clearing a thread or archiving
    it changes nothing for anyone else, because a conversation several
    people took part in is not one of them to erase.
    """

    __tablename__ = "conversation_participants"

    id: Mapped[int] = mapped_column(primary_key=True)
    conversation_id: Mapped[int] = mapped_column(
        ForeignKey("conversations.id"), index=True
    )
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)

    joined_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    # Set when someone leaves a group or an event ends for them. A direct
    # thread is never left — there is no such thing as leaving a person.
    left_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)

    # "Clear this conversation": messages written BEFORE this moment are
    # hidden from this person, and the thread drops out of their list until
    # something new arrives. A timestamp rather than a flag is what makes
    # that second half work without any separate un-delete — and it is why
    # clearing can never be used as a block, which is a different act with
    # different consequences.
    cleared_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)

    # Out of the main list without being cleared. Kept per person for the
    # same reason as everything else here.
    archived: Mapped[bool] = mapped_column(default=False)

    # How far this person has read, for the unread marker.
    last_read_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)

    conversation: Mapped["Conversation"] = relationship(back_populates="participants")

    __table_args__ = (
        UniqueConstraint(
            "conversation_id", "user_id", name="uq_conversation_participant"
        ),
    )

    def clear(self, when: datetime) -> None:
        self.cleared_at = when

    def sees_message_at(self, created_at: datetime) -> bool:
        return self.cleared_at is None or created_at > self.cleared_at
