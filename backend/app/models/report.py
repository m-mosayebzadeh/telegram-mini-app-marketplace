"""
Report: telling staff that somebody behaved badly, and Suspension: the
only thing that ever happens as a result.

Blocking and reporting are deliberately separate acts
(TECHNICAL_REQUIREMENTS.md section 28). Blocking protects one person and
needs no reason; reporting protects everyone else and does. Many people
block for no reason at all, so treating a block as a complaint would bury
the real ones.

The governing rule, which is why nothing here is automatic: **an
automatic punishment is never permanent, and a permanent punishment is
never automatic.** In practice that currently means nothing automatic
happens at all — reports pile up against the real account and a person
decides.
"""

from datetime import datetime

from sqlalchemy import CheckConstraint, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.time import UTCDateTime, utcnow

#: One reason, chosen with one tap. The list is short on purpose: a free
#: text box produces reports nobody can triage, and a long list produces
#: reports filed under the wrong heading.
REPORT_INSULT = "insult"
REPORT_SEXUAL = "sexual"
REPORT_SCAM = "scam"
REPORT_SPAM = "spam"
REPORT_OTHER = "other"
REPORT_REASONS = (REPORT_INSULT, REPORT_SEXUAL, REPORT_SCAM, REPORT_SPAM, REPORT_OTHER)

#: What a suspension takes away. Scoped rather than all-or-nothing, so the
#: answer to "was rude to strangers" is not the same as "defrauded
#: someone".
SUSPEND_RANDOM_CHAT = "random_chat"
SUSPEND_NEW_CONVERSATIONS = "new_conversations"
SUSPEND_EVERYTHING = "everything"
SUSPENSION_SCOPES = (SUSPEND_RANDOM_CHAT, SUSPEND_NEW_CONVERSATIONS, SUSPEND_EVERYTHING)


class Report(Base):
    __tablename__ = "reports"

    id: Mapped[int] = mapped_column(primary_key=True)

    reporter_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    #: The REAL account, never the anonymous side of a random chat. A
    #: report that pointed at a session would vanish with the session.
    reported_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)

    reason: Mapped[str] = mapped_column(String(16))

    #: The conversation it happened in, so staff open exactly that one
    #: rather than hunting. Because staff access to conversations is
    #: invisible to users (section 21), every such opening must be logged.
    conversation_id: Mapped[int | None] = mapped_column(
        ForeignKey("conversations.id"), nullable=True, index=True
    )

    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)

    #: Set when staff have looked. Kept rather than deleted, because the
    #: count of DISTINCT people who reported someone is the signal, and
    #: deleting handled reports would erase it.
    reviewed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    reviewed_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )

    __table_args__ = (
        CheckConstraint(
            "reason IN ('insult', 'sexual', 'scam', 'spam', 'other')",
            name="ck_report_reason",
        ),
        CheckConstraint("reporter_id <> reported_user_id", name="ck_report_not_self"),
    )


class Suspension(Base):
    """A hand-made, scoped, self-expiring restriction on one account.

    Self-expiring matters more than it looks: a suspension that has to be
    remembered and lifted by a person is one that quietly becomes
    permanent.
    """

    __tablename__ = "suspensions"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    scope: Mapped[str] = mapped_column(String(24))

    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    #: When it lifts itself. Never null: a suspension with no end is the
    #: permanent punishment that must never be automatic, and if one is
    #: ever wanted it should be a different, deliberate thing.
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime, index=True)

    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    #: For staff, not for the user. Short and internal.
    note: Mapped[str | None] = mapped_column(String(300), nullable=True)

    __table_args__ = (
        CheckConstraint(
            "scope IN ('random_chat', 'new_conversations', 'everything')",
            name="ck_suspension_scope",
        ),
    )
