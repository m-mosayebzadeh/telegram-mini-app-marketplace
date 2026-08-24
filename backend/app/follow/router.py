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
from app.follow.schemas import FollowOut, IncomingFollowRequestOut
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


@router.get("/incoming-requests", response_model=list[IncomingFollowRequestOut])
def list_incoming_follow_requests(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[IncomingFollowRequestOut]:
    """
    Registered before the /{user_id}/... routes below on purpose —
    "incoming-requests" is a literal path segment, not a user id, so
    this must never be shadowed by a route that tries to parse it as
    one (see TECHNICAL_REQUIREMENTS.md's note on this).

    Every request ever sent TO current_user: pending ones (needing
    Accept/Reject), plus the accepted/rejected history — see
    IncomingFollowRequestOut's docstring.
    """
    incoming = (
        db.query(Follow)
        .filter(Follow.followee_id == current_user.id)
        .order_by(Follow.requested_at.desc())
        .all()
    )

    # One query for "everyone I already follow back", instead of a
    # separate query per row below — a list of many requesters
    # shouldn't cost N+1 round trips just to answer "have I followed
    # them back yet".
    my_accepted_followee_ids = {
        f.followee_id
        for f in db.query(Follow).filter(
            Follow.follower_id == current_user.id, Follow.status == FollowStatus.ACCEPTED
        )
    }

    results = []
    for follow in incoming:
        requester = db.get(User, follow.follower_id)
        results.append(
            IncomingFollowRequestOut(
                follow_id=follow.id,
                requester=_to_list_item(db, requester),
                status=follow.status.value,
                requested_at=follow.requested_at,
                responded_at=follow.responded_at,
                i_follow_them_back=follow.follower_id in my_accepted_followee_ids,
            )
        )
    return results


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
        if existing.status == FollowStatus.REJECTED:
            # Requesting again after a past rejection: reset the SAME
            # row back to PENDING rather than erroring or silently doing
            # nothing — the unique pair constraint means a new row isn't
            # an option, and the whole point of keeping rejected rows
            # around (see FollowStatus.REJECTED's docstring) is so this
            # can happen without losing the history up to this point.
            existing.status = FollowStatus.PENDING
            existing.requested_at = utcnow()
            existing.responded_at = None
            db.commit()
            db.refresh(existing)
        # PENDING or ACCEPTED: already requested (or already following)
        # — idempotent, don't create a duplicate row (the unique
        # constraint would reject it anyway; this just avoids relying on
        # that for normal flow).
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


@router.post("/{user_id}/reject", response_model=FollowOut)
def reject_follow(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Follow:
    """
    Kept, not deleted (unlike this route used to work) — a rejected
    request is exactly what GET /follow/incoming-requests' history is
    for (see FollowStatus.REJECTED's docstring). The follower can still
    request again later, which resets this same row back to PENDING
    (see request_follow above).
    """
    follow = _get_incoming_pending_request(
        db, follower_id=user_id, followee_id=current_user.id
    )
    follow.status = FollowStatus.REJECTED
    follow.responded_at = utcnow()
    db.commit()
    db.refresh(follow)
    return follow


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
