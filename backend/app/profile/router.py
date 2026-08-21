"""
Endpoints for the current user's own profile.

Only "my profile" endpoints live here for now (GET/PUT /profile/me).
Viewing *someone else's* profile is a separate concern — it needs the
audience/follow access checks from TECHNICAL_REQUIREMENTS.md section 4 —
and will get its own route once Follow and Photo endpoints exist.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.core.database import get_db
from app.models.profile import Profile
from app.models.user import User
from app.profile.schemas import ProfileOut, ProfileUpdate

router = APIRouter(prefix="/profile", tags=["profile"])


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
