"""
The support side of the conversation list (TECHNICAL_REQUIREMENTS.md
section 43): for staff with the support permission, the conversations
people have with Cosmos Team, shown exactly like their own conversations.

Opening, reading and answering one goes through the ordinary conversation
routes (app/conversation/router.py), which give staff the team's side.
Only what has no equivalent there lives here: the list, taking a
conversation before answering, and the owner handing one to somebody.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user, is_owner
from app.conversation.router import serialize
from app.conversation.schemas import ConversationOut
from app.core import team
from app.core.database import get_db
from app.models.conversation import Conversation
from app.models.user import User
from app.support import service as support

router = APIRouter(prefix="/support", tags=["support"])


def require_support(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> User:
    if not support.can_support(db, current_user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not authorized.")
    return current_user


def _team_conversation_or_404(db: Session, conversation_id: int) -> Conversation:
    conversation = db.get(Conversation, conversation_id)
    if conversation is None or not support.is_team_conversation(db, conversation):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found.")
    return conversation


@router.get("/conversations", response_model=list[ConversationOut])
def list_support_conversations(
    limit: int = Query(30, ge=1, le=100),
    offset: int = Query(0, ge=0),
    staff: User = Depends(require_support),
    db: Session = Depends(get_db),
) -> list[ConversationOut]:
    """Every conversation with the team where something was said, newest
    first, a page at a time — each from the team's side, so its unread
    mark means "nobody on the team has read this yet"."""
    team_id = team.team_user(db).id
    page = support.team_conversations(db)[offset : offset + limit]
    return [serialize(db, c, c.participant_for(team_id), staff) for c in page]


class UnreadOut(BaseModel):
    conversations: int


@router.get("/unread", response_model=UnreadOut)
def support_unread(staff: User = Depends(require_support), db: Session = Depends(get_db)) -> UnreadOut:
    """How many team conversations wait for an answer: the number on the
    support tab."""
    team_id = team.team_user(db).id
    waiting = 0
    for conversation in support.team_conversations(db):
        mine = conversation.participant_for(team_id)
        if mine is not None and (mine.last_read_at is None or mine.last_read_at < conversation.last_message_at):
            waiting += 1
    return UnreadOut(conversations=waiting)


@router.post("/conversations/{conversation_id}/claim", status_code=status.HTTP_204_NO_CONTENT)
def claim_conversation(
    conversation_id: int, staff: User = Depends(require_support), db: Session = Depends(get_db)
) -> None:
    """Taken as somebody starts writing an answer, so nobody else answers
    the same person meanwhile. 409 with the holder's name while held."""
    _team_conversation_or_404(db, conversation_id)
    support.claim(db, conversation_id, staff)
    db.commit()


class HandIn(BaseModel):
    #: The staff member to give it to, or null to free it.
    user_id: int | None = None


@router.post("/conversations/{conversation_id}/hand", status_code=status.HTTP_204_NO_CONTENT)
def hand_conversation(
    conversation_id: int, body: HandIn, staff: User = Depends(require_support), db: Session = Depends(get_db)
) -> None:
    """The owner gives a conversation to one staff member (section 43)."""
    if not is_owner(staff):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Owner only.")
    _team_conversation_or_404(db, conversation_id)
    to = None
    if body.user_id is not None:
        if body.user_id not in support.staff_ids(db):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail={"reason": "not_staff"})
        to = db.get(User, body.user_id)
    support.hand(db, conversation_id, to)
    db.commit()


class StaffOut(BaseModel):
    user_id: int
    display_name: str


@router.get("/staff", response_model=list[StaffOut])
def list_staff(staff: User = Depends(require_support), db: Session = Depends(get_db)) -> list[StaffOut]:
    """Who a conversation can be handed to."""
    if not is_owner(staff):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Owner only.")
    ids = support.staff_ids(db)
    return [StaffOut(user_id=u.id, display_name=u.display_name) for u in (db.get(User, i) for i in ids) if u is not None]
