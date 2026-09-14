"""
Shared "is this user actually part of this session" check — used by
app/chat_session/router.py's own routes AND app/chat_message/router.py
(sending/reading messages needs the exact same participant check, so
this is factored out rather than duplicated, the same way
app/content/access.py holds the one shared visibility check for content).
"""

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.chat_session import ChatSession


def deleted_for(chat_session: ChatSession, user_id: int) -> bool:
    """Whether this participant has removed the conversation from their own
    side. One-sided by design: the other person still sees everything, and a
    conversation both took part in is not one of them to erase."""
    if chat_session.request.buyer_id == user_id:
        return chat_session.deleted_by_buyer_at is not None
    return chat_session.deleted_by_provider_at is not None


def get_participant_session(db: Session, session_id: int, user_id: int) -> ChatSession:
    """Loads a session and confirms `user_id` is either its buyer or its
    provider — a stranger gets a plain 404, same pattern as every other
    "only the people involved" check in this app.

    Someone who has removed it from their own side counts as a stranger here.
    Putting that in this one place is what stops it having to be remembered in
    each route: messages, files and everything else go through here."""
    chat_session = db.get(ChatSession, session_id)
    if chat_session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat session not found.")

    request = chat_session.request
    is_buyer = request.buyer_id == user_id
    is_provider = request.offer.provider_id == user_id
    if not (is_buyer or is_provider) or deleted_for(chat_session, user_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat session not found.")

    return chat_session
