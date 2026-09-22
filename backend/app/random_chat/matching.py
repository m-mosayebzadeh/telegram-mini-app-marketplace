"""
Choosing who to put with whom.

The whole design rests on one rule from TECHNICAL_REQUIREMENTS.md section
28: **preferences rank, they do not filter.** With a small pool a hard
filter returns nobody, and an empty result is the worst possible answer —
it teaches people the feature is broken. So every preference is a weight,
somebody is always found, and when what arrives is not what was asked for
the app says so instead of pretending.

There are three hard rules. Two are about safety — two people who have
blocked each other are never put together, and a suspended account is not
in the pool at all — and the third is about what the feature is FOR: two
people who already talk to each other are never matched, because the
button says "meet someone new" and handing somebody their own friend
delivers none of that. Two friends who are both online do not message each
other and then bump into each other by accident; it reads as a mistake.

One more weight matters as much as the preferences: **how long somebody
has been waiting.** Without it, a person whose preferences are unpopular
waits forever while the easy matches keep pairing off in front of them.
"""

from dataclasses import dataclass

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.time import utcnow
from app.models.block import Block
from app.models.conversation import ConversationParticipant
from app.models.profile import GENDER_UNSAID
from app.models.random_chat import (
    WANT_ANYONE,
    RandomChatSession,
    RandomChatTicket,
)

# --- the weights -------------------------------------------------------
#
# Numbers rather than a formula spread through the code, so that tuning
# this later is editing five constants in one place. They are relative to
# each other and nothing else; the absolute scale means nothing.

#: Getting the gender someone asked for. The largest single weight,
#: because it is the preference people feel most strongly about.
SCORE_GENDER_MATCH = 100

#: Landing inside the age range they asked for.
SCORE_AGE_IN_RANGE = 60

#: Per shared interest tag. Small individually — tags are conversation
#: openers rather than requirements — but three of them add up to real
#: weight, which is right: two people who picked the same three things
#: have something to say to each other.
SCORE_PER_SHARED_TAG = 25

#: Being awake at the same odd hour. Deliberately modest: it is a nice
#: coincidence, not a preference anybody stated.
SCORE_SIMILAR_HOUR = 15
#: How close two local clocks have to be to count as "the same hour".
SIMILAR_HOUR_MINUTES = 90

#: Added per minute of waiting, to BOTH sides of a pairing. This is what
#: stops an unusual set of preferences from waiting forever: after ten
#: minutes a mediocre match outranks a perfect one that just arrived.
SCORE_PER_MINUTE_WAITING = 12

#: Taken off a pairing with somebody this person has already met through
#: random chat. NOT an exclusion: meeting them again is fine, since
#: nothing of that conversation was kept. It is a nudge, so that between
#: two equally good candidates the new face wins.
SCORE_MET_BEFORE_PENALTY = 80

#: Below this, two people are so badly matched that waiting a little
#: longer is genuinely better. Set low on purpose — almost everything
#: clears it — because a pool that refuses to pair is the failure mode we
#: are most afraid of.
MINIMUM_SCORE = 0


@dataclass(frozen=True)
class Pairing:
    """A proposed match, with enough detail to be honest about it."""

    ticket: RandomChatTicket
    other: RandomChatTicket
    score: int
    shared_tags: list[str]
    #: Whether each side actually got what they asked for. The screen uses
    #: these to say "this is not quite what you asked for" rather than
    #: quietly handing over a mismatch.
    gender_as_asked: bool
    age_as_asked: bool


def _wanted_gender_satisfied(ticket: RandomChatTicket, other: RandomChatTicket) -> bool:
    """Whether `other` is the kind of person `ticket` asked for.

    Someone who declined to state a gender only pairs with searches that
    said it does not matter — the rule that keeps "prefer not to say" from
    being a value nobody ever gets matched against.
    """
    if other.gender == GENDER_UNSAID:
        return ticket.wants_gender == WANT_ANYONE
    if ticket.wants_gender == WANT_ANYONE:
        return True
    return ticket.wants_gender == other.gender


def _age_satisfied(ticket: RandomChatTicket, other: RandomChatTicket) -> bool:
    if other.age is None:
        return False
    if ticket.wants_age_min is not None and other.age < ticket.wants_age_min:
        return False
    if ticket.wants_age_max is not None and other.age > ticket.wants_age_max:
        return False
    return True


def _minutes_waiting(ticket: RandomChatTicket, now) -> float:
    return max(0.0, (now - ticket.joined_at).total_seconds() / 60.0)


def score_pair(
    ticket: RandomChatTicket,
    other: RandomChatTicket,
    *,
    now=None,
    met_before: bool = False,
) -> Pairing:
    """How good a pairing these two would be, from both sides at once.

    Scored symmetrically on purpose. A match that delights one person and
    disappoints the other is a bad match: the disappointed one leaves, and
    then neither of them got a conversation.
    """
    now = now or utcnow()

    mine_gender = _wanted_gender_satisfied(ticket, other)
    theirs_gender = _wanted_gender_satisfied(other, ticket)
    mine_age = _age_satisfied(ticket, other)
    theirs_age = _age_satisfied(other, ticket)

    shared = [tag for tag in (ticket.tags or []) if tag in (other.tags or [])]

    score = 0
    score += SCORE_GENDER_MATCH * (int(mine_gender) + int(theirs_gender))
    score += SCORE_AGE_IN_RANGE * (int(mine_age) + int(theirs_age))
    score += SCORE_PER_SHARED_TAG * len(shared) * 2

    clock_gap = abs(ticket.local_minute - other.local_minute)
    clock_gap = min(clock_gap, 1440 - clock_gap)  # the day is a circle
    if clock_gap <= SIMILAR_HOUR_MINUTES:
        score += SCORE_SIMILAR_HOUR * 2

    if met_before:
        score -= SCORE_MET_BEFORE_PENALTY

    waited = _minutes_waiting(ticket, now) + _minutes_waiting(other, now)
    score += int(SCORE_PER_MINUTE_WAITING * waited)

    return Pairing(
        ticket=ticket,
        other=other,
        score=score,
        shared_tags=shared,
        gender_as_asked=mine_gender,
        age_as_asked=mine_age,
    )


def already_talking_user_ids(db: Session, user_id: int) -> set[int]:
    """Everyone this person already has a real conversation with.

    "Real" means a thread somebody can still see: it has messages, and at
    least one of the two has not cleared it away. That definition is what
    lets the rule be exactly as wide as it should be — an ordinary chat
    with a friend counts, while the thread from a past random meeting does
    not, because both sides of those are cleared when they end.
    """
    mine = db.scalars(
        select(ConversationParticipant).where(
            ConversationParticipant.user_id == user_id,
            ConversationParticipant.left_at.is_(None),
        )
    ).all()

    known: set[int] = set()
    for participant in mine:
        conversation = participant.conversation
        last = conversation.last_message_at
        if last is None:
            continue
        # Visible to either side. Checking both rather than only the
        # searcher's own view keeps it from being surprising for the other
        # person, who may still have the thread open in their list.
        if not any(other.sees_message_at(last) for other in conversation.participants):
            continue
        for other in conversation.participants:
            if other.user_id != user_id:
                known.add(other.user_id)
    return known


def met_before_user_ids(db: Session, user_id: int) -> set[int]:
    """Everyone this person has already been matched with at random."""
    rows = db.execute(
        select(RandomChatSession.user_a_id, RandomChatSession.user_b_id).where(
            (RandomChatSession.user_a_id == user_id)
            | (RandomChatSession.user_b_id == user_id)
        )
    ).all()
    return {a if b == user_id else b for a, b in rows}


def blocked_user_ids(db: Session, user_id: int) -> set[int]:
    """Everyone this person must never be matched with.

    Both directions, even though a block is one-directional: if A blocked
    B then B must not be put in front of A either, or the same person
    simply reappears from the other side.
    """
    rows = db.execute(
        select(Block.blocker_id, Block.blocked_id).where(
            or_(Block.blocker_id == user_id, Block.blocked_id == user_id)
        )
    ).all()
    return {blocker if blocked == user_id else blocked for blocker, blocked in rows}


def find_match(db: Session, ticket: RandomChatTicket, *, now=None) -> Pairing | None:
    """The best person currently waiting for this one, if there is any.

    Returns None when the pool holds nobody they may be matched with — an
    empty pool, or one containing only people they have blocked.
    """
    now = now or utcnow()
    forbidden = blocked_user_ids(db, ticket.user_id) | already_talking_user_ids(
        db, ticket.user_id
    )
    met_before = met_before_user_ids(db, ticket.user_id)

    candidates = db.scalars(
        select(RandomChatTicket).where(
            RandomChatTicket.user_id != ticket.user_id,
            # Only people waiting right now. An inactive row is somebody's
            # last search kept for next time, not somebody in the pool.
            RandomChatTicket.active.is_(True),
        )
    ).all()

    best: Pairing | None = None
    for other in candidates:
        if other.user_id in forbidden:
            continue
        pairing = score_pair(
            ticket, other, now=now, met_before=other.user_id in met_before
        )
        if pairing.score < MINIMUM_SCORE:
            continue
        # Ties go to whoever has been waiting longer — the same fairness
        # the waiting weight expresses, applied at the last step too.
        if best is None or (pairing.score, -other.joined_at.timestamp()) > (
            best.score,
            -best.other.joined_at.timestamp(),
        ):
            best = pairing
    return best
