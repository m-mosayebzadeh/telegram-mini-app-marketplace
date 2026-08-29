"""
ProfilePhoto: one uploaded profile picture, belonging directly to a
User (not to Profile — a user can have photos even before creating a
Profile row, same reasoning as Content connecting to User directly).

A user can have any number of these — replaces the old single
Profile.avatar_url column, so uploading a new photo no longer deletes
the previous one. The newest row (by created_at) is always "the"
current avatar wherever a single avatar_url is needed (see
app/profile/photos.py's get_current_avatar_url) — every older one is
still reachable by swiping through the fullscreen gallery
(GET /profiles/{user_id}/photos), until its owner deletes it.

Deliberately public: these are served from the plain, unauthenticated
/avatars static mount (see app/main.py) since a profile photo has no
audience/spoiler rule the way Content does.
"""

from datetime import datetime

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.time import UTCDateTime, utcnow


class ProfilePhoto(Base):
    __tablename__ = "profile_photos"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    url: Mapped[str] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
