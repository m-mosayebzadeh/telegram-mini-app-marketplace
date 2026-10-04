"""
Pairing everybody waiting in Echo at once, once a second
(TECHNICAL_REQUIREMENTS.md section 32, "finding somebody for thousands").

Matching one person as they join (matching.find_match) reads the whole pool
for every arrival: perfect for ten people, slow for ten thousand. So above a
small pool, joining only puts you in the pool, and this pass pairs everybody
together within a second:

- **First come, first paired.** Everybody waiting is taken in the order
  they joined. Interests decide WHO somebody is put with, never WHEN: the
  person who came first is always looked after first.
- **A window, not the whole pool.** For each person only a bounded set of
  candidates is scored — the longest waiting, and those sharing an
  interest — so the cost of a pass follows how many people are waiting,
  not how many there are times how many there are.
- **One database round for the rules.** Blocks, people who already talk,
  people met before and today's "no"s are read once for everybody waiting,
  not once per person.
- **No leader.** Every server process runs this every second, and whichever
  takes the database lock for that second does the pass; the others skip
  it. If that process goes down, another takes the lock the next second.
  The same lock is taken by the one-at-a-time path, so the two can never
  put one person in two places.

The weights and the hard rules are the ones in matching.py, unchanged.
"""

from __future__ import annotations

from collections import defaultdict

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session, selectinload

from app.core.time import start_of_utc_day, utcnow
from app.live.events import announce_echo
from app.models.block import Block
from app.models.conversation import Conversation, ConversationParticipant
from app.models.random_chat import (
    PROPOSAL_DECLINED,
    EchoProposal,
    RandomChatSession,
    RandomChatTicket,
)
from app.random_chat.matching import MINIMUM_SCORE, Pairing, score_pair

#: Below this many people waiting, each person is matched the moment they
#: join (the owner: nobody should wait even a second for no reason).
SMALL_POOL = 50

#: How many of the longest waiting each person is scored against.
OLDEST_WINDOW = 60

#: How many people sharing an interest each person is scored against.
SHARED_WINDOW = 60

#: The lock every matcher takes, in every process. Any fixed number works;
#: this one only has to be the same everywhere and used for nothing else.
MATCH_LOCK = 0x4543484F  # "ECHO"


def take_lock(db: Session, *, wait: bool) -> bool:
    """The matching lock, held until this transaction ends. `wait=False`
    gives up at once if another process holds it."""
    if wait:
        db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": MATCH_LOCK})
        return True
    return bool(db.scalar(text("SELECT pg_try_advisory_xact_lock(:key)"), {"key": MATCH_LOCK}))


def waiting_count(db: Session) -> int:
    return db.scalar(select(func.count(RandomChatTicket.id)).where(RandomChatTicket.active.is_(True))) or 0


def _pair(a: int, b: int) -> tuple[int, int]:
    return (a, b) if a < b else (b, a)


def _forbidden_pairs(db: Session, ids: list[int]) -> tuple[set[tuple[int, int]], set[tuple[int, int]]]:
    """Every pair among these people that must never be matched (blocked,
    already talking, said no today), and every pair that met before (a
    penalty, not a rule). Read once for everybody."""
    forbidden: set[tuple[int, int]] = set()
    met: set[tuple[int, int]] = set()
    if len(ids) < 2:
        return forbidden, met

    for a, b in db.execute(
        select(Block.blocker_id, Block.blocked_id).where(Block.blocker_id.in_(ids), Block.blocked_id.in_(ids))
    ):
        forbidden.add(_pair(a, b))

    for a, b in db.execute(
        select(EchoProposal.user_a_id, EchoProposal.user_b_id).where(
            EchoProposal.outcome == PROPOSAL_DECLINED,
            EchoProposal.decided_at >= start_of_utc_day(),
            EchoProposal.user_a_id.in_(ids),
            EchoProposal.user_b_id.in_(ids),
        )
    ):
        forbidden.add(_pair(a, b))

    for a, b in db.execute(
        select(RandomChatSession.user_a_id, RandomChatSession.user_b_id).where(
            RandomChatSession.user_a_id.in_(ids), RandomChatSession.user_b_id.in_(ids)
        )
    ):
        met.add(_pair(a, b))

    # Already talking: the same rule as matching.already_talking_user_ids,
    # only for the conversations where two waiting people meet.
    members: dict[int, list[int]] = defaultdict(list)
    for conversation_id, user_id in db.execute(
        select(ConversationParticipant.conversation_id, ConversationParticipant.user_id).where(
            ConversationParticipant.user_id.in_(ids), ConversationParticipant.left_at.is_(None)
        )
    ):
        members[conversation_id].append(user_id)
    shared = [cid for cid, users in members.items() if len(users) >= 2]
    if shared:
        conversations = db.scalars(
            select(Conversation)
            .where(Conversation.id.in_(shared), Conversation.last_message_at.is_not(None))
            .options(selectinload(Conversation.participants))
        ).all()
        for conversation in conversations:
            last = conversation.last_message_at
            if not any(p.sees_message_at(last) for p in conversation.participants):
                continue
            users = members[conversation.id]
            for i, a in enumerate(users):
                for b in users[i + 1:]:
                    forbidden.add(_pair(a, b))
    return forbidden, met


def plan_pairs(
    tickets: list[RandomChatTicket],
    forbidden: set[tuple[int, int]],
    met: set[tuple[int, int]],
    *,
    now=None,
) -> list[Pairing]:
    """Who goes with whom, oldest first. Pure: no database, so it can be
    measured and tested on thousands of people directly."""
    now = now or utcnow()
    order = sorted(tickets, key=lambda t: (t.joined_at, t.user_id))
    by_tag: dict[str, list[RandomChatTicket]] = defaultdict(list)
    for ticket in order:
        for tag in ticket.tags or []:
            by_tag[tag].append(ticket)

    taken: set[int] = set()
    pairings: list[Pairing] = []
    oldest_cursor = 0
    for ticket in order:
        if ticket.user_id in taken:
            continue
        taken.add(ticket.user_id)

        # The longest waiting who are still free…
        candidates: dict[int, RandomChatTicket] = {}
        while oldest_cursor < len(order) and order[oldest_cursor].user_id in taken:
            oldest_cursor += 1
        i = oldest_cursor
        while i < len(order) and len(candidates) < OLDEST_WINDOW:
            other = order[i]
            if other.user_id not in taken:
                candidates[other.user_id] = other
            i += 1
        # …and the people who share an interest.
        for tag in ticket.tags or []:
            found = 0
            for other in by_tag[tag]:
                if found >= SHARED_WINDOW:
                    break
                if other.user_id not in taken and other.user_id not in candidates:
                    candidates[other.user_id] = other
                    found += 1

        best: Pairing | None = None
        for other in candidates.values():
            pair = _pair(ticket.user_id, other.user_id)
            if pair in forbidden:
                continue
            pairing = score_pair(ticket, other, now=now, met_before=pair in met)
            if pairing.score < MINIMUM_SCORE:
                continue
            if best is None or (pairing.score, -other.joined_at.timestamp()) > (
                best.score,
                -best.other.joined_at.timestamp(),
            ):
                best = pairing
        if best is None:
            # Nobody suitable right now: free again for somebody later in
            # the line, and first in line next second.
            taken.discard(ticket.user_id)
            continue
        taken.add(best.other.user_id)
        pairings.append(best)
    return pairings


def run_batch(db: Session) -> int:
    """One pass: pairs everybody waiting who can be paired. Returns how many
    pairs were put in front of each other (0 when another process holds
    the lock this second). Commits."""
    # Imported here: proposals imports this module for the size check.
    from app.random_chat import proposals

    if not take_lock(db, wait=False):
        db.rollback()
        return 0
    proposals.sweep_due(db)
    busy = proposals.busy_user_ids(db)
    tickets = [
        t
        for t in db.scalars(select(RandomChatTicket).where(RandomChatTicket.active.is_(True))).all()
        if t.user_id not in busy
    ]
    if len(tickets) < 2:
        db.commit()
        return 0
    forbidden, met = _forbidden_pairs(db, [t.user_id for t in tickets])
    pairings = plan_pairs(tickets, forbidden, met)
    seconds = proposals._seconds(db)
    # Read before the commit: afterwards every ticket would be fetched
    # again, one query each, just to learn an id.
    told = [u for p in pairings for u in (p.ticket.user_id, p.other.user_id)]
    for pairing in pairings:
        proposals.make_proposal(db, pairing, seconds=seconds, announce=False)
    db.commit()
    # Told after the commit, so a phone that asks at once finds its card.
    if told:
        announce_echo(told)
    return len(pairings)

