"""
Reporting someone, and the staff side of what follows.

Reporting sits next to blocking but is a different act
(TECHNICAL_REQUIREMENTS.md section 28): blocking protects one person and
needs no reason, reporting protects everyone else and does. In the
interface a report is a tick under the block confirmation, which is why
they arrive together here and are still stored apart.

Nothing automatic ever happens. Reports pile up against the real account,
staff sort them by how many DIFFERENT people complained — eight people
and one person complaining eight times are not remotely the same thing —
and a person decides.
"""

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user, require_admin
from app.core.database import get_db
from app.core.time import utcnow
from app.models.conversation import Conversation
from app.models.report import (
    REPORT_REASONS,
    SUSPENSION_SCOPES,
    Report,
    Suspension,
)
from app.models.user import User

router = APIRouter(prefix="/reports", tags=["reports"])
admin_router = APIRouter(prefix="/admin/reports", tags=["admin"])


class ReportIn(BaseModel):
    reported_user_id: int
    reason: str
    #: Where it happened, so staff open exactly that conversation instead
    #: of hunting for it.
    conversation_id: int | None = None


@router.post("", status_code=status.HTTP_201_CREATED)
def create_report(
    payload: ReportIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    if payload.reported_user_id == current_user.id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, detail={"reason": "cannot_report_yourself"}
        )
    if payload.reason not in REPORT_REASONS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail={"reason": "bad_reason"})
    if db.get(User, payload.reported_user_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found.")

    if payload.conversation_id is not None:
        conversation = db.get(Conversation, payload.conversation_id)
        # Only somewhere the reporter actually was. Otherwise a report
        # would be a way to point staff at any conversation at all.
        if conversation is None or not conversation.includes(current_user.id):
            raise HTTPException(
                status.HTTP_404_NOT_FOUND, "Conversation not found."
            )

    db.add(
        Report(
            reporter_id=current_user.id,
            reported_user_id=payload.reported_user_id,
            reason=payload.reason,
            conversation_id=payload.conversation_id,
        )
    )
    db.commit()
    # Nothing is promised back beyond "we have it". Telling the reporter
    # what happens next would either be a lie or a leak about someone else.
    return {"received": True}


class ReportedUserOut(BaseModel):
    user_id: int
    display_name: str
    username: str | None
    #: The number that matters: how many DIFFERENT people complained.
    distinct_reporters: int
    total_reports: int
    unreviewed_reports: int
    last_report_at: str


@admin_router.get("", response_model=list[ReportedUserOut])
def list_reported_users(
    limit: int = 50,
    _: User = Depends(require_admin("moderation.reports")),
    db: Session = Depends(get_db),
) -> list[ReportedUserOut]:
    """Reported accounts, worst first.

    Ordered by distinct reporters rather than by report count, because the
    count is trivially inflated by one determined person and the distinct
    count is not.
    """
    rows = db.execute(
        select(
            Report.reported_user_id,
            func.count(func.distinct(Report.reporter_id)).label("distinct_reporters"),
            func.count(Report.id).label("total"),
            func.count(Report.id).filter(Report.reviewed_at.is_(None)).label("unreviewed"),
            func.max(Report.created_at).label("last_at"),
        )
        .group_by(Report.reported_user_id)
        .order_by(
            func.count(func.distinct(Report.reporter_id)).desc(),
            func.max(Report.created_at).desc(),
        )
        .limit(limit)
    ).all()

    users = {
        user.id: user
        for user in db.scalars(
            select(User).where(User.id.in_([row[0] for row in rows]))
        )
    }
    return [
        ReportedUserOut(
            user_id=user_id,
            display_name=users[user_id].display_name,
            username=users[user_id].username,
            distinct_reporters=distinct,
            total_reports=total,
            unreviewed_reports=unreviewed,
            last_report_at=last_at.isoformat(),
        )
        for user_id, distinct, total, unreviewed, last_at in rows
        if user_id in users
    ]


class ReportOut(BaseModel):
    id: int
    reporter_id: int
    reason: str
    conversation_id: int | None
    created_at: str
    reviewed_at: str | None


@admin_router.get("/user/{user_id}", response_model=list[ReportOut])
def list_reports_for_user(
    user_id: int,
    _: User = Depends(require_admin("moderation.reports")),
    db: Session = Depends(get_db),
) -> list[ReportOut]:
    reports = db.scalars(
        select(Report)
        .where(Report.reported_user_id == user_id)
        .order_by(Report.created_at.desc())
    ).all()
    return [
        ReportOut(
            id=r.id,
            reporter_id=r.reporter_id,
            reason=r.reason,
            conversation_id=r.conversation_id,
            created_at=r.created_at.isoformat(),
            reviewed_at=r.reviewed_at.isoformat() if r.reviewed_at else None,
        )
        for r in reports
    ]


@admin_router.post("/user/{user_id}/reviewed", status_code=status.HTTP_204_NO_CONTENT)
def mark_reviewed(
    user_id: int,
    admin: User = Depends(require_admin("moderation.reports")),
    db: Session = Depends(get_db),
) -> None:
    """Marks this account's outstanding reports as looked at.

    They are kept rather than deleted: the distinct-reporter count is the
    signal, and clearing handled reports would erase the history that
    makes a repeat offender visible.
    """
    now = utcnow()
    for report in db.scalars(
        select(Report).where(
            Report.reported_user_id == user_id, Report.reviewed_at.is_(None)
        )
    ):
        report.reviewed_at = now
        report.reviewed_by_user_id = admin.id
    db.commit()


class SuspensionIn(BaseModel):
    user_id: int
    #: Which parts of the app to take away. A list because the panel is a
    #: set of tick boxes: one decision about one person, even when it
    #: covers several areas.
    scopes: list[str] = Field(min_length=1)
    hours: int = Field(ge=1, le=24 * 365)
    note: str | None = Field(default=None, max_length=300)


class SuspensionOut(BaseModel):
    id: int
    user_id: int
    scope: str
    expires_at: str
    note: str | None


@admin_router.post(
    "/suspensions", response_model=list[SuspensionOut], status_code=status.HTTP_201_CREATED
)
def suspend(
    payload: SuspensionIn,
    admin: User = Depends(require_admin("moderation.reports")),
    db: Session = Depends(get_db),
) -> list[SuspensionOut]:
    """Suspends an account, by hand, from one or more areas, with an end.

    One action in the panel: tick the areas, put in a number of hours,
    done. Each ticked area becomes its own row so a single area can be
    lifted later without touching the rest, but they share one expiry
    because they were one decision.

    There is no permanent option and no automatic one, which is the rule
    the whole moderation design rests on: an automatic punishment is never
    permanent, and a permanent punishment is never automatic. A suspension
    nobody has to remember to lift is one that cannot quietly become
    forever — when the hours run out, everything that was taken away comes
    back on its own.
    """
    unknown = [s for s in payload.scopes if s not in SUSPENSION_SCOPES]
    if unknown:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, detail={"reason": "bad_scope", "scopes": unknown}
        )
    if db.get(User, payload.user_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found.")

    expires_at = utcnow() + timedelta(hours=payload.hours)
    created: list[Suspension] = []
    for scope in dict.fromkeys(payload.scopes):  # keeps order, drops repeats
        suspension = Suspension(
            user_id=payload.user_id,
            scope=scope,
            expires_at=expires_at,
            created_by_user_id=admin.id,
            note=payload.note,
        )
        db.add(suspension)
        created.append(suspension)
    db.commit()
    for suspension in created:
        db.refresh(suspension)
    return [
        SuspensionOut(
            id=s.id,
            user_id=s.user_id,
            scope=s.scope,
            expires_at=s.expires_at.isoformat(),
            note=s.note,
        )
        for s in created
    ]


@admin_router.get("/suspensions/{user_id}", response_model=list[SuspensionOut])
def list_suspensions(
    user_id: int,
    _: User = Depends(require_admin("moderation.reports")),
    db: Session = Depends(get_db),
) -> list[SuspensionOut]:
    """This account's live suspensions. Expired ones are simply past their
    end, so they are filtered here rather than deleted anywhere."""
    now = utcnow()
    rows = db.scalars(
        select(Suspension).where(
            Suspension.user_id == user_id, Suspension.expires_at > now
        )
    ).all()
    return [
        SuspensionOut(
            id=s.id,
            user_id=s.user_id,
            scope=s.scope,
            expires_at=s.expires_at.isoformat(),
            note=s.note,
        )
        for s in rows
    ]


@admin_router.delete("/suspensions/{suspension_id}", status_code=status.HTTP_204_NO_CONTENT)
def lift(
    suspension_id: int,
    _: User = Depends(require_admin("moderation.reports")),
    db: Session = Depends(get_db),
) -> None:
    suspension = db.get(Suspension, suspension_id)
    if suspension is not None:
        db.delete(suspension)
        db.commit()
