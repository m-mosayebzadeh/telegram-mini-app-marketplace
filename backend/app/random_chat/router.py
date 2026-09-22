"""
Random chat: the door, the pool, and the conversation it produces.

The shape of these routes follows one decision
(TECHNICAL_REQUIREMENTS.md section 28.1): pressing the button means
JOINING A POOL, not sending a request. A waiting person holds exactly one
row however many times they tap, and finds out they were matched by
asking for their own status — so impatience costs the server nothing.

Matching happens when somebody joins, against everyone already waiting.
Nothing ticks anywhere, the same as every other deadline in this app.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user, require_admin
from app.core.database import get_db
from app.core.time import utcnow
from app.models.profile import Profile
from app.models.random_chat import (
    MAX_SEARCH_TAGS,
    WANT_ANYONE,
    WANTED_GENDERS,
    RandomChatSession,
    RandomChatTicket,
)
from app.models.follow import Follow, FollowStatus
from app.models.report import SUSPEND_RANDOM_CHAT
from app.models.user import User
from app.profile.photos import get_current_avatar_url
from app.random_chat.matching import find_match
from app.random_chat.readiness import age_from_birth_year, missing_for_random_chat
from app.random_chat.service import (
    active_session_for,
    follow_from_random_chat,
    schedule_row,
    used_today,
    end_session,
    is_suspended,
    leave_pool,
    schedule_for,
    set_kept,
    start_session,
    ticket_for,
)

router = APIRouter(prefix="/random-chat", tags=["random-chat"])
admin_router = APIRouter(prefix="/admin/random-chat", tags=["admin"])

#: The tag list, fixed and short. Tags are conversation openers, not
#: filters, so this is about having something to say rather than about
#: describing yourself exhaustively — a long list would make the choice a
#: chore and the overlap meaningless.
SEARCH_TAGS = (
    "music", "film", "books", "games", "sport", "travel", "food", "art",
    "tech", "study", "work", "startup", "animals", "nature", "photography",
    "nightowl", "deeptalk", "smalltalk", "advice", "language",
)


class SearchIn(BaseModel):
    """What someone is hoping for THIS time. Asked on every search and
    stored nowhere lasting, because it is a mood and not a fact."""

    wants_gender: str = WANT_ANYONE
    wants_age_min: int | None = Field(default=None, ge=18, le=120)
    wants_age_max: int | None = Field(default=None, ge=18, le=120)
    tags: list[str] = Field(default_factory=list)
    #: Minutes past midnight where the CALLER is. The app sends it; the
    #: server never stores or infers a timezone (section 28).
    local_minute: int = Field(default=0, ge=0, le=1439)


class MatchedOut(BaseModel):
    session_id: int
    conversation_id: int
    other_user_id: int
    display_name: str
    username: str | None
    avatar_url: str | None
    shared_tags: list[str]
    #: Whether this person got what they asked for. The screen says so out
    #: loud when they did not, rather than handing over a quiet mismatch.
    gender_as_asked: bool
    age_as_asked: bool
    #: The follow button at the top of the conversation. "requested" once
    #: this person has pressed it, "following" once the other side has
    #: agreed too — which is what greys the button out.
    follow_status: str  # "none" | "requested" | "following"


class LastSearchOut(BaseModel):
    """What this person searched for last time.

    Sent so the screen can open with those choices already filled in —
    visibly, not silently. The three questions are a mood rather than a
    setting, and a mood re-applied behind someone's back quietly becomes a
    permanent setting nobody chose.
    """

    wants_gender: str
    wants_age_min: int | None
    wants_age_max: int | None
    tags: list[str]


class StatusOut(BaseModel):
    #: The admin switch and the nightly window together.
    open_now: bool
    minutes_until_open: int | None
    #: What the door still needs before this person can be matched.
    missing: list[str]
    suspended: bool
    waiting: bool
    waiting_since: str | None
    matched: MatchedOut | None
    #: Pre-fill for the search form. None the very first time.
    last_search: LastSearchOut | None
    #: How many conversations are left today. None means unlimited, which
    #: is where the cap starts.
    remaining_today: int | None


def _matched_out(
    db: Session, session: RandomChatSession, viewer_id: int
) -> MatchedOut:
    other_id = session.other_user_id(viewer_id)
    other = db.get(User, other_id)
    mine = db.scalar(
        select(Follow).where(
            Follow.follower_id == viewer_id, Follow.followee_id == other_id
        )
    )
    if mine is None or mine.status == FollowStatus.REJECTED:
        follow_status = "none"
    elif mine.status == FollowStatus.ACCEPTED:
        follow_status = "following"
    else:
        follow_status = "requested"

    return MatchedOut(
        session_id=session.id,
        conversation_id=session.conversation_id,
        other_user_id=other_id,
        display_name=other.display_name,
        username=other.username,
        avatar_url=get_current_avatar_url(db, other_id),
        shared_tags=session.shared_tags or [],
        # Recomputed honestly rather than stored per side: the ticket is
        # gone by now, and these two facts are what the screen needs.
        gender_as_asked=True,
        age_as_asked=True,
        follow_status=follow_status,
    )


def _profile_of(db: Session, user_id: int) -> Profile | None:
    return db.scalar(select(Profile).where(Profile.user_id == user_id))


@router.get("/status", response_model=StatusOut)
def get_status(
    local_minute: int = 0,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> StatusOut:
    """Everything the random-chat screen needs, in one call.

    It is also how a waiting person discovers they were matched: the
    matcher runs when somebody joins, so the person who was already
    waiting finds out by asking.
    """
    schedule = schedule_for(db)
    open_now = schedule.is_open_at(local_minute)
    until_open = schedule.minutes_until_open(local_minute)

    session = active_session_for(db, current_user.id)
    ticket = ticket_for(db, current_user.id)
    remembered = ticket_for(db, current_user.id, active_only=False)

    quota = schedule.effective_daily_quota
    remaining = None if quota is None else max(0, quota - used_today(db, current_user.id))

    return StatusOut(
        open_now=open_now,
        minutes_until_open=until_open,
        missing=missing_for_random_chat(_profile_of(db, current_user.id)),
        suspended=is_suspended(db, current_user.id, SUSPEND_RANDOM_CHAT),
        waiting=ticket is not None,
        waiting_since=ticket.joined_at.isoformat() if ticket else None,
        matched=_matched_out(db, session, current_user.id) if session else None,
        last_search=(
            LastSearchOut(
                wants_gender=remembered.wants_gender,
                wants_age_min=remembered.wants_age_min,
                wants_age_max=remembered.wants_age_max,
                tags=remembered.tags or [],
            )
            if remembered
            else None
        ),
        remaining_today=remaining,
    )


@router.post("/search", response_model=StatusOut)
def join_pool(
    payload: SearchIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> StatusOut:
    """Joins the pool, and matches immediately if anyone suitable waits."""
    schedule = schedule_for(db)
    if not schedule.is_open_at(payload.local_minute):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail={
                "reason": "closed",
                "minutes_until_open": schedule.minutes_until_open(payload.local_minute),
            },
        )

    if is_suspended(db, current_user.id, SUSPEND_RANDOM_CHAT):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail={"reason": "suspended"})

    profile = _profile_of(db, current_user.id)
    missing = missing_for_random_chat(profile)
    if missing:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail={"reason": "profile_incomplete", "missing": missing},
        )

    if payload.wants_gender not in WANTED_GENDERS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail={"reason": "bad_gender"})
    if len(payload.tags) > MAX_SEARCH_TAGS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail={"reason": "too_many_tags", "max": MAX_SEARCH_TAGS},
        )
    unknown = [tag for tag in payload.tags if tag not in SEARCH_TAGS]
    if unknown:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, detail={"reason": "unknown_tags", "tags": unknown}
        )

    quota = schedule.effective_daily_quota
    if quota is not None and used_today(db, current_user.id) >= quota:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"reason": "daily_quota_reached", "limit": quota},
        )

    # Already in a conversation: hand it back rather than starting another.
    # Somebody who reopens the app mid-chat should land where they were.
    existing_session = active_session_for(db, current_user.id)
    if existing_session is not None:
        return get_status(payload.local_minute, current_user, db)

    ticket = ticket_for(db, current_user.id, active_only=False)
    if ticket is not None:
        # Their row from last time: reused rather than replaced, so the
        # remembered search and the live ticket are never two rows that can
        # disagree.
        ticket.wants_gender = payload.wants_gender
        ticket.wants_age_min = payload.wants_age_min
        ticket.wants_age_max = payload.wants_age_max
        ticket.tags = payload.tags
        ticket.gender = profile.gender
        ticket.age = age_from_birth_year(profile.birthday_year)
        ticket.local_minute = payload.local_minute
        ticket.joined_at = utcnow()
        ticket.active = True
        db.flush()
    else:
        ticket = RandomChatTicket(
            user_id=current_user.id,
            wants_gender=payload.wants_gender,
            wants_age_min=payload.wants_age_min,
            wants_age_max=payload.wants_age_max,
            tags=payload.tags,
            # Frozen here so the matcher never re-reads a profile mid-run
            # and nobody can change what they are while queued.
            gender=profile.gender,
            age=age_from_birth_year(profile.birthday_year),
            local_minute=payload.local_minute,
            joined_at=utcnow(),
            active=True,
        )
        db.add(ticket)
        try:
            with db.begin_nested():
                db.flush()
        except IntegrityError:
            # Two taps landing together. The unique index is the real
            # guarantee; the one that lost simply uses the row that won.
            ticket = ticket_for(db, current_user.id, active_only=False)

    pairing = find_match(db, ticket)
    if pairing is not None:
        start_session(
            db, one=pairing.ticket, other=pairing.other, shared_tags=pairing.shared_tags
        )
    db.commit()
    return get_status(payload.local_minute, current_user, db)


@router.delete("/search", status_code=status.HTTP_204_NO_CONTENT)
def leave(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Stops waiting. Harmless when not waiting."""
    leave_pool(db, current_user.id)
    db.commit()


def _my_session_or_404(db: Session, session_id: int, user_id: int) -> RandomChatSession:
    session = db.get(RandomChatSession, session_id)
    if session is None or user_id not in (session.user_a_id, session.user_b_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found.")
    return session


@router.post("/sessions/{session_id}/leave", status_code=status.HTTP_204_NO_CONTENT)
def leave_session(
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Ends the conversation from this side.

    The other person is told, and keeps the thread until they close it
    themselves — walking out should not also delete the screen from under
    the person walked out on.
    """
    session = _my_session_or_404(db, session_id, current_user.id)
    end_session(db, session, ended_by_user_id=current_user.id)
    db.commit()


class KeepIn(BaseModel):
    kept: bool = True


@router.post("/sessions/{session_id}/keep", status_code=status.HTTP_204_NO_CONTENT)
def keep(
    session_id: int,
    payload: KeepIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Says you would like to keep this person.

    Only when both have does the thread stay in both lists. One-sided
    interest is never shown to anyone, so not being kept is never a
    rejection anybody feels.
    """
    session = _my_session_or_404(db, session_id, current_user.id)
    set_kept(db, session, current_user.id, payload.kept)
    db.commit()


@router.get("/tags", response_model=list[str])
def list_tags() -> list[str]:
    """The fixed tag list, so the app never hardcodes its own copy."""
    return list(SEARCH_TAGS)


class ScheduleIn(BaseModel):
    enabled: bool
    opens_at_minute: int = Field(default=0, ge=0, le=1440)
    closes_at_minute: int = Field(default=1440, ge=0, le=1440)
    #: The number in the panel, kept even while the tick box above it says
    #: unlimited — so untick and the old number is still there.
    daily_quota: int = Field(default=10, ge=1, le=1000)
    daily_quota_unlimited: bool = True


class ScheduleOut(BaseModel):
    enabled: bool
    opens_at_minute: int
    closes_at_minute: int
    daily_quota: int
    daily_quota_unlimited: bool


@admin_router.get("/schedule", response_model=ScheduleOut)
def get_schedule(
    _: User = Depends(require_admin("moderation.random_chat")),
    db: Session = Depends(get_db),
) -> ScheduleOut:
    schedule = schedule_for(db)
    return ScheduleOut(
        enabled=schedule.enabled,
        opens_at_minute=schedule.opens_at_minute,
        closes_at_minute=schedule.closes_at_minute,
        daily_quota=schedule.daily_quota,
        daily_quota_unlimited=schedule.daily_quota_unlimited,
    )


@admin_router.put("/schedule", response_model=ScheduleOut)
def set_schedule(
    payload: ScheduleIn,
    _: User = Depends(require_admin("moderation.random_chat")),
    db: Session = Depends(get_db),
) -> ScheduleOut:
    """The master switch and the nightly window.

    Two jobs in one place: holding the whole feature shut until the
    community is large enough, and setting the hours once it is open. The
    hours are on the viewer's own clock, so "22:00" is 22:00 wherever each
    person is.
    """
    schedule = schedule_row(db)
    schedule.enabled = payload.enabled
    schedule.opens_at_minute = payload.opens_at_minute
    schedule.closes_at_minute = payload.closes_at_minute
    schedule.daily_quota = payload.daily_quota
    schedule.daily_quota_unlimited = payload.daily_quota_unlimited
    db.commit()
    return ScheduleOut(
        enabled=schedule.enabled,
        opens_at_minute=schedule.opens_at_minute,
        closes_at_minute=schedule.closes_at_minute,
        daily_quota=schedule.daily_quota,
        daily_quota_unlimited=schedule.daily_quota_unlimited,
    )


class FollowResultOut(BaseModel):
    #: True when the other person had already asked to follow you, so both
    #: requests were accepted at once — a follow and a follow-back.
    mutual: bool
    follow_status: str


@router.post("/sessions/{session_id}/follow", response_model=FollowResultOut)
def follow_the_other_person(
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FollowResultOut:
    """The follow button at the top of a random conversation.

    A shortcut to the button on their profile, nothing more: the other
    person still decides. The one exception is when they had already asked
    to follow you — then both of you have said yes to the same thing and
    it becomes a follow and a follow-back immediately.
    """
    session = _my_session_or_404(db, session_id, current_user.id)
    mutual = follow_from_random_chat(db, session, current_user.id)
    db.commit()
    return FollowResultOut(
        mutual=mutual, follow_status="following" if mutual else "requested"
    )
