"""
Blocking someone.

Free messaging (TECHNICAL_REQUIREMENTS.md section 24) means anyone can
write to anyone, so this is not an extra: it is the other half of that
decision. Without it the app would ship an open channel to every user
with no way to close it.

Blocking is quiet. The blocked person is never told, and every route that
would reveal it answers as though the other person simply cannot be
reached — being told you are blocked is an invitation to come back
through another account.
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.core.database import get_db
from app.models.block import Block
from app.models.user import User
from app.profile.photos import get_current_avatar_urls

router = APIRouter(prefix="/blocks", tags=["blocks"])


class BlockIn(BaseModel):
    user_id: int


class BlockedUserOut(BaseModel):
    user_id: int
    display_name: str
    username: str | None
    avatar_url: str | None
    #: Since when, for the small "since 3 Mehr" under the name.
    blocked_at: datetime


@router.get("", response_model=list[BlockedUserOut])
def list_blocks(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[BlockedUserOut]:
    """Who this person has blocked, the newest first. Only their own list
    — a block is not something anyone else can see."""
    rows = db.execute(
        select(Block.blocked_id, Block.created_at)
        .where(Block.blocker_id == current_user.id)
        .order_by(Block.created_at.desc())
    ).all()
    if not rows:
        return []

    blocked_ids = [blocked_id for blocked_id, _ in rows]
    avatars = get_current_avatar_urls(db, blocked_ids)
    users = {user.id: user for user in db.scalars(select(User).where(User.id.in_(blocked_ids)))}
    return [
        BlockedUserOut(
            user_id=blocked_id,
            display_name=users[blocked_id].display_name,
            username=users[blocked_id].username,
            avatar_url=avatars.get(blocked_id),
            blocked_at=blocked_at,
        )
        for blocked_id, blocked_at in rows
        if blocked_id in users
    ]


@router.post("", status_code=status.HTTP_204_NO_CONTENT)
def block_user(
    payload: BlockIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    if payload.user_id == current_user.id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, detail={"reason": "cannot_block_yourself"}
        )
    if db.get(User, payload.user_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found.")

    db.add(Block(blocker_id=current_user.id, blocked_id=payload.user_id))
    try:
        db.commit()
    except IntegrityError:
        # Already blocked. Blocking twice is not an error — the caller
        # wanted this person blocked, and they are.
        db.rollback()


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def unblock_user(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    block = db.scalar(
        select(Block).where(
            Block.blocker_id == current_user.id, Block.blocked_id == user_id
        )
    )
    if block is not None:
        db.delete(block)
        db.commit()
