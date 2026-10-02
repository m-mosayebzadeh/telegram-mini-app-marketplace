"""
"Report a problem": a few words from somebody about the app itself — a
bug, a confusing screen, an idea (TECHNICAL_REQUIREMENTS.md section 32,
step 4).

Not a report about a person; those are app/models/report.py, with reasons
staff sort by. This is free text, read by the team in the admin panel.
"""

from datetime import datetime

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.time import UTCDateTime, utcnow

#: Long enough to describe what happened, short enough to be read.
MAX_FEEDBACK_TEXT = 1000


class Feedback(Base):
    __tablename__ = "feedback"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    text: Mapped[str] = mapped_column(String(MAX_FEEDBACK_TEXT))
    #: Which screen they came from, so "this does not work" has a place.
    where: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)
