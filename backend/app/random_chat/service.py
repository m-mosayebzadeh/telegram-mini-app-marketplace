"""
Joining the pool, being matched, and what happens when it ends.

This is the part that changes things; app/random_chat/matching.py only
decides who goes with whom.
"""

from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.conversation.service import get_or_create_direct
from app.core.time import start_of_utc_day, utcnow
from app.models.conversation import Conversation
from app.models.feature_schedule import FEATURE_RANDOM_CHAT, FeatureSchedule
from app.models.follow import Follow, FollowStatus
from app.models.random_chat import RandomChatSession, RandomChatTicket
from app.models.report import SUSPEND_EVERYTHING, SUSPEND_RANDOM_CHAT, Suspension


def schedule_for(db: Session, feature: str = FEATURE_RANDOM_CHAT) -> FeatureSchedule:
    """This feature's window, or a switched-off default when nobody has
    configured one.

    The default is built rather than stored, so a missing row means "shut"
    instead of an error. Shut is the right way to fail: a feature that
    turns itself on because its configuration is missing is the wrong kind
    of surprise.
    """
    found = db.scalar(select(FeatureSchedule).where(FeatureSchedule.feature == feature))
    if found is not None:
        return found
    return FeatureSchedule(
        feature=feature, enabled=False, opens_at_minute=0, closes_at_minute=1440
    )


def schedule_row(db: Session, feature: str = FEATURE_RANDOM_CHAT) -> FeatureSchedule:
    """The real, saved row — created if this is the first time anyone has
    configured it. Only the admin route needs this."""
    found = db.scalar(select(FeatureSchedule).where(FeatureSchedule.feature == feature))
    if found is None:
        found = FeatureSchedule(
            feature=feature, enabled=False, opens_at_minute=0, closes_at_minute=1440
        )
        db.add(found)
        db.flush()
    return found


def is_suspended(db: Session, user_id: int, scope: str) -> bool:
    """Whether a live suspension stops this person doing this thing.

    Expiry is read here rather than swept by anything that ticks, the same
    way every other deadline in this app works: a suspension is over the
    moment somebody looks and finds it past its end.
    """
    now = utcnow()
    return db.scalar(
        select(func.count(Suspension.id)).where(
            Suspension.user_id == user_id,
            Suspension.expires_at > now,
            Suspension.scope.in_([scope, SUSPEND_EVERYTHING]),
        )
    ) > 0


def active_session_for(db: Session, user_id: int) -> RandomChatSession | None:
    """The random conversation this person is in right now, if any."""
    return db.scalar(
        select(RandomChatSession).where(
            RandomChatSession.ended_at.is_(None),
            (RandomChatSession.user_a_id == user_id)
            | (RandomChatSession.user_b_id == user_id),
        )
    )


def ticket_for(db: Session, user_id: int, *, active_only: bool = True) -> RandomChatTicket | None:
    """This person's ticket. By default only while they are actually
    waiting; pass active_only=False to read their last search."""
    query = select(RandomChatTicket).where(RandomChatTicket.user_id == user_id)
    if active_only:
        query = query.where(RandomChatTicket.active.is_(True))
    return db.scalar(query)


def leave_pool(db: Session, user_id: int) -> bool:
    """Stops someone waiting. True if they were.

    The row is kept rather than deleted, because it is also the record of
    what they last searched for — which is what lets the next search open
    with their previous choices already filled in instead of asking the
    same three questions again.
    """
    ticket = ticket_for(db, user_id)
    if ticket is None:
        return False
    ticket.active = False
    return True


def used_today(db: Session, user_id: int) -> int:
    """How many random conversations this person has started since the
    daily reset. The same fixed UTC boundary the request quota uses, so
    everyone gets exactly one reset every twenty-four hours."""
    since = start_of_utc_day()
    return db.scalar(
        select(func.count(RandomChatSession.id)).where(
            RandomChatSession.started_at >= since,
            (RandomChatSession.user_a_id == user_id)
            | (RandomChatSession.user_b_id == user_id),
        )
    )


def start_session(
    db: Session,
    *,
    one: RandomChatTicket,
    other: RandomChatTicket,
    shared_tags: list[str],
) -> RandomChatSession:
    """Turns a chosen pairing into a real conversation.

    Both tickets leave the pool here rather than at the route, so there is
    no window in which a matched person is still waiting and could be
    matched again.
    """
    low, high = sorted((one.user_id, other.user_id))

    existed = db.scalar(
        select(Conversation).where(
            Conversation.direct_key == Conversation.direct_key_for(low, high)
        )
    )
    conversation = get_or_create_direct(db, low, high)

    session = RandomChatSession(
        conversation_id=conversation.id,
        user_a_id=low,
        user_b_id=high,
        # Whether we made this thread or these two already had one. It
        # decides what may be cleared away afterwards: a conversation that
        # existed before is never touched, because their earlier history is
        # not ours to erase.
        created_conversation=existed is None,
        shared_tags=shared_tags,
        started_at=utcnow(),
    )
    db.add(session)
    one.active = False
    other.active = False
    db.flush()
    return session


def end_session(
    db: Session, session: RandomChatSession, *, ended_by_user_id: int | None
) -> None:
    """Closes a random conversation.

    Leaving does NOT take the thread away from the other person: they are
    told the other side left, and the conversation stays theirs until they
    close it themselves. Someone walking out mid-sentence should not also
    be able to delete the screen from under the person they walked out on.
    """
    if session.ended_at is not None:
        return
    session.ended_at = utcnow()
    session.ended_by_user_id = ended_by_user_id
    _settle_thread(db, session)


def follow_from_random_chat(
    db: Session, session: RandomChatSession, follower_id: int
) -> bool:
    """The follow button at the top of a random conversation.

    It is an ordinary follow request, not a special kind of bond — a
    shortcut to the button on somebody's profile, taken while you are
    still talking to them. So the normal rule holds: the other person
    decides, from their own profile, whether to accept.

    The one shortcut is mutual consent. If they had already asked to
    follow you, then both of you have now said yes to the same thing and
    there is nobody left to ask, so both requests are accepted at once —
    a follow and a follow-back in one move.

    Returns True when that happened, so the screen can say so.
    """
    followee_id = session.other_user_id(follower_id)

    mine = db.scalar(
        select(Follow).where(
            Follow.follower_id == follower_id, Follow.followee_id == followee_id
        )
    )
    if mine is None:
        mine = Follow(follower_id=follower_id, followee_id=followee_id)
        db.add(mine)
    elif mine.status == FollowStatus.REJECTED:
        # Same behaviour as asking again from the profile: the row is
        # reset rather than duplicated, and the earlier history stays.
        mine.status = FollowStatus.PENDING
        mine.requested_at = utcnow()
        mine.responded_at = None

    theirs = db.scalar(
        select(Follow).where(
            Follow.follower_id == followee_id, Follow.followee_id == follower_id
        )
    )
    if theirs is not None and theirs.status == FollowStatus.PENDING:
        now = utcnow()
        for follow in (mine, theirs):
            follow.status = FollowStatus.ACCEPTED
            follow.responded_at = now
        db.flush()
        return True

    db.flush()
    return False


def set_kept(db: Session, session: RandomChatSession, user_id: int, kept: bool) -> None:
    """Records one side wanting to keep the other.

    One-sided interest is never revealed to anybody, which is the whole
    point: not being kept is not a rejection anyone ever feels.
    """
    session.set_kept(user_id, kept)
    if session.ended_at is not None:
        _settle_thread(db, session)


def _settle_thread(db: Session, session: RandomChatSession) -> None:
    """Clears the transcript of a random conversation once it ends.

    **What is kept is the person, never the conversation.** The whole
    value of talking to a stranger is that people say things they would
    not say to somebody who will still be there tomorrow; a transcript
    that lasts forever makes everyone careful, and careful is the one
    thing this feature cannot afford. So both sides stop seeing it, and
    whoever wants to carry on follows the other and starts fresh.

    Nothing is destroyed — each side's own view is cleared, and the
    messages remain for any complaint about them.

    A thread these two already had is never touched: it existed before
    this meeting and their earlier history is not ours to clear.
    """
    if not session.created_conversation:
        return

    conversation = db.get(Conversation, session.conversation_id)
    if conversation is None:  # pragma: no cover - the FK makes this impossible
        return
    cleared_at: datetime = session.ended_at or utcnow()
    for participant in conversation.participants:
        participant.cleared_at = cleared_at
