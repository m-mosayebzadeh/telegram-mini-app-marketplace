"""
Analytics routes (TECHNICAL_REQUIREMENTS.md section 43): the app reporting
its few events, and the admin panel reading the numbers.
"""

from fastapi import APIRouter, Depends, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.analytics import metrics
from app.analytics.events import MAX_PER_REPORT, clean
from app.auth import sessions
from app.auth.dependencies import require_admin
from app.core.attempts import Attempts
from app.core.database import get_db
from app.models.analytics import AppEvent
from app.models.user import User

router = APIRouter(tags=["analytics"])

#: The permission to read the numbers, given through a role.
SCOPE = "analytics.view"

#: A phone reports a few times a visit; this only stops a flood.
reports = Attempts(limit=120, window_seconds=600)


class EventIn(BaseModel):
    name: str = Field(max_length=32)
    value: int | None = None
    detail: str | None = Field(default=None, max_length=32)


class EventsIn(BaseModel):
    events: list[EventIn] = Field(max_length=MAX_PER_REPORT)


@router.post("/analytics/events", status_code=status.HTTP_204_NO_CONTENT)
def report_events(body: EventsIn, request: Request, db: Session = Depends(get_db)) -> None:
    """A few events from the app, sent as a page is left (sendBeacon).

    Open before signing in too, since where people give up on the way in
    is one of the things counted. Signed in, the events are the person's;
    otherwise nobody's. Anything not on the list is dropped silently: the
    app cannot do anything useful with being told no.
    """
    who = request.client.host if request.client else "?"
    if not reports.allow(who):
        return
    token = request.cookies.get(sessions.COOKIE)
    session = sessions.session_for(db, token) if token else None
    user_id = session.user_id if session is not None else None
    rows = []
    for event in body.events:
        kept = clean(event.name, event.value, event.detail)
        if kept is not None:
            rows.append(AppEvent(name=event.name, user_id=user_id, value=kept[0], detail=kept[1]))
    if rows:
        db.add_all(rows)
        db.commit()


@router.get("/admin/analytics")
def read_analytics(
    days: int = Query(7, ge=1, le=90),
    _: User = Depends(require_admin(SCOPE)),
    db: Session = Depends(get_db),
) -> dict:
    """Every number on the analytics page, for the last `days` days."""
    return metrics.summary(db, days)
