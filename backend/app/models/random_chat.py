"""
The random-chat pool, and the sessions it produces.

Two ideas from TECHNICAL_REQUIREMENTS.md section 28.1 shape both tables.

**Pressing the button means joining a pool, not sending a request.** A
person stays in the pool until they are matched or leave, so impatience
costs the server nothing: one row per waiting person, no matter how many
times they tap.

**Preferences rank, they do not filter.** With a small pool a hard filter
returns nobody, so everything here is a weight. Somebody always gets
found; the best matches simply come first, and when what arrives is not
what was asked for, the app says so rather than pretending.
"""

from datetime import datetime

from sqlalchemy import JSON, Boolean, CheckConstraint, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.time import UTCDateTime, utcnow

#: Who someone is looking for today. This is a mood, not a fact about
#: them, which is why it lives on the search and is asked every time
#: rather than sitting on the profile.
WANT_MALE = "male"
WANT_FEMALE = "female"
WANT_ANYONE = "anyone"
WANTED_GENDERS = (WANT_MALE, WANT_FEMALE, WANT_ANYONE)

#: How many interest tags one search may carry. Tags are conversation
#: openers, not filters: after a match both people are shown "you both
#: picked this", which solves the hardest moment of meeting anyone — the
#: first sentence.
MAX_SEARCH_TAGS = 3


class RandomChatTicket(Base):
    """One person waiting, with what they are hoping for this time."""

    __tablename__ = "random_chat_tickets"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), unique=True)

    #: Weighed against the other person's gender, never used to exclude.
    wants_gender: Mapped[str] = mapped_column(String(16), default=WANT_ANYONE)
    wants_age_min: Mapped[int | None] = mapped_column(Integer, nullable=True)
    wants_age_max: Mapped[int | None] = mapped_column(Integer, nullable=True)
    #: A short list of tag ids, as JSON. Never queried across rows, only
    #: read for the one ticket being scored.
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)

    #: Frozen at join time so the matcher never re-reads a profile mid-run,
    #: and so a person cannot change what they are while queued.
    gender: Mapped[str | None] = mapped_column(String(16), nullable=True)
    age: Mapped[int | None] = mapped_column(Integer, nullable=True)

    #: The viewer's own clock when they joined, in minutes past midnight.
    #: Kept so two people who are both awake at three in the morning can be
    #: recognised as such without storing where either of them is.
    local_minute: Mapped[int] = mapped_column(Integer, default=0)

    joined_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)

    #: Whether this person is waiting RIGHT NOW. The row outlives the wait
    #: on purpose: it is also the record of what they last searched for, so
    #: the next search can open with those choices already filled in
    #: instead of asking the same three questions again.
    #:
    #: Kept visible rather than applied silently — the choices are a mood
    #: rather than a setting, and a mood applied behind someone's back
    #: quietly becomes a permanent setting nobody chose.
    active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)

    __table_args__ = (
        CheckConstraint(
            "wants_gender IN ('male', 'female', 'anyone')",
            name="ck_ticket_wants_gender",
        ),
        CheckConstraint(
            "wants_age_min IS NULL OR wants_age_max IS NULL OR wants_age_min <= wants_age_max",
            name="ck_ticket_age_range",
        ),
    )


class RandomChatSession(Base):
    """Two people the matcher put together, and what became of it."""

    __tablename__ = "random_chat_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)

    conversation_id: Mapped[int] = mapped_column(
        ForeignKey("conversations.id"), index=True
    )
    #: Written smallest id first, the same convention the conversation's
    #: own key uses, so "did these two already meet" is one comparison.
    user_a_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    user_b_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)

    #: Whether the matcher created the thread or found one these two
    #: already had. It decides what happens when the session ends without
    #: both wanting to keep it: a thread that existed before is never
    #: touched, because their earlier history is not ours to clear.
    created_conversation: Mapped[bool] = mapped_column(Boolean, default=False)

    #: The tags both of them had chosen, which the screen opens with.
    shared_tags: Mapped[list[str]] = mapped_column(JSON, default=list)

    started_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    ended_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    #: Who walked away. Recorded but never shown and never punished yet —
    #: we do not know what a healthy number looks like.
    ended_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )

    #: Each side saying "I would like to keep this person". Only when BOTH
    #: have does the thread stay; one-sided interest is never revealed, so
    #: not being kept is never a rejection anybody feels.
    kept_by_a: Mapped[bool] = mapped_column(Boolean, default=False)
    kept_by_b: Mapped[bool] = mapped_column(Boolean, default=False)

    def other_user_id(self, user_id: int) -> int:
        return self.user_b_id if user_id == self.user_a_id else self.user_a_id

    def kept_by(self, user_id: int) -> bool:
        return self.kept_by_a if user_id == self.user_a_id else self.kept_by_b

    def set_kept(self, user_id: int, value: bool) -> None:
        if user_id == self.user_a_id:
            self.kept_by_a = value
        else:
            self.kept_by_b = value

    @property
    def kept_by_both(self) -> bool:
        return self.kept_by_a and self.kept_by_b
