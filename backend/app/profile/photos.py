"""
Shared helper for "what's this user's current avatar url" — used
anywhere a single avatar_url is needed (PublicProfileOut,
FollowListItemOut, ChatSessionParticipantOut, ...), now that a user can
have any number of ProfilePhoto rows instead of one stored column (see
app/models/profile_photo.py). The current avatar is always just the
newest one; every older photo is still reachable through the fullscreen
gallery (GET /profiles/{user_id}/photos in app/profile/router.py) until
its owner deletes it.
"""

from sqlalchemy.orm import Session

from app.models.profile_photo import ProfilePhoto


def get_current_avatar_url(db: Session, user_id: int) -> str | None:
    photo = (
        db.query(ProfilePhoto)
        .filter(ProfilePhoto.user_id == user_id)
        .order_by(ProfilePhoto.created_at.desc())
        .first()
    )
    return photo.url if photo else None
