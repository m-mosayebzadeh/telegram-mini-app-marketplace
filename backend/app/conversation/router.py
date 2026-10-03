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

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user, seen_roughly
from app.core.presence import hiding_online, masked_seen
from app.models.friendship import FRIENDSHIP_ACCEPTED, Friendship
from app.models.profile import CHAT_DOOR_FRIENDS, Profile
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
    kept_random_thread,
    capabilities_now,
    get_or_create_direct,
    touch,
)
from app.core.database import get_db
from app.core.time import utcnow
from app.chat_message.actions import (
    MAX_DELETE_AT_ONCE,
    delete_messages,
    edit_text,
    message_in,
    messages_out,
    set_reaction,
)
from app.core.new_people import new_people_left, new_people_limit
from app.live.events import (
    announce_cleared,
    announce_deleted,
    announce_edited,
    announce_message,
    announce_reactions,
    announce_read,
)
from app.models.block import Block
from app.models.chat_message import ChatMessage, ChatMessageType
from app.models.conversation import (
    CONVERSATION_DIRECT,
    Conversation,
    ConversationParticipant,
)
from app.models.message_actions import HiddenMessage
from app.models.random_chat import RandomChatSession
from app.models.user import User
from app.profile.photos import get_current_avatar_urls
from app.profile.note import fresh_note

router = APIRouter(prefix="/conversations", tags=["conversations"])

# How many strangers someone may approach in a day now lives in one budget
# shared with Echo (app/core/new_people.py), set from the panel. Not a cap
# on messaging: an existing conversation is never limited, because two
# people talking is the product.


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


def _door_open_to(db: Session, owner_id: int, visitor_id: int) -> bool:
    """Whether `visitor_id` may start a conversation with `owner_id`."""
    door = db.scalar(select(Profile.chat_door).where(Profile.user_id == owner_id))
    if door != CHAT_DOOR_FRIENDS:
        return True
    low, high = sorted((owner_id, visitor_id))
    return db.scalar(
        select(Friendship.id).where(
            Friendship.user_low_id == low,
            Friendship.user_high_id == high,
            Friendship.status == FRIENDSHIP_ACCEPTED,
        )
    ) is not None


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


def _unread_count(
    db: Session, conversation: Conversation, participant: ConversationParticipant
) -> int:
    """How many messages from the others this person has not read yet.

    Counted by the same rules as what they can see: nothing deleted for
    everyone, nothing they hid for themselves, nothing from before they
    cleared the thread. Otherwise the number on the stair would promise
    messages that are not there when the conversation opens.
    """
    query = select(func.count(ChatMessage.id)).where(
        ChatMessage.conversation_id == conversation.id,
        ChatMessage.sender_id != participant.user_id,
        ChatMessage.deleted_at.is_(None),
        ChatMessage.id.not_in(
            select(HiddenMessage.message_id).where(HiddenMessage.user_id == participant.user_id)
        ),
    )
    if participant.last_read_at is not None:
        query = query.where(ChatMessage.created_at > participant.last_read_at)
    if participant.cleared_at is not None:
        query = query.where(ChatMessage.created_at > participant.cleared_at)
    return db.scalar(query) or 0


def _origin(db: Session, conversation: Conversation) -> str:
    """How these people met, for the line under the row: "echo" when an
    Echo meeting created this thread, "world" when somebody said hello.

    Only the meeting that CREATED the thread counts. Two people who already
    talked and later met again through Echo still met in the world first.
    """
    made_by_echo = db.scalar(
        select(RandomChatSession.id).where(
            RandomChatSession.conversation_id == conversation.id,
            RandomChatSession.created_conversation.is_(True),
        ).limit(1)
    )
    return "echo" if made_by_echo is not None else "world"


def _is_unread(
    conversation: Conversation,
    participant: ConversationParticipant,
    last_message: ChatMessage | None,
) -> bool:
    """Something arrived after this person last read the thread, and it was
    not them who said it. The one definition of "unread", used by the row
    itself, by the order of the list and by the count on the door."""
    return (
        conversation.last_message_at is not None
        and (
            participant.last_read_at is None
            or conversation.last_message_at > participant.last_read_at
        )
        and last_message is not None
        and last_message.sender_id != participant.user_id
    )


def _last_message(db: Session, conversation_id: int) -> ChatMessage | None:
    """The newest message still standing in a thread."""
    return db.scalar(
        select(ChatMessage)
        .where(
            ChatMessage.conversation_id == conversation_id,
            ChatMessage.deleted_at.is_(None),
        )
        .order_by(ChatMessage.created_at.desc(), ChatMessage.id.desc())
        .limit(1)
    )


def _unread_cheaply(db: Session, participant: ConversationParticipant) -> bool:
    """`_is_unread` without describing the whole thread. The date check is
    free and rules out almost every read thread, so the one extra query
    runs only for threads that may really be unread."""
    conversation = participant.conversation
    if conversation.last_message_at is None or (
        participant.last_read_at is not None
        and conversation.last_message_at <= participant.last_read_at
    ):
        return False
    return _is_unread(conversation, participant, _last_message(db, conversation.id))


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

    # Whoever hides when they are online, either side (core/presence.py).
    hiders = hiding_online(db, [participant.user_id, *users])

    session = active_paid_session(db, conversation.id)

    # A message deleted for everyone must not live on as the preview.
    last_message = _last_message(db, conversation.id)
    # A preview the viewer is not allowed to see would leak the content of
    # a thread they cleared, so it follows exactly the same rule the
    # message list does.
    visible_preview = (
        last_message is not None
        and participant.sees_message_at(last_message.created_at)
        and last_message.type == ChatMessageType.TEXT
    )

    return ConversationOut(
        unread_count=_unread_count(db, conversation, participant),
        origin=_origin(db, conversation),
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
                seen=masked_seen(
                    seen_roughly(users[p.user_id]),
                    hidden=participant.user_id in hiders or p.user_id in hiders,
                ),
            )
            for p in others
            if p.user_id in users
        ],
        capabilities=capabilities_now(conversation, session),
        active_session_id=session.id if session is not None else None,
        archived=participant.archived,
        muted=participant.muted,
        pinned=participant.pinned_at is not None,
        unread=_is_unread(conversation, participant, last_message),
        last_text=last_message.text if visible_preview else None,
        others_read_at=max(
            (p.last_read_at for p in others if p.last_read_at is not None),
            default=None,
        ),
    )


def _visible_threads(
    db: Session, current_user: User, archived: bool
) -> list[ConversationParticipant]:
    """The threads this person should see in their list, unordered.

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

    kept: list[ConversationParticipant] = []
    for participant in rows:
        conversation = participant.conversation
        if conversation.last_message_at is None:
            # Nothing said yet. Two things still make an empty thread worth
            # showing: a paid session, because the buyer is waiting in it,
            # and a random meeting this person asked to keep — saying "keep
            # this one" is itself the act that makes the thread theirs.
            if active_paid_session(db, conversation.id) is None and not kept_random_thread(
                db, conversation.id, current_user.id
            ):
                continue
        if participant.hidden_from_list(conversation.last_message_at):
            # Deleted from this side, and nothing said since.
            continue
        kept.append(participant)

    return kept


@router.get("", response_model=list[ConversationOut])
def list_conversations(
    archived: bool = False,
    limit: int | None = Query(None, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ConversationOut]:
    """The threads this person is in — pinned first, in the order they
    were pinned, then the most recent — a page at a time. What is left out
    is decided in `_visible_threads`.

    `limit`/`offset` page through them. Only the page is fully described
    (people, previews, unread counts), because describing a thread costs
    several queries: somebody with three hundred conversations used to pay
    for all three hundred every time the stair opened (the owner felt it).
    Without `limit`, everything, as before.
    """
    kept = _visible_threads(db, current_user, archived)
    # By date, newest first — not unread first: the owner may not want to
    # look at one message for days (section 32). Pinned chats come before
    # everything, the first pinned highest. Decided here, over every
    # thread, because the phone only ever holds the first page.
    # Ordered and cut BEFORE the expensive part, so a page costs a page.
    kept.sort(
        key=lambda p: p.conversation.last_message_at or p.conversation.created_at,
        reverse=True,
    )
    # Stable, so the unpinned keep the date order from the line above.
    kept.sort(key=lambda p: (p.pinned_at is None, p.pinned_at.timestamp() if p.pinned_at else 0))
    page = kept[offset : offset + limit] if limit is not None else kept[offset:]
    return [serialize(db, p.conversation, p) for p in page]


class UnreadOut(BaseModel):
    conversations: int


@router.get("/unread", response_model=UnreadOut)
def unread_conversations(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UnreadOut:
    """How many threads have something unread, across ALL of them — the
    number on the conversations door and in the list's header. Its own
    question so neither has to fetch every conversation to count them."""
    return UnreadOut(
        conversations=sum(
            1
            for p in _visible_threads(db, current_user, archived=False)
            # A muted chat asked not to be counted.
            if not p.muted and _unread_cheaply(db, p)
        )
    )


class NewPeopleOut(BaseModel):
    limit: int
    left: int


@router.get("/new-people", response_model=NewPeopleOut)
def new_people_today(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> NewPeopleOut:
    """How many strangers this person can still meet today, across "say
    hello" and Echo. The world asks before saying hello, so the eleventh
    person gets a sentence rather than an error."""
    return NewPeopleOut(limit=new_people_limit(db), left=new_people_left(db, current_user.id))


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
    # Their door (privacy settings): "only my friends" closes a new
    # conversation to anybody who is not their friend. A conversation that
    # already exists stays open — the setting is about who may start one.
    if existing is None and not _door_open_to(db, other.id, current_user.id):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, detail={"reason": "door_friends"}
        )

    if existing is None and new_people_left(db, current_user.id) <= 0:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"reason": "daily_new_people_limit", "limit": new_people_limit(db)},
        )

    conversation = get_or_create_direct(db, current_user.id, other.id, opened_by=current_user.id)
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
) -> list[ChatMessageOut]:
    _participant_or_404(db, conversation_id, current_user.id)
    return messages_out(db, list_conversation_messages(db, conversation_id, current_user.id))


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
    client_id: str | None = Form(None, max_length=64),
    reply_to_id: int | None = Form(None),
    to_note: bool = Form(False),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChatMessageOut:
    """Says something in a thread.

    `to_note` answers the other person's note of the day: the server copies
    their note as it stands right now onto the message, so the reply keeps
    its sense after the note is gone. If the note has already faded, the
    message is simply sent without a quote — the words still matter more
    than what prompted them.

    `client_id` makes sending safe to repeat: the same one twice from the
    same person returns the first message instead of saving a second (see
    ChatMessage.client_id). The phone repeats a send whenever it never saw
    the answer, so without this a weak connection doubles messages.

    What may be said is decided by the thread's capabilities at this exact
    moment — free text always, and the rest only while a paid session is
    running. The check is here rather than in the app, because the app's
    composer is a convenience and this is the rule.
    """
    conversation, participant = _participant_or_404(db, conversation_id, current_user.id)

    if client_id:
        already = _already_sent(db, current_user.id, client_id)
        if already is not None:
            return messages_out(db, [already])[0]

    if reply_to_id is not None:
        # Only a message of this same thread, and one still there: a reply
        # pointing into another conversation would leak its text through
        # the quote.
        message_in(db, conversation.id, reply_to_id)

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
    message.client_id = client_id
    message.reply_to_id = reply_to_id
    if to_note and conversation.kind == CONVERSATION_DIRECT:
        other_id = conversation.other_user_id(current_user.id)
        if other_id is not None:
            message.note_quote = fresh_note(
                db.scalar(select(Profile).where(Profile.user_id == other_id))
            )
    try:
        # Inside a savepoint so that losing a race with an identical retry
        # (both passed the check above at once) undoes only this insert.
        with db.begin_nested():
            db.add(message)
            db.flush()
    except IntegrityError:
        already = _already_sent(db, current_user.id, client_id) if client_id else None
        if already is None:
            raise
        return messages_out(db, [already])[0]

    touch(conversation, message.created_at)
    # Writing brings the thread back for the sender; their own message is
    # the one thing they definitely still want to see.
    if participant.cleared_at is not None:
        participant.cleared_at = None
    participant.last_read_at = message.created_at

    db.commit()
    db.refresh(message)
    announce_message(db, conversation, message)
    return messages_out(db, [message])[0]


class EditIn(BaseModel):
    text: str


@router.patch("/{conversation_id}/messages/{message_id}", response_model=ChatMessageOut)
def edit_message(
    conversation_id: int,
    message_id: int,
    body: EditIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChatMessageOut:
    """Changes the text of your own message. The earlier text is kept for
    staff (app/chat_message/actions.py, edit_text)."""
    conversation, _ = _participant_or_404(db, conversation_id, current_user.id)
    message = message_in(db, conversation.id, message_id)
    db.add(edit_text(conversation, message, current_user.id, body.text))
    db.commit()
    db.refresh(message)
    announce_edited(db, conversation, message)
    return messages_out(db, [message])[0]


class DeleteIn(BaseModel):
    message_ids: list[int] = Field(min_length=1, max_length=MAX_DELETE_AT_ONCE)
    #: Also remove them for the other person. Honoured only for your own
    #: messages, and in a paid session only while they are still open.
    for_everyone: bool = False


class DeleteOut(BaseModel):
    for_everyone: list[int]
    only_for_me: list[int]


@router.post("/{conversation_id}/messages/delete", response_model=DeleteOut)
def delete_messages_route(
    conversation_id: int,
    body: DeleteIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DeleteOut:
    """Deletes one or many messages at once — a single tap in the menu and
    a whole selection are the same request."""
    conversation, _ = _participant_or_404(db, conversation_id, current_user.id)
    everyone, only_me = delete_messages(
        db, conversation, current_user.id, body.message_ids, body.for_everyone
    )
    db.commit()
    announce_deleted(conversation, everyone, only_for=None)
    announce_deleted(conversation, only_me, only_for=current_user.id)
    return DeleteOut(for_everyone=everyone, only_for_me=only_me)


class ReactionIn(BaseModel):
    #: The emoji, or null to take your reaction back.
    emoji: str | None


@router.put("/{conversation_id}/messages/{message_id}/reaction", status_code=status.HTTP_204_NO_CONTENT)
def react(
    conversation_id: int,
    message_id: int,
    body: ReactionIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    conversation, _ = _participant_or_404(db, conversation_id, current_user.id)
    message = message_in(db, conversation.id, message_id)
    set_reaction(db, message, current_user.id, body.emoji)
    db.commit()
    announce_reactions(db, conversation, message.id)


def _already_sent(db: Session, sender_id: int, client_id: str) -> ChatMessage | None:
    return db.scalar(
        select(ChatMessage).where(
            ChatMessage.sender_id == sender_id, ChatMessage.client_id == client_id
        )
    )


@router.get("/{conversation_id}/messages/{message_id}/file")
def get_message_file(
    conversation_id: int,
    message_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FileResponse:
    """The bytes of a photograph or voice note in a conversation.

    Held to exactly the same rule as the message list: if this person
    cannot see the message — because it is not their conversation, or
    because they cleared the thread before it — they cannot fetch its file
    either. A file that stayed reachable after its message was hidden would
    make "clear this conversation" a lie.

    A stranger, a missing message and a message with no file all get the
    same 404. The caller cannot tell them apart and does not need to.
    """
    _, participant = _participant_or_404(db, conversation_id, current_user.id)

    message = db.get(ChatMessage, message_id)
    if (
        message is None
        or message.conversation_id != conversation_id
        or message.file_path is None
        or not participant.sees_message_at(message.created_at)
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found.")

    return FileResponse(message.file_path)


@router.post("/{conversation_id}/read", status_code=status.HTTP_204_NO_CONTENT)
def mark_read(
    conversation_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    conversation, participant = _participant_or_404(db, conversation_id, current_user.id)
    participant.last_read_at = utcnow()
    db.commit()
    announce_read(conversation, current_user.id, participant.last_read_at)


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


def _sides(
    conversation: Conversation, participant: ConversationParticipant, for_everyone: bool
) -> list[ConversationParticipant]:
    """Whose view a clear or a delete applies to: yours, or — when the box
    "also for them" is ticked — everybody's in the thread."""
    if not for_everyone:
        return [participant]
    return [p for p in conversation.participants if p.left_at is None]


@router.delete("/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_conversation(
    conversation_id: int,
    for_everyone: bool = False,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Deletes the chat: its messages are hidden and it leaves the list.

    From your own side unless `for_everyone` — the "also delete for them"
    box, which the owner asked for (section 32), as in Telegram. Either way
    it is one timestamp per person, never one write per message, and the
    messages themselves stay stored, so a complaint about them can still be
    looked into.

    Not a block: somebody who writes again brings the chat back.
    """
    conversation, participant = _participant_or_404(db, conversation_id, current_user.id)
    now = utcnow()
    for side in _sides(conversation, participant, for_everyone):
        side.hide(now)
    db.commit()
    if for_everyone:
        announce_cleared(conversation)


@router.post("/{conversation_id}/clear", status_code=status.HTTP_204_NO_CONTENT)
def clear_history(
    conversation_id: int,
    for_everyone: bool = False,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Clears the history: the messages so far are hidden, and the chat
    stays in the list, empty, ready for the next word. For both sides when
    `for_everyone` is ticked."""
    conversation, participant = _participant_or_404(db, conversation_id, current_user.id)
    now = utcnow()
    for side in _sides(conversation, participant, for_everyone):
        side.clear(now)
    db.commit()
    if for_everyone:
        announce_cleared(conversation)


#: How many chats may be pinned at once (the owner's number).
MAX_PINNED = 5


@router.post("/{conversation_id}/pin", status_code=status.HTTP_204_NO_CONTENT)
def pin(
    conversation_id: int,
    pinned: bool = True,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Pins the chat to the top of your list, or unpins it. At most five;
    the sixth is refused with a reason the app can say in words."""
    _, participant = _participant_or_404(db, conversation_id, current_user.id)
    if not pinned:
        participant.pinned_at = None
        db.commit()
        return
    if participant.pinned_at is not None:
        return
    already = db.scalar(
        select(func.count(ConversationParticipant.id)).where(
            ConversationParticipant.user_id == current_user.id,
            ConversationParticipant.pinned_at.is_not(None),
        )
    )
    if already >= MAX_PINNED:
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail={"reason": "pin_limit", "limit": MAX_PINNED}
        )
    participant.pinned_at = utcnow()
    db.commit()


@router.post("/{conversation_id}/mute", status_code=status.HTTP_204_NO_CONTENT)
def mute(
    conversation_id: int,
    muted: bool = True,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Mutes or unmutes the chat, for you alone."""
    _, participant = _participant_or_404(db, conversation_id, current_user.id)
    participant.muted = muted
    db.commit()
