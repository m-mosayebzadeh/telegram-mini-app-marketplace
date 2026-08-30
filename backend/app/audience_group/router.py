"""
Audience groups: reusable named circles (e.g. "Friends", "Family") a user
builds once and reuses to scope who a piece of content is published to (see
TECHNICAL_REQUIREMENTS.md section 2).

Every endpoint here is scoped to db.query(...).filter(owner_id ==
current_user.id) — a group belonging to someone else simply doesn't turn
up in the query, which naturally becomes a 404. No separate "is this my
group?" check is needed because it's baked into every lookup.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.audience_group.schemas import AudienceGroupCreate, AudienceGroupOut
from app.auth.dependencies import get_current_user
from app.core.database import get_db
from app.models.audience_group import AudienceGroup, AudienceGroupMember
from app.models.user import User

router = APIRouter(prefix="/audience-groups", tags=["audience-groups"])


def _get_owned_group(db: Session, group_id: int, owner_id: int) -> AudienceGroup:
    group = (
        db.query(AudienceGroup)
        .filter(AudienceGroup.id == group_id, AudienceGroup.owner_id == owner_id)
        .first()
    )
    if group is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Audience group not found."
        )
    return group


@router.post("", response_model=AudienceGroupOut, status_code=status.HTTP_201_CREATED)
def create_group(
    payload: AudienceGroupCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AudienceGroup:
    group = AudienceGroup(owner_id=current_user.id, name=payload.name)
    db.add(group)
    db.commit()
    db.refresh(group)
    return group


@router.get("", response_model=list[AudienceGroupOut])
def list_my_groups(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[AudienceGroup]:
    return (
        db.query(AudienceGroup)
        .filter(AudienceGroup.owner_id == current_user.id)
        .all()
    )


@router.get("/{group_id}", response_model=AudienceGroupOut)
def get_group(
    group_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AudienceGroup:
    return _get_owned_group(db, group_id, current_user.id)


@router.delete("/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_group(
    group_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    group = _get_owned_group(db, group_id, current_user.id)
    db.delete(group)  # cascade="all, delete-orphan" also removes its members
    db.commit()


@router.post(
    "/{group_id}/members/{user_id}",
    response_model=AudienceGroupOut,
    status_code=status.HTTP_201_CREATED,
)
def add_member(
    group_id: int,
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AudienceGroup:
    group = _get_owned_group(db, group_id, current_user.id)

    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    already_member = (
        db.query(AudienceGroupMember)
        .filter(
            AudienceGroupMember.group_id == group.id,
            AudienceGroupMember.user_id == user_id,
        )
        .first()
    )
    if already_member is None:
        db.add(AudienceGroupMember(group_id=group.id, user_id=user_id))
        db.commit()
        db.refresh(group)

    return group


@router.delete("/{group_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_member(
    group_id: int,
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    group = _get_owned_group(db, group_id, current_user.id)

    member = (
        db.query(AudienceGroupMember)
        .filter(
            AudienceGroupMember.group_id == group.id,
            AudienceGroupMember.user_id == user_id,
        )
        .first()
    )
    if member is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="This user isn't a member of the group.",
        )
    db.delete(member)
    db.commit()
