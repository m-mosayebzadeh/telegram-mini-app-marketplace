"""
Block: one person refusing contact from another.

Needed the moment messaging became free (TECHNICAL_REQUIREMENTS.md
section 24). Before that, reaching someone cost money and went through a
request they could decline, which was a filter of its own; a free text
field with no block is an open harassment tool, and in a product aimed
partly at people who get unwanted attention it would be the first thing
anyone noticed.

Deliberately one-directional and one-sided. Blocking is not mutual
agreement: A blocks B, and it is A's decision alone. It is also quiet —
B is never told, because telling someone they have been blocked is an
invitation to come back through another account.
"""

from datetime import datetime

from sqlalchemy import ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.time import UTCDateTime, utcnow


class Block(Base):
    __tablename__ = "blocks"

    id: Mapped[int] = mapped_column(primary_key=True)

    #: The person who does not want to be contacted.
    blocker_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    #: The person they do not want to hear from.
    blocked_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)

    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    __table_args__ = (
        UniqueConstraint("blocker_id", "blocked_id", name="uq_block_pair"),
    )
