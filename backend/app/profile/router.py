"""
Profile endpoints — two routers on purpose:
  - `router` (prefix /profile, singular): "my own profile" — GET/PUT /profile/me.
  - `public_router` (prefix /profiles, plural): viewing ANY user's basic
    profile info, e.g. for a provider reviewing who's requesting their
    offer. No audience/privacy restriction — this is intentionally
    public, unlike Photo's audience rules.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.core.database import get_db
from app.models.profile import Profile
from app.models.user import User
from app.profile.schemas import ProfileOut, ProfileUpdate, PublicProfileOut

router = APIRouter(prefix="/profile", tags=["profile"])
public_router = APIRouter(prefix="/profiles", tags=["profile"])


@router.get("/me", response_model=ProfileOut)
def read_my_profile(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Profile:
    profile = db.query(Profile).filter(Profile.user_id == current_user.id).first()
    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="You haven't created a profile yet.",
        )
    return profile


@router.put("/me", response_model=ProfileOut)
def upsert_my_profile(
    payload: ProfileUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Profile:
    """
    Create-or-update: PUT is idempotent, so one endpoint handles both "I
    don't have a profile yet" and "update my existing profile" — the
    caller doesn't need to know which case they're in.
    """
    profile = db.query(Profile).filter(Profile.user_id == current_user.id).first()
    if profile is None:
        profile = Profile(user_id=current_user.id)
        db.add(profile)

    profile.avatar_url = payload.avatar_url
    profile.bio = payload.bio

    db.commit()
    db.refresh(profile)
    return profile


@public_router.get("/{user_id}", response_model=PublicProfileOut)
def read_public_profile(
    user_id: int,
    current_user: User = Depends(get_current_user),  # still requires auth, just not "self"
    db: Session = Depends(get_db),
) -> PublicProfileOut:
    """
    Works even if `user_id` has never created a Profile row — a bare
    User (display_name/username only, no avatar/bio) is still a valid
    thing to look at, e.g. right after their first login.
    """
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    profile = db.query(Profile).filter(Profile.user_id == user_id).first()

    return PublicProfileOut(
        user_id=target.id,
        display_name=target.display_name,
        username=target.username,
        avatar_url=profile.avatar_url if profile else None,
        bio=profile.bio if profile else None,
    )
