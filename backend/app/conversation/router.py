"""
Conversations: the free thread between people, and everything one person
can do to their own view of it.

Messaging is free (TECHNICAL_REQUIREMENTS.md section 24), so these routes
are the ordinary way people talk. A paid session still has its own routes
under /chat-sessions, because a session is a thing with money, a clock
and a settlement; what it is NOT is a separate conversation, so its
messages land here too.
"""

from datetime import timedelta

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.chat_message.router import list_conversation_messages
from app.chat_message.schemas import ChatMessageOut
from app.chat_message.service import build_message, require_capability
from app.conversation.schemas import (
    ConversationOut,
    ConversationParticipantOut,
    OpenConversationIn,
)
from app.conversation.service import (
    active_paid_session,
    capabilities_now,
    get_or_create_direct,
    touch,
)
from app.core.database import get_db
from app.core.time import utcnow
from app.models.block import Block
from app.models.chat_message import ChatMessage, ChatMessageType
from app.models.conversation import (
    CONVERSATION_DIRECT,
    Conversation,
    ConversationParticipant,
)
from app.models.user import User
from app.profile.photos import get_current_avatar_urls

router = APIRouter(prefix="/conversations", tags=["conversations"])

#: How many people someone may write to for the first time in a day.
#:
#: Not a cap on messaging — an existing conversation is never limited,
#: because two people talking is the product. It caps how many STRANGERS
#: one account can approach, which is the shape every messaging-spam
#: problem has. Deliberately generous: nobody talking to people in good
#: faith will ever see it.
MAX_NEW_CONVERSATIONS_PER_DAY = 20


def _participant_or_404(
    db: Session, conversation_id: int, user_id: int
) -> tuple[Conversation, ConversationParticipant]:
    """Loads a conversation and the caller's own membership of it.

    A stranger gets a plain 404, the same pattern as every other "only the
    people involved" check in this app — telling them a thread exists
    would itself be a disclosure.
    """
    conversation = db.get(Conversation, conversation_id)
    if conversation is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found.")
    participant = conversation.participant_for(user_id)
    if participant is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found.")
    return conversation, participant


def _blocked_between(db: Session, one_user_id: int, other_user_id: int) -> bool:
    """Whether either of these two has blocked the other.

    Symmetric on purpose even though a block is one-directional: if A has
    blocked B, then B writing to A must fail, and A writing to B would be
    absurd. One check covers both.
    """
    return db.scalar(
        select(func.count(Block.id)).where(
            or_(
                (Block.blocker_id == one_user_id) & (Block.blocked_id == other_user_id),
                (Block.blocker_id == other_user_id) & (Block.blocked_id == one_user_id),
            )
        )
    ) > 0


def _todays_new_conversations(db: Session, user_id: int) -> int:
    since = utcnow() - timedelta(days=1)
    return db.scalar(
        select(func.count(ConversationParticipant.id)).where(
            ConversationParticipant.user_id == user_id,
            ConversationParticipant.joined_at >= since,
        )
    )


def serialize(
    db: Session, conversation: Conversation, participant: ConversationParticipant
) -> ConversationOut:
    others = [
        p for p in conversation.participants if p.user_id != participant.user_id
    ]
    avatars = get_current_avatar_urls(db, [p.user_id for p in others])
    users = {
        user.id: user
        for user in db.scalars(
            select(User).where(User.id.in_([p.user_id for p in others]))
        )
    }

    session = active_paid_session(db, conversation.id)

    last_message = db.scalar(
        select(ChatMessage)
        .where(ChatMessage.conversation_id == conversation.id)
        .order_by(ChatMessage.created_at.desc(), ChatMessage.id.desc())
        .limit(1)
    )
    # A preview the viewer is not allowed to see would leak the content of
    # a thread they cleared, so it follows exactly the same rule the
    # message list does.
    visible_preview = (
        last_message is not None
        and participant.sees_message_at(last_message.created_at)
        and last_message.type == ChatMessageType.TEXT
    )

    return ConversationOut(
        id=conversation.id,
        kind=conversation.kind,
        created_at=conversation.created_at,
        last_message_at=conversation.last_message_at,
        others=[
            ConversationParticipantOut(
                user_id=p.user_id,
                display_name=users[p.user_id].display_name,
                username=users[p.user_id].username,
                avatar_url=avatars.get(p.user_id),
            )
            for p in others
            if p.user_id in users
        ],
        capabilities=capabilities_now(conversation, session),
        active_session_id=session.id if session is not None else None,
        archived=participant.archived,
        unread=(
            conversation.last_message_at is not None
            and (
                participant.last_read_at is None
                or conversation.last_message_at > participant.last_read_at
            )
            and (
                last_message is not None
                and last_message.sender_id != participant.user_id
            )
        ),
        last_text=last_message.text if visible_preview else None,
    )


@router.get("", response_model=list[ConversationOut])
def list_conversations(
    archived: bool = False,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ConversationOut]:
    """Every thread this person is in, most recent first.

    A cleared thread with nothing said since is left out: clearing it means
    they wanted it gone, and it comes back on its own when somebody writes.
    """
    rows = db.scalars(
        select(ConversationParticipant).where(
            ConversationParticipant.user_id == current_user.id,
            ConversationParticipant.left_at.is_(None),
            ConversationParticipant.archived == archived,
        )
    ).all()

    out: list[ConversationOut] = []
    for participant in rows:
        conversation = participant.conversation
        if conversation.last_message_at is None:
            # Nothing said yet. A thread created by paying for a session
            # still belongs in the list, because the buyer is waiting in it.
            if active_paid_session(db, conversation.id) is None:
                continue
        elif not participant.sees_message_at(conversation.last_message_at):
            continue
        out.append(serialize(db, conversation, participant))

    out.sort(key=lambda c: c.last_message_at or c.created_at, reverse=True)
    return out


@router.post("", response_model=ConversationOut, status_code=status.HTTP_201_CREATED)
def open_conversation(
    payload: OpenConversationIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ConversationOut:
    """Opens the thread with someone, or returns the one that exists.

    Safe to call every time the chat screen opens: two people have exactly
    one thread, so this is "give me it" rather than "make a new one".
    """
    if payload.user_id == current_user.id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, detail={"reason": "cannot_message_yourself"}
        )
    other = db.get(User, payload.user_id)
    if other is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found.")

    # A block is silent, so this reads as "no such person to talk to"
    # rather than announcing that somebody blocked you.
    if _blocked_between(db, current_user.id, other.id):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, detail={"reason": "unavailable"}
        )

    existing = db.scalar(
        select(Conversation).where(
            Conversation.direct_key
            == Conversation.direct_key_for(current_user.id, other.id)
        )
    )
    if existing is None and _todays_new_conversations(db, current_user.id) >= (
        MAX_NEW_CONVERSATIONS_PER_DAY
    ):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "reason": "daily_new_conversation_limit",
                "limit": MAX_NEW_CONVERSATIONS_PER_DAY,
            },
        )

    conversation = get_or_create_direct(db, current_user.id, other.id)
    db.commit()
    db.refresh(conversation)
    participant = conversation.participant_for(current_user.id)
    return serialize(db, conversation, participant)


@router.get("/{conversation_id}", response_model=ConversationOut)
def get_conversation(
    conversation_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ConversationOut:
    conversation, participant = _participant_or_404(db, conversation_id, current_user.id)
    return serialize(db, conversation, participant)


@router.get("/{conversation_id}/messages", response_model=list[ChatMessageOut])
def list_messages(
    conversation_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ChatMessage]:
    _participant_or_404(db, conversation_id, current_user.id)
    return list_conversation_messages(db, conversation_id, current_user.id)


@router.post(
    "/{conversation_id}/messages",
    response_model=ChatMessageOut,
    status_code=status.HTTP_201_CREATED,
)
def send_message(
    conversation_id: int,
    message_type: ChatMessageType = Form(ChatMessageType.TEXT, alias="type"),
    text: str | None = Form(None),
    duration_seconds: int | None = Form(None),
    file: UploadFile | None = File(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChatMessage:
    """Says something in a thread.

    What may be said is decided by the thread's capabilities at this exact
    moment — free text always, and the rest only while a paid session is
    running. The check is here rather than in the app, because the app's
    composer is a convenience and this is the rule.
    """
    conversation, participant = _participant_or_404(db, conversation_id, current_user.id)

    if conversation.kind == CONVERSATION_DIRECT:
        other_user_id = conversation.other_user_id(current_user.id)
        if other_user_id is not None and _blocked_between(
            db, current_user.id, other_user_id
        ):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, detail={"reason": "unavailable"}
            )

    session = active_paid_session(db, conversation.id)
    require_capability(message_type, capabilities_now(conversation, session))

    message = build_message(
        conversation_id=conversation.id,
        # A message sent while a session is running belongs to it, so that
        # a complaint can point at exactly the messages of the session it
        # is about.
        chat_session_id=session.id if session is not None else None,
        sender_id=current_user.id,
        message_type=message_type,
        text=text,
        duration_seconds=duration_seconds,
        file=file,
    )
    db.add(message)
    db.flush()

    touch(conversation, message.created_at)
    # Writing brings the thread back for the sender; their own message is
    # the one thing they definitely still want to see.
    if participant.cleared_at is not None:
        participant.cleared_at = None
    participant.last_read_at = message.created_at

    db.commit()
    db.refresh(message)
    return message


@router.post("/{conversation_id}/read", status_code=status.HTTP_204_NO_CONTENT)
def mark_read(
    conversation_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    _, participant = _participant_or_404(db, conversation_id, current_user.id)
    participant.last_read_at = utcnow()
    db.commit()


@router.post("/{conversation_id}/archive", status_code=status.HTTP_204_NO_CONTENT)
def archive(
    conversation_id: int,
    archived: bool = True,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    _, participant = _participant_or_404(db, conversation_id, current_user.id)
    participant.archived = archived
    db.commit()


@router.delete("/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
def clear_conversation(
    conversation_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Clears a thread from this person's own side.

    One write, not one per message: a single timestamp hides everything
    older, and anything said afterwards appears normally. The other person
    sees no change at all — a conversation two people took part in is not
    one of them to erase.

    This is not a block. Someone who writes again will reach them, which
    is why blocking exists separately.
    """
    _, participant = _participant_or_404(db, conversation_id, current_user.id)
    participant.clear(utcnow())
    db.commit()
