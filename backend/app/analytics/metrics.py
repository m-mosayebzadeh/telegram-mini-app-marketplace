"""
The numbers on the admin panel's analytics page (TECHNICAL_REQUIREMENTS.md
section 43, "analytics" — the list the owner approved, all of it).

Counted, never read: every number here comes from counting rows, and none
of it looks at what anybody wrote. Most come from the tables the app
already has; only "came back", the sign-in steps, the app's own speed and
errors, and notifications use the two analytics tables
(app/models/analytics.py).

Worked out when the page is opened, over a window of days. Fine while the
app is young; once the tables are large these become nightly summaries
written into a table of their own, and this module reads those instead.
"""

from __future__ import annotations

import statistics
from datetime import date, timedelta

from sqlalchemy import Date, String, cast, distinct, exists, func, literal_column, select, union
from sqlalchemy.orm import Session, aliased

from app.core import team
from app.core.time import utcnow
from app.models.analytics import ActiveDay, AppEvent
from app.models.auth_session import AuthIdentity
from app.models.block import Block
from app.models.chat_message import ChatMessage
from app.models.conversation import Conversation, ConversationParticipant
from app.models.friendship import FRIENDSHIP_ACCEPTED, Friendship
from app.models.profile import Profile
from app.models.profile_photo import ProfilePhoto
from app.models.push import PushSubscription
from app.models.random_chat import EchoProposal, RandomChatSession
from app.models.report import Report
from app.models.user import User, UserStatus

DAY = timedelta(days=1)


def _share(part: int, whole: int) -> float | None:
    """A share between 0 and 1, or None when there is nothing to divide."""
    return round(part / whole, 3) if whole else None


def _scalar(db: Session, query) -> int:
    return int(db.scalar(query) or 0)


def _people():
    """Real people: never the Cosmos Team account."""
    return User.status != UserStatus.TEAM


# --- 7-a: the one number --------------------------------------------------------


def answered_conversations(db: Session, start, end, team_id: int) -> int:
    """Conversations where both people said something between `start` and
    `end`: an acquaintance actually happening, which is what this product
    is for. Cosmos Team's words do not count."""
    both = (
        select(ChatMessage.conversation_id)
        .where(ChatMessage.created_at >= start, ChatMessage.created_at < end, ChatMessage.sender_id != team_id)
        .group_by(ChatMessage.conversation_id)
        .having(func.count(distinct(ChatMessage.sender_id)) >= 2)
        .subquery()
    )
    return _scalar(db, select(func.count()).select_from(both))


def _active_conversations(db: Session, start, end, team_id: int) -> int:
    return _scalar(
        db,
        select(func.count(distinct(ChatMessage.conversation_id))).where(
            ChatMessage.created_at >= start, ChatMessage.created_at < end, ChatMessage.sender_id != team_id
        ),
    )


# --- 7-b: the way in --------------------------------------------------------------


def _ways_in(db: Session, start, end) -> dict[str, int]:
    """New people by the way they first came in."""
    first = (
        select(AuthIdentity.user_id, func.min(AuthIdentity.created_at).label("first_at"))
        .group_by(AuthIdentity.user_id)
        .subquery()
    )
    first_way = (
        select(AuthIdentity.user_id, AuthIdentity.provider)
        .join(first, (first.c.user_id == AuthIdentity.user_id) & (first.c.first_at == AuthIdentity.created_at))
        .subquery()
    )
    # A literal in the SQL itself, not a parameter: the database must see
    # the grouped expression and the selected one as the same.
    way = func.coalesce(first_way.c.provider, literal_column("'other'")).label("way")
    rows = db.execute(
        select(way, func.count(distinct(User.id)))
        .select_from(User)
        .outerjoin(first_way, first_way.c.user_id == User.id)
        .where(User.joined_at >= start, User.joined_at < end, _people())
        .group_by(way)
    ).all()
    return {way: count for way, count in rows}


def _events_by_detail(db: Session, name: str, start, end) -> dict[str, int]:
    rows = db.execute(
        select(AppEvent.detail, func.count())
        .where(AppEvent.name == name, AppEvent.at >= start, AppEvent.at < end)
        .group_by(AppEvent.detail)
    ).all()
    return {detail or "": count for detail, count in rows}


# --- 7-c: a newcomer's first day ---------------------------------------------------


def _first_day(db: Session, start, end, team_id: int) -> dict:
    """Of the people who joined in the window (and have had a whole first
    day), how many did each first thing within a day of joining."""
    cohort = select(User.id).where(User.joined_at >= start, User.joined_at < end - DAY, _people())
    total = _scalar(db, select(func.count()).select_from(cohort.subquery()))
    # Written into the SQL: the time column's type takes no interval as a parameter.
    within_day = User.joined_at + literal_column("interval '1 day'")

    team_threads = select(ConversationParticipant.conversation_id).where(ConversationParticipant.user_id == team_id)

    completed = _scalar(
        db,
        select(func.count(distinct(User.id)))
        .select_from(User)
        .outerjoin(Profile, Profile.user_id == User.id)
        .where(
            User.id.in_(cohort),
            (func.coalesce(Profile.bio, "") != "")
            | (func.coalesce(cast(Profile.interests, String), "[]") != "[]")
            | exists().where(ProfilePhoto.user_id == User.id),
        ),
    )
    approached_ids = set(
        db.scalars(
            select(Conversation.opened_by_id)
            .join(User, User.id == Conversation.opened_by_id)
            .where(User.id.in_(cohort), Conversation.created_at <= within_day)
        )
    )
    for a, b in db.execute(
        select(RandomChatSession.user_a_id, RandomChatSession.user_b_id)
        .join(User, (User.id == RandomChatSession.user_a_id) | (User.id == RandomChatSession.user_b_id))
        .where(User.id.in_(cohort), RandomChatSession.started_at <= within_day)
    ):
        approached_ids.update((a, b))
    cohort_ids = set(db.scalars(cohort))
    approached = len(approached_ids & cohort_ids)

    wrote = _scalar(
        db,
        select(func.count(distinct(User.id)))
        .select_from(User)
        .join(ChatMessage, ChatMessage.sender_id == User.id)
        .where(User.id.in_(cohort), ChatMessage.created_at <= within_day, ChatMessage.conversation_id.not_in(team_threads)),
    )
    answered = _scalar(
        db,
        select(func.count(distinct(User.id)))
        .select_from(User)
        .join(ConversationParticipant, ConversationParticipant.user_id == User.id)
        .join(ChatMessage, ChatMessage.conversation_id == ConversationParticipant.conversation_id)
        .where(
            User.id.in_(cohort),
            ChatMessage.sender_id != User.id,
            ChatMessage.sender_id != team_id,
            ChatMessage.created_at <= within_day,
        ),
    )
    return {
        "people": total,
        "profile": _share(completed, total),
        "approached": _share(approached, total),
        "wrote": _share(wrote, total),
        "answered": _share(answered, total),
    }


# --- 7-d: coming back ---------------------------------------------------------------


def _active_since(db: Session, since: date) -> int:
    """People who used the app on or after `since`: a day row, or joining
    that day (the day somebody joins writes no row of its own)."""
    days = select(ActiveDay.user_id).where(ActiveDay.day >= since)
    joined = select(User.id).where(cast(User.joined_at, Date) >= since, _people())
    return _scalar(db, select(func.count()).select_from(union(days, joined).subquery()))


def _came_back(db: Session, today: date, after_days: int) -> float | None:
    """Of the people who joined in the four weeks ending `after_days` ago,
    the share who used the app again exactly `after_days` days after."""
    last_join = today - timedelta(days=after_days)
    first_join = last_join - timedelta(days=28)
    joined_on = cast(User.joined_at, Date)
    cohort = select(User.id).where(joined_on >= first_join, joined_on <= last_join, _people())
    total = _scalar(db, select(func.count()).select_from(cohort.subquery()))
    back = _scalar(
        db,
        select(func.count(distinct(User.id)))
        .select_from(User)
        .join(ActiveDay, ActiveDay.user_id == User.id)
        .where(User.id.in_(cohort), ActiveDay.day == joined_on + after_days),
    )
    return _share(back, total)


# --- 7-e: friendship -------------------------------------------------------------------


def _friendship(db: Session, start, end) -> dict:
    asked = _scalar(db, select(func.count()).where(Friendship.created_at >= start, Friendship.created_at < end))
    accepted = select(Friendship).where(
        Friendship.status == FRIENDSHIP_ACCEPTED, Friendship.accepted_at >= start, Friendship.accepted_at < end
    )
    accepted_count = _scalar(db, select(func.count()).select_from(accepted.subquery()))
    one, other = aliased(ConversationParticipant), aliased(ConversationParticipant)
    still_talking = _scalar(
        db,
        select(func.count(distinct(Friendship.id))).where(
            Friendship.status == FRIENDSHIP_ACCEPTED,
            Friendship.accepted_at >= start,
            Friendship.accepted_at < end,
            exists().where(
                one.user_id == Friendship.user_low_id,
                other.user_id == Friendship.user_high_id,
                one.conversation_id == other.conversation_id,
                ChatMessage.conversation_id == one.conversation_id,
                ChatMessage.created_at > Friendship.accepted_at,
            ),
        ),
    )
    return {"asked": asked, "accepted": accepted_count, "talked_after": _share(still_talking, accepted_count)}


# --- 7-f: Echo ---------------------------------------------------------------------------


def _echo(db: Session, start, end) -> dict:
    outcome = func.coalesce(EchoProposal.outcome, literal_column("'open'")).label("outcome")
    proposals = dict(
        db.execute(
            select(outcome, func.count())
            .where(EchoProposal.created_at >= start, EchoProposal.created_at < end)
            .group_by(outcome)
        ).all()
    )
    in_window = (RandomChatSession.started_at >= start, RandomChatSession.started_at < end)
    started = _scalar(db, select(func.count()).where(*in_window))
    short = _scalar(
        db,
        select(func.count()).where(
            *in_window,
            RandomChatSession.ended_at.is_not(None),
            RandomChatSession.ended_at < RandomChatSession.started_at + literal_column("interval '2 minutes'"),
        ),
    )
    kept = _scalar(db, select(func.count()).where(*in_window, RandomChatSession.kept_by_a, RandomChatSession.kept_by_b))
    # Echo's own wait is not stored; how long proposals took to be answered
    # stands in for it.
    return {
        "proposals": sum(proposals.values()),
        "outcomes": proposals,
        "met": started,
        "ended_early": _share(short, started),
        "kept": _share(kept, started),
    }


# --- 7-g: safety ---------------------------------------------------------------------------


def _team_answer_minutes(db: Session, start, end, team_id: int) -> float | None:
    """The median wait, in minutes, between somebody writing to the team
    and the next answer from a staff member."""
    team_threads = select(ConversationParticipant.conversation_id).where(ConversationParticipant.user_id == team_id)
    rows = db.execute(
        select(ChatMessage.conversation_id, ChatMessage.sender_id, ChatMessage.staff_id, ChatMessage.created_at)
        .where(ChatMessage.conversation_id.in_(team_threads), ChatMessage.created_at >= start, ChatMessage.created_at < end)
        .order_by(ChatMessage.conversation_id, ChatMessage.created_at)
    ).all()
    waits: list[float] = []
    waiting_since: dict[int, object] = {}
    for conversation_id, sender_id, staff_id, at in rows:
        if sender_id != team_id:
            waiting_since.setdefault(conversation_id, at)
        elif staff_id is not None and conversation_id in waiting_since:
            waits.append((at - waiting_since.pop(conversation_id)).total_seconds() / 60)
    return round(statistics.median(waits), 1) if waits else None


def _safety(db: Session, start, end, team_id: int) -> dict:
    conversations = _active_conversations(db, start, end, team_id)
    reports = _scalar(db, select(func.count()).where(Report.created_at >= start, Report.created_at < end))
    blocks = _scalar(db, select(func.count()).where(Block.created_at >= start, Block.created_at < end))
    per_thousand = (lambda n: round(n * 1000 / conversations, 1) if conversations else None)
    return {
        "conversations": conversations,
        "reports": reports,
        "blocks": blocks,
        "reports_per_1000": per_thousand(reports),
        "blocks_per_1000": per_thousand(blocks),
        "team_answer_minutes": _team_answer_minutes(db, start, end, team_id),
    }


# --- 7-h: notifications, 7-i: the app itself ------------------------------------------------


def _count_events(db: Session, name: str, start, end) -> int:
    return _scalar(db, select(func.count()).where(AppEvent.name == name, AppEvent.at >= start, AppEvent.at < end))


def _percentile(db: Session, name: str, share: float, start, end, detail: str | None = None) -> float | None:
    where = [AppEvent.name == name, AppEvent.at >= start, AppEvent.at < end, AppEvent.value.is_not(None)]
    if detail is not None:
        where.append(AppEvent.detail == detail)
    value = db.scalar(select(func.percentile_cont(share).within_group(AppEvent.value)).where(*where))
    return round(float(value)) if value is not None else None


def summary(db: Session, days: int) -> dict:
    """Everything on the page, for the last `days` days (and the same
    number of days before, for the one number's comparison)."""
    now = utcnow()
    start, before = now - timedelta(days=days), now - timedelta(days=2 * days)
    today = now.date()
    team_id = team.team_user(db).id
    monthly = _active_since(db, today - timedelta(days=29))
    with_push = _scalar(
        db,
        select(func.count(distinct(PushSubscription.user_id))).join(User, User.id == PushSubscription.user_id).where(_people()),
    )
    sent, opened = _count_events(db, "push_sent", start, now), _count_events(db, "push_opened", start, now)
    return {
        "days": days,
        "answered": {
            "now": answered_conversations(db, start, now, team_id),
            "before": answered_conversations(db, before, start, team_id),
        },
        "joining": {
            "people": sum(_ways_in(db, start, now).values()),
            "ways": _ways_in(db, start, now),
            "steps": _events_by_detail(db, "signin_step", start, now),
        },
        "first_day": _first_day(db, start, now, team_id),
        "coming_back": {
            "today": _active_since(db, today),
            "week": _active_since(db, today - timedelta(days=6)),
            "month": monthly,
            "day1": _came_back(db, today, 1),
            "day7": _came_back(db, today, 7),
            "day30": _came_back(db, today, 30),
        },
        "friendship": _friendship(db, start, now),
        "echo": _echo(db, start, now),
        "safety": _safety(db, start, now, team_id),
        "notifications": {
            "people_with": with_push,
            "share_of_month": _share(with_push, monthly),
            "sent": sent,
            "opened": opened,
            "opened_share": _share(opened, sent),
        },
        "app": {
            "load_ms_median": _percentile(db, "app_load", 0.5, start, now),
            "load_ms_slow": _percentile(db, "app_load", 0.9, start, now),
            "errors": _events_by_detail(db, "app_error", start, now),
            "fps_normal": _percentile(db, "frame_rate", 0.5, start, now, "normal"),
            "fps_light": _percentile(db, "frame_rate", 0.5, start, now, "light"),
            "fps_slow_phones": _percentile(db, "frame_rate", 0.1, start, now),
        },
    }
