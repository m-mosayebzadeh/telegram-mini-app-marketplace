"""
The rules for what can be done to a message after it was sent.

Kept apart from the routes so the rules read in one place, and so the
paid-session exception — which is the whole reason these rules are not
simply "the sender may do anything" — cannot be applied in one route and
forgotten in another.
"""

from __future__ import annotations

from datetime import timedelta

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.chat_message.payment_details import find_payment_details
from app.chat_message.schemas import ChatMessageOut, ReactionOut, ReplyPreview
from app.core.time import utcnow
from app.models.chat_message import MAX_CHAT_MESSAGE_TEXT_LENGTH, ChatMessage, ChatMessageType
from app.models.conversation import Conversation
from app.models.message_actions import (
    MAX_REACTION_LENGTH,
    HiddenMessage,
    MessageEdit,
    MessageReaction,
)

#: In a paid session a message can be changed or taken back only briefly.
#: Section 24.1: there a message is a promise, and a promise should not be
#: quietly rewritten once the other side has had a chance to rely on it.
PAID_GRACE = timedelta(minutes=3)

#: The most messages one delete may cover. Enough for any selection a
#: person makes by hand; a request for thousands is not a person.
MAX_DELETE_AT_ONCE = 100


def locked_by_session(conversation: Conversation, message: ChatMessage) -> bool:
    """Whether a paid session's rule forbids changing this message now.

    A free message is never locked. One written during a paid session is
    open only while BOTH hold: nobody else has read it yet, and it is less
    than a few minutes old. Whichever ends first closes it.
    """
    if message.chat_session_id is None:
        return False
    if utcnow() - message.created_at > PAID_GRACE:
        return True
    return any(
        p.last_read_at is not None and p.last_read_at >= message.created_at
        for p in conversation.participants
        if p.user_id != message.sender_id
    )


def message_in(db: Session, conversation_id: int, message_id: int) -> ChatMessage:
    """A live message of this thread, or 404 — the same answer for one that
    never existed, one in another thread, and one already deleted."""
    message = db.get(ChatMessage, message_id)
    if message is None or message.conversation_id != conversation_id or message.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Message not found.")
    return message


def edit_text(conversation: Conversation, message: ChatMessage, editor_id: int, text: str) -> MessageEdit:
    """Changes what a text message says, keeping what it said before.

    The new text goes through the same payment-detail check as a new
    message. Without that, an edit would be the easy way round the warning:
    send "hi", then change it to a card number.

    The flag only ever turns on. A message that once carried a card number
    stays counted for staff even if it is edited back to "hi" — otherwise
    editing would also be the way to hide from them.
    """
    if message.sender_id != editor_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the sender can edit a message.")
    if message.type != ChatMessageType.TEXT:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Only text can be edited.")
    if not text or not text.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "text is required.")
    if len(text) > MAX_CHAT_MESSAGE_TEXT_LENGTH:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"text must be at most {MAX_CHAT_MESSAGE_TEXT_LENGTH} characters.",
        )
    if locked_by_session(conversation, message):
        raise HTTPException(status.HTTP_409_CONFLICT, detail={"reason": "locked_by_session"})

    before = MessageEdit(message_id=message.id, previous_text=message.text or "")
    message.text = text
    message.edited_at = utcnow()
    message.flagged_payment = message.flagged_payment or bool(find_payment_details(text))
    return before


def delete_messages(
    db: Session,
    conversation: Conversation,
    user_id: int,
    message_ids: list[int],
    for_everyone: bool,
) -> tuple[list[int], list[int]]:
    """Removes messages, for everyone or only from this person's view.

    Returns (removed for everyone, hidden for this person only).

    For everyone only where it is allowed: your own message, and — in a paid
    session — only while it is still open (locked_by_session). Anything else
    in the same request is hidden from your own view instead, which is what
    deleting somebody else's message means anyway. Nothing is ever removed
    from the database.
    """
    everyone: list[int] = []
    only_me: list[int] = []
    now = utcnow()
    for message_id in dict.fromkeys(message_ids):
        message = db.get(ChatMessage, message_id)
        if message is None or message.conversation_id != conversation.id or message.deleted_at is not None:
            continue
        if for_everyone and message.sender_id == user_id and not locked_by_session(conversation, message):
            message.deleted_at = now
            everyone.append(message.id)
        else:
            if db.get(HiddenMessage, (user_id, message.id)) is None:
                db.add(HiddenMessage(user_id=user_id, message_id=message.id))
            only_me.append(message.id)
    return everyone, only_me


def is_emoji(value: str) -> bool:
    """Loose on purpose: an emoji is many code points in many shapes, and a
    strict list would reject every new one Unicode adds. What matters is
    that a reaction cannot be used to send words — no letters, no digits,
    no spaces — and stays short."""
    if not value or len(value) > MAX_REACTION_LENGTH:
        return False
    return not any(ch.isalnum() or ch.isspace() for ch in value)


def set_reaction(db: Session, message: ChatMessage, user_id: int, emoji: str | None) -> None:
    """Sets, replaces or (with None) removes this person's reaction."""
    existing = db.get(MessageReaction, (message.id, user_id))
    if emoji is None:
        if existing is not None:
            db.delete(existing)
        return
    if not is_emoji(emoji):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "A reaction must be a single emoji.")
    if existing is None:
        db.add(MessageReaction(message_id=message.id, user_id=user_id, emoji=emoji))
    else:
        existing.emoji = emoji
        existing.created_at = utcnow()


def reactions_of(db: Session, message_ids: list[int]) -> dict[int, list[ReactionOut]]:
    """Every reaction on these messages, oldest first, in one query."""
    found: dict[int, list[ReactionOut]] = {}
    if not message_ids:
        return found
    rows = db.scalars(
        select(MessageReaction)
        .where(MessageReaction.message_id.in_(message_ids))
        .order_by(MessageReaction.created_at.asc())
    )
    for row in rows:
        found.setdefault(row.message_id, []).append(ReactionOut(user_id=row.user_id, emoji=row.emoji))
    return found


def messages_out(db: Session, messages: list[ChatMessage]) -> list[ChatMessageOut]:
    """Messages as the app receives them, with what they reply to and the
    reactions on them — loaded for the whole list at once, not per message.

    The same for every viewer, so that one copy can be pushed down the live
    connection to everyone in the thread. Which reaction is "yours" the app
    works out itself from the user ids.
    """
    reply_ids = {m.reply_to_id for m in messages if m.reply_to_id is not None}
    replied = (
        {m.id: m for m in db.scalars(select(ChatMessage).where(ChatMessage.id.in_(reply_ids)))}
        if reply_ids
        else {}
    )
    reactions = reactions_of(db, [m.id for m in messages])

    out: list[ChatMessageOut] = []
    for message in messages:
        shaped = ChatMessageOut.model_validate(message)
        target = replied.get(message.reply_to_id) if message.reply_to_id else None
        # A reply to a message that was since deleted keeps its own text but
        # loses the quote: showing the quote would bring the deleted words
        # back.
        if target is not None and target.deleted_at is None:
            shaped.reply_to = ReplyPreview(
                id=target.id, sender_id=target.sender_id, type=target.type.value, text=target.text
            )
        shaped.reactions = reactions.get(message.id, [])
        out.append(shaped)
    return out
