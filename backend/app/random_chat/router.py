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
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.new_people import new_people_left, new_people_limit
from app.auth.dependencies import ONLINE_WITHIN, get_current_user, require_admin
from app.core.database import get_db
from app.core.time import utcnow
from app.live.events import announce_echo_to_everyone
from app.models.profile import Profile
from app.models.random_chat import (
    MAX_SEARCH_TAGS,
    WANT_ANYONE,
    WANTED_GENDERS,
    RandomChatSession,
    RandomChatTicket,
)
from app.models.report import SUSPEND_RANDOM_CHAT
from app.models.user import User
from app.profile.photos import get_current_avatar_url
from app.random_chat import proposals
from app.models.random_chat import DEFAULT_PROPOSAL_SECONDS, EchoProposal
# The interest list lives with its groups (tags.py).
from app.random_chat.tags import SEARCH_TAGS
from app.profile.note import fresh_note
from app.friends.router import FriendStatusOut, ask as ask_to_be_friends, friend_status
from app.random_chat.readiness import age_from_birth_year, missing_for_random_chat
from app.random_chat.service import (
    active_session_for,
    schedule_row,
    used_today,
    end_session,
    is_suspended,
    leave_pool,
    schedule_for,
    set_kept,
    ticket_for,
)

router = APIRouter(prefix="/random-chat", tags=["random-chat"])
admin_router = APIRouter(prefix="/admin/random-chat", tags=["admin"])


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
    #: Their own line, for the "found" card.
    tagline: str | None = None
    #: When you met — so the screen shows "found" only for a meeting that
    #: just happened, not one from days ago that nobody closed.
    started_at: str | None = None
    #: You and them, for the friend button at the top of the conversation:
    #: "none", "requested", "incoming" or "friends" (as on their profile).
    friend_status: str = "none"


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


class ProposalOut(BaseModel):
    """Somebody found for you, held while you both decide (section 32).

    No name and no photo on purpose: the only thing the card lets you judge
    is whether there is something to talk about. Both are revealed once you
    have both said "start".
    """

    id: int
    #: Their own line, if they wrote one.
    tagline: str | None
    shared_tags: list[str]
    #: Said only when there is no interest in common: "both into ...".
    shared_groups: list[str] = []
    expires_at: str
    #: The whole hold, so the ring around the card can show how much is left.
    seconds: int
    #: You have said "start" and are waiting for them.
    accepted: bool


class StatusOut(BaseModel):
    #: The admin switch and the nightly window together.
    open_now: bool
    minutes_until_open: int | None
    #: When it shuts, for the same reason: the app changes the door itself.
    minutes_until_close: int | None = None
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
    #: Honest numbers for the waiting screen: people here right now, and
    #: people waiting for somebody new this moment — you included in both.
    online_now: int = 0
    waiting_now: int = 0
    #: The panel's switch: False means the waiting screen shows no numbers.
    show_counts: bool = True
    #: Somebody found for you and waiting for both answers, or None.
    proposal: ProposalOut | None = None


def _matched_out(
    db: Session, session: RandomChatSession, viewer_id: int
) -> MatchedOut:
    other_id = session.other_user_id(viewer_id)
    other = db.get(User, other_id)
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
        friend_status=friend_status(db, viewer_id, other_id),
        tagline=fresh_note(_profile_of(db, other_id)),
        started_at=session.started_at.isoformat() if session.started_at else None,
    )


def _proposal_out(db: Session, proposal: EchoProposal, viewer_id: int) -> ProposalOut:
    other = _profile_of(db, proposal.other_user_id(viewer_id))
    held = (proposal.expires_at - proposal.created_at).total_seconds()
    return ProposalOut(
        id=proposal.id,
        # The note of the day, or nothing: with no note the card says
        # what the two share instead (section 32).
        tagline=fresh_note(other),
        shared_tags=proposal.shared_tags or [],
        shared_groups=proposal.shared_groups or [],
        expires_at=proposal.expires_at.isoformat(),
        seconds=round(held) or DEFAULT_PROPOSAL_SECONDS,
        accepted=proposal.accepted_by(viewer_id),
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

    Asking is also what settles a proposal whose time has run out, so a
    card that nobody answered ends on the next look from either side.
    """
    proposals.sweep_due(db)
    db.commit()
    schedule = schedule_for(db)
    open_now = schedule.is_open_at(local_minute)
    until_open = schedule.minutes_until_open(local_minute)

    session = active_session_for(db, current_user.id)
    ticket = ticket_for(db, current_user.id)
    proposal = proposals.open_proposal_for(db, current_user.id)
    remembered = ticket_for(db, current_user.id, active_only=False)

    quota = schedule.effective_daily_quota
    remaining = None if quota is None else max(0, quota - used_today(db, current_user.id))
    # The day's budget for new people, shared with "say hello", always
    # applies — whichever runs out first is what the door shows.
    shared_left = new_people_left(db, current_user.id)
    remaining = shared_left if remaining is None else min(remaining, shared_left)

    return StatusOut(
        open_now=open_now,
        minutes_until_open=until_open,
        minutes_until_close=schedule.minutes_until_close(local_minute),
        missing=missing_for_random_chat(current_user, schedule),
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
        online_now=db.scalar(
            select(func.count(User.id)).where(
                # You are counted too (the owner's decision): without
                # yourself, two people online each read "1" and feel alone.
                User.last_seen_at >= utcnow() - ONLINE_WITHIN
            )
        ) or 0,
        # You are counted here too, like above: searching with one other
        # person reads "2", not "1" (the owner's point).
        waiting_now=db.scalar(
            select(func.count(RandomChatTicket.id)).where(RandomChatTicket.active.is_(True))
        ) or 0,
        show_counts=schedule.show_counts is not False,
        proposal=_proposal_out(db, proposal, current_user.id) if proposal else None,
    )


@router.post("/search", response_model=StatusOut)
def join_pool(
    payload: SearchIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> StatusOut:
    """Joins the pool, and if anyone suitable waits, puts the two of you in
    front of each other (a proposal both must accept, section 32)."""
    proposals.sweep_due(db)
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
    missing = missing_for_random_chat(current_user, schedule_for(db))
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
    # Searching again while an earlier meeting is still open ends that
    # meeting — its conversation stays, it just stops being "the Echo you
    # are in" — so going back to Echo after talking to somebody finds a new
    # person instead of landing on the old one (section 32).
    earlier = active_session_for(db, current_user.id)
    if earlier is not None:
        end_session(db, earlier, ended_by_user_id=current_user.id)
        db.flush()

    if new_people_left(db, current_user.id) <= 0:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"reason": "daily_new_people_limit", "limit": new_people_limit(db)},
        )

    # Echo no longer asks for these (section 32); whatever a profile holds
    # is still passed on, and somebody with no profile is unknown on both.
    gender = profile.gender if profile else None
    age = age_from_birth_year(profile.birthday_year) if profile else None

    ticket = ticket_for(db, current_user.id, active_only=False)
    if ticket is not None:
        # Their row from last time: reused rather than replaced, so the
        # remembered search and the live ticket are never two rows that can
        # disagree.
        ticket.wants_gender = payload.wants_gender
        ticket.wants_age_min = payload.wants_age_min
        ticket.wants_age_max = payload.wants_age_max
        ticket.tags = payload.tags
        ticket.gender = gender
        ticket.age = age
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
            gender=gender,
            age=age,
            local_minute=payload.local_minute,
            joined_at=utcnow(),
            active=True,
        )
        try:
            # Added inside the savepoint for the same reason as in
            # conversation/service.py: added outside, a losing row survives
            # the rollback and the lookup below flushes it again.
            with db.begin_nested():
                db.add(ticket)
                db.flush()
        except IntegrityError:
            # Two taps landing together. The unique index is the real
            # guarantee; the one that lost simply uses the row that won.
            ticket = ticket_for(db, current_user.id, active_only=False)

    proposals.try_match(db, ticket)
    db.commit()
    return get_status(payload.local_minute, current_user, db)


@router.delete("/search", status_code=status.HTTP_204_NO_CONTENT)
def leave(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Stops waiting. Harmless when not waiting.

    Stopping while a card is up counts as saying no to it: the other person
    goes back to searching at once instead of waiting out the time.
    """
    leave_pool(db, current_user.id)
    proposal = proposals.open_proposal_for(db, current_user.id)
    if proposal is not None:
        db.flush()
        proposals.decline(db, proposal, current_user.id)
    db.commit()


def _my_proposal_or_404(db: Session, proposal_id: int, user_id: int) -> EchoProposal:
    proposal = db.get(EchoProposal, proposal_id)
    if proposal is None or user_id not in (proposal.user_a_id, proposal.user_b_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Proposal not found.")
    return proposal


@router.post("/proposals/{proposal_id}/accept", response_model=StatusOut)
def accept_proposal(
    proposal_id: int,
    local_minute: int = 0,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> StatusOut:
    """Says "start". Once the other person has said it too, the
    conversation is made and the status carries it as `matched`."""
    proposals.sweep_due(db)
    proposal = _my_proposal_or_404(db, proposal_id, current_user.id)
    # Too late (it ran out, or the other side said no) is not an error to
    # show anybody: the card simply goes, and the status says what now.
    if proposal.outcome is None:
        proposals.accept(db, proposal, current_user.id)
    db.commit()
    return get_status(local_minute, current_user, db)


@router.post("/proposals/{proposal_id}/decline", response_model=StatusOut)
def decline_proposal(
    proposal_id: int,
    local_minute: int = 0,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> StatusOut:
    """Says no, by button or by throwing the card aside. Both go back to
    searching; neither is told which of them said it."""
    proposals.sweep_due(db)
    proposal = _my_proposal_or_404(db, proposal_id, current_user.id)
    proposals.decline(db, proposal, current_user.id)
    db.commit()
    return get_status(local_minute, current_user, db)


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


#: Below this many people, a tag is not called "chosen tonight": with one
#: or two, it would tell you what a particular person picked.
TONIGHT_AT_LEAST = 3


class TonightTagOut(BaseModel):
    tag: str
    #: Chosen right now by at least TONIGHT_AT_LEAST people in Echo.
    tonight: bool


def tonight_order(counts: dict[str, int]) -> list[TonightTagOut]:
    """Every tag, the ones most chosen right now first.

    Only tags at least TONIGHT_AT_LEAST people chose move up; the rest
    keep the list's own order, so the order itself never gives away what
    one or two particular people picked.
    """
    hot = sorted(
        (tag for tag in SEARCH_TAGS if counts.get(tag, 0) >= TONIGHT_AT_LEAST),
        key=lambda tag: -counts[tag],
    )
    rest = [tag for tag in SEARCH_TAGS if tag not in hot]
    return [TonightTagOut(tag=tag, tonight=True) for tag in hot] + [
        TonightTagOut(tag=tag, tonight=False) for tag in rest
    ]


@router.get("/tags/tonight", response_model=list[TonightTagOut])
def tags_tonight(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[TonightTagOut]:
    """The interests, ordered by what the people in Echo right now chose
    (the owner's design, section 32): choosing one of those is the fastest
    way to somebody. "Right now" is everybody searching, and everybody in a
    meeting that has not ended — their last search is what brought them.
    """
    in_meetings = db.execute(
        select(RandomChatSession.user_a_id, RandomChatSession.user_b_id).where(
            RandomChatSession.ended_at.is_(None)
        )
    ).all()
    talking = {user_id for pair in in_meetings for user_id in pair}
    tickets = db.scalars(
        select(RandomChatTicket).where(
            RandomChatTicket.user_id != current_user.id,
            RandomChatTicket.active.is_(True) | RandomChatTicket.user_id.in_(talking or {-1}),
        )
    ).all()
    counts: dict[str, int] = {}
    for ticket in tickets:
        for tag in set(ticket.tags or []):
            counts[tag] = counts.get(tag, 0) + 1
    return tonight_order(counts)


class ScheduleIn(BaseModel):
    enabled: bool
    #: Open all day; the window below is kept but does not apply.
    always_open: bool = False
    opens_at_minute: int = Field(default=0, ge=0, le=1440)
    closes_at_minute: int = Field(default=1440, ge=0, le=1440)
    #: The number in the panel, kept even while the tick box above it says
    #: unlimited — so untick and the old number is still there.
    daily_quota: int = Field(default=10, ge=1, le=1000)
    daily_quota_unlimited: bool = True
    #: How long two people found for each other are held while they decide.
    proposal_seconds: int = Field(default=DEFAULT_PROPOSAL_SECONDS, ge=5, le=120)
    #: Whether the waiting screen shows how many are here and searching.
    show_counts: bool = True
    #: Whether "eighteen or over" is asked the first time Echo opens.
    ask_adult: bool = True


class ScheduleOut(BaseModel):
    enabled: bool
    always_open: bool
    opens_at_minute: int
    closes_at_minute: int
    daily_quota: int
    daily_quota_unlimited: bool
    proposal_seconds: int
    show_counts: bool
    ask_adult: bool


@admin_router.get("/schedule", response_model=ScheduleOut)
def get_schedule(
    _: User = Depends(require_admin("moderation.random_chat")),
    db: Session = Depends(get_db),
) -> ScheduleOut:
    schedule = schedule_for(db)
    return ScheduleOut(
        enabled=schedule.enabled,
        always_open=schedule.always_open,
        opens_at_minute=schedule.opens_at_minute,
        closes_at_minute=schedule.closes_at_minute,
        daily_quota=schedule.daily_quota,
        daily_quota_unlimited=schedule.daily_quota_unlimited,
        proposal_seconds=schedule.proposal_seconds or DEFAULT_PROPOSAL_SECONDS,
        show_counts=schedule.show_counts is not False,
        ask_adult=schedule.ask_adult is not False,
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
    schedule.always_open = payload.always_open
    schedule.opens_at_minute = payload.opens_at_minute
    schedule.closes_at_minute = payload.closes_at_minute
    schedule.daily_quota = payload.daily_quota
    schedule.daily_quota_unlimited = payload.daily_quota_unlimited
    schedule.proposal_seconds = payload.proposal_seconds
    schedule.show_counts = payload.show_counts
    schedule.ask_adult = payload.ask_adult
    db.commit()
    announce_echo_to_everyone()
    return ScheduleOut(
        enabled=schedule.enabled,
        always_open=schedule.always_open,
        opens_at_minute=schedule.opens_at_minute,
        closes_at_minute=schedule.closes_at_minute,
        daily_quota=schedule.daily_quota,
        daily_quota_unlimited=schedule.daily_quota_unlimited,
        proposal_seconds=schedule.proposal_seconds or DEFAULT_PROPOSAL_SECONDS,
        show_counts=schedule.show_counts is not False,
        ask_adult=schedule.ask_adult is not False,
    )


@router.post("/sessions/{session_id}/friend", response_model=FriendStatusOut)
def ask_the_other_person_to_be_friends(
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FriendStatusOut:
    """The friend button at the top of a random conversation.

    Exactly the button on their profile, taken while you are still
    talking: an ordinary request the other person answers, and a yes at
    once if they had already asked you. Was a follow button until
    following was replaced by friendship (TECHNICAL_REQUIREMENTS.md
    section 42); only somebody you were matched with can be asked here.
    """
    session = _my_session_or_404(db, session_id, current_user.id)
    return ask_to_be_friends(session.other_user_id(current_user.id), current_user, db)
