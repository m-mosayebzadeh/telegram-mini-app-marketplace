"""
Follow request lifecycle: request -> accept/reject, plus unfollow.

Every rule here comes straight from TECHNICAL_REQUIREMENTS.md section 4:
every follow needs the target's explicit approval, and there's no
public/private account distinction — the logic below is identical no
matter who the two users are.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.core.database import get_db
from app.core.time import utcnow
from app.follow.schemas import FollowOut
from app.models.follow import Follow, FollowStatus
from app.models.profile import Profile
from app.models.user import User
from app.profile.schemas import FollowListItemOut

router = APIRouter(prefix="/follow", tags=["follow"])


def _to_list_item(db: Session, user: User) -> FollowListItemOut:
    """Shared by list_followers/list_following below — a compact row (no
    bio, no follower counts) for a followers/following list, per
    FollowListItemOut's own docstring."""
    profile = db.query(Profile).filter(Profile.user_id == user.id).first()
    return FollowListItemOut(
        user_id=user.id,
        display_name=user.display_name,
        username=user.username,
        avatar_url=profile.avatar_url if profile else None,
    )


@router.post("/{user_id}", response_model=FollowOut, status_code=status.HTTP_201_CREATED)
def request_follow(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Follow:
    if user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You can't follow yourself.",
        )

    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    existing = (
        db.query(Follow)
        .filter(Follow.follower_id == current_user.id, Follow.followee_id == user_id)
        .first()
    )
    if existing is not None:
        # Already requested (or already following) — idempotent, don't
        # create a duplicate row (the unique constraint would reject it
        # anyway; this just avoids relying on that for normal flow).
        return existing

    follow = Follow(follower_id=current_user.id, followee_id=user_id)
    db.add(follow)
    db.commit()
    db.refresh(follow)
    return follow


def _get_incoming_pending_request(
    db: Session, *, follower_id: int, followee_id: int
) -> Follow:
    """Shared lookup for accept/reject: a PENDING request FROM follower_id
    TO followee_id. Both endpoints need exactly this, so the "only the
    followee can respond, and only while still pending" rule lives in one
    place."""
    follow = (
        db.query(Follow)
        .filter(
            Follow.follower_id == follower_id,
            Follow.followee_id == followee_id,
            Follow.status == FollowStatus.PENDING,
        )
        .first()
    )
    if follow is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No pending follow request from this user.",
        )
    return follow


@router.post("/{user_id}/accept", response_model=FollowOut)
def accept_follow(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Follow:
    follow = _get_incoming_pending_request(
        db, follower_id=user_id, followee_id=current_user.id
    )
    follow.status = FollowStatus.ACCEPTED
    follow.responded_at = utcnow()
    db.commit()
    db.refresh(follow)
    return follow


@router.post("/{user_id}/reject", status_code=status.HTTP_204_NO_CONTENT)
def reject_follow(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    follow = _get_incoming_pending_request(
        db, follower_id=user_id, followee_id=current_user.id
    )
    db.delete(follow)
    db.commit()


@router.get("/{user_id}/followers", response_model=list[FollowListItemOut])
def list_followers(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[FollowListItemOut]:
    """Everyone who ACCEPTED-follows `user_id` — a pending request isn't
    a follower yet, same rule the counts on PublicProfileOut use."""
    if db.get(User, user_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    followers = (
        db.query(User)
        .join(Follow, Follow.follower_id == User.id)
        .filter(Follow.followee_id == user_id, Follow.status == FollowStatus.ACCEPTED)
        .all()
    )
    return [_to_list_item(db, u) for u in followers]


@router.get("/{user_id}/following", response_model=list[FollowListItemOut])
def list_following(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[FollowListItemOut]:
    """Everyone `user_id` ACCEPTED-follows."""
    if db.get(User, user_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    following = (
        db.query(User)
        .join(Follow, Follow.followee_id == User.id)
        .filter(Follow.follower_id == user_id, Follow.status == FollowStatus.ACCEPTED)
        .all()
    )
    return [_to_list_item(db, u) for u in following]


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def unfollow(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Cancels my own outgoing follow (pending or already accepted)."""
    follow = (
        db.query(Follow)
        .filter(Follow.follower_id == current_user.id, Follow.followee_id == user_id)
        .first()
    )
    if follow is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="You're not following this user.",
        )
    db.delete(follow)
    db.commit()
