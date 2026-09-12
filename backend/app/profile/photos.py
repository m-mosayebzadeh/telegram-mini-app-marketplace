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

from collections.abc import Iterable

from sqlalchemy import func
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


def get_current_avatar_urls(db: Session, user_ids: Iterable[int]) -> dict[int, str]:
    """
    The same answer as get_current_avatar_url(), for many users at once.

    A list view (marketplace discovery, a follower list) needs one avatar
    per row. Calling the single-user helper in a loop would issue one
    query per row -- the classic N+1 -- so this does it in one.

    How it works, in two steps:

    1. Find, per user, the timestamp of their NEWEST photo. That is what
       ``func.max(ProfilePhoto.created_at)`` grouped by user_id gives us.
    2. Join that result back to the photos table so we can read the url
       that belongs to each of those newest timestamps.

    Users with no photo simply have no key in the returned dict, so the
    caller uses ``.get(user_id)`` and gets None -- exactly what the
    single-user helper would have returned for them.
    """
    ids = list(user_ids)
    if not ids:
        # An empty IN () clause is invalid in some databases, and there is
        # nothing to look up anyway.
        return {}

    newest = (
        db.query(
            ProfilePhoto.user_id.label("user_id"),
            func.max(ProfilePhoto.created_at).label("created_at"),
        )
        .filter(ProfilePhoto.user_id.in_(ids))
        .group_by(ProfilePhoto.user_id)
        .subquery()
    )

    rows = (
        db.query(ProfilePhoto.user_id, ProfilePhoto.url)
        .join(
            newest,
            (ProfilePhoto.user_id == newest.c.user_id)
            & (ProfilePhoto.created_at == newest.c.created_at),
        )
        .all()
    )

    # Two photos uploaded in the same instant would both match; dict()
    # keeps the last one, which is as good an answer as either.
    return {user_id: url for user_id, url in rows}
