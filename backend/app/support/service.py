"""
Who answers people who wrote to Cosmos Team, and how two of them never
answer the same person at once (TECHNICAL_REQUIREMENTS.md section 43;
the tables are app/models/support.py).

Staff act AS the team inside a team conversation: they read it from the
team's side and what they send is sent by the team. Everything that
decides "may this person act as the team here" is in this file, so the
conversation routes only ask one question (`acting_side`).
"""

from __future__ import annotations

from datetime import timedelta

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.dependencies import effective_admin_scopes, is_owner
from app.core import team
from app.core.config import settings
from app.core.time import utcnow
from app.models.admin_grant import AdminGrant
from app.models.conversation import CONVERSATION_DIRECT, Conversation
from app.models.role import Role
from app.models.support import SupportLock, SupportOpening
from app.models.user import User

#: The permission, given through a role (section 43: permissions first,
#: then roles made of them).
SCOPE = "support.conversations"

#: A lock frees itself this long after its holder last did anything.
LOCK_FOR = timedelta(minutes=10)


def can_support(db: Session, user: User) -> bool:
    return is_owner(user) or SCOPE in effective_admin_scopes(db, user.id)


def staff_ids(db: Session) -> list[int]:
    """Everybody who may answer: holders of an active role with the
    permission, and the owner. Asked only when a team conversation moves,
    never on a clock."""
    ids: set[int] = set()
    for user_id, scopes in db.execute(
        select(AdminGrant.user_id, Role.scopes).join(Role, Role.id == AdminGrant.role_id).where(Role.is_active.is_(True))
    ):
        if SCOPE in (scopes or []):
            ids.add(user_id)
    if settings.owner_telegram_id is not None:
        ids.update(db.scalars(select(User.id).where(User.telegram_id == settings.owner_telegram_id)))
    return sorted(ids)


def is_team_conversation(db: Session, conversation: Conversation) -> bool:
    if conversation.kind != CONVERSATION_DIRECT:
        return False
    return any(team.is_team(db.get(User, p.user_id)) for p in conversation.participants)


def acting_side(db: Session, conversation: Conversation, user: User) -> int | None:
    """The id this person acts as in `conversation`: themselves when they
    are in it, the team when it is a team conversation and they may
    answer for the team, otherwise None (a stranger)."""
    if conversation.participant_for(user.id) is not None:
        return user.id
    if is_team_conversation(db, conversation) and can_support(db, user):
        return team.team_user(db).id
    return None


def team_conversations(db: Session) -> list[Conversation]:
    """Every conversation somebody has with the team where something has
    been said, newest first."""
    team_id = team.team_user(db).id
    from app.models.conversation import ConversationParticipant

    return list(
        db.scalars(
            select(Conversation)
            .join(ConversationParticipant, ConversationParticipant.conversation_id == Conversation.id)
            .where(
                ConversationParticipant.user_id == team_id,
                Conversation.kind == CONVERSATION_DIRECT,
                Conversation.last_message_at.is_not(None),
            )
            .order_by(Conversation.last_message_at.desc())
        )
    )


def live_lock(db: Session, conversation_id: int) -> SupportLock | None:
    """The lock on a conversation if it still holds, else None."""
    lock = db.get(SupportLock, conversation_id)
    if lock is None:
        return None
    if not lock.handed and utcnow() - lock.touched_at > LOCK_FOR:
        return None
    return lock


def claim(db: Session, conversation_id: int, staff: User) -> SupportLock:
    """Takes (or keeps) the conversation for `staff`. Refused while
    somebody else holds it. Does not commit."""
    lock = live_lock(db, conversation_id)
    if lock is not None and lock.holder_id != staff.id:
        holder = db.get(User, lock.holder_id)
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail={"reason": "support_held", "holder": holder.display_name if holder else None},
        )
    row = db.get(SupportLock, conversation_id)
    if row is None:
        row = SupportLock(conversation_id=conversation_id, holder_id=staff.id)
        db.add(row)
    elif row.holder_id != staff.id:
        row.handed = False  # a lapsed lock, taken over
    row.holder_id = staff.id
    row.touched_at = utcnow()
    db.flush()
    return row


def answered(db: Session, conversation_id: int, staff: User) -> None:
    """After an answer: the lock stays with whoever answered, as an
    ordinary ten-minute lock (a handed one has done its job)."""
    row = claim(db, conversation_id, staff)
    row.handed = False


def hand(db: Session, conversation_id: int, to: User | None) -> None:
    """The owner gives a conversation to one staff member, or frees it."""
    row = db.get(SupportLock, conversation_id)
    if to is None:
        if row is not None:
            db.delete(row)
        return
    if row is None:
        row = SupportLock(conversation_id=conversation_id, holder_id=to.id)
        db.add(row)
    row.holder_id = to.id
    row.handed = True
    row.touched_at = utcnow()


def opened(db: Session, conversation_id: int, staff: User) -> None:
    """Records one look. Does not commit."""
    db.add(SupportOpening(conversation_id=conversation_id, staff_id=staff.id, opened_at=utcnow()))
