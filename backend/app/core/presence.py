"""
Who may see whose "online" (section 32, step 4).

Somebody can hide when they are here. The rule is Telegram's: whoever
hides it does not see anybody else's either. Two halves, because with
only the first everybody would hide and the ring around a body — which
means "here right now" and nothing else — would stop meaning anything.

Hidden is not "never here": the coarse "when were they last here" says
"recently" instead of minutes or hours, and an old absence still reads
as an old absence.
"""

from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.profile import Profile


def hiding_online(db: Session, user_ids: Iterable[int] | None = None) -> set[int]:
    """Of these people, the ones who hide when they are online; with no
    list, everybody who does (the world asks that way, since it looks at
    everyone and the hiders are the few)."""
    query = select(Profile.user_id).where(Profile.hide_online.is_(True))
    if user_ids is not None:
        ids = list(set(user_ids))
        if not ids:
            return set()
        query = query.where(Profile.user_id.in_(ids))
    return set(db.scalars(query))


def masked_seen(seen: str, *, hidden: bool) -> str:
    """The coarse last-here, as somebody who may not see it exactly reads it."""
    if not hidden or seen == "long":
        return seen
    return "recently"
