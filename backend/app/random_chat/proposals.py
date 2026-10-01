"""
Echo proposals: two people held for each other while both decide.

The owner's design (TECHNICAL_REQUIREMENTS.md section 32). When the matcher
finds two waiting people it does not start anything: it holds them for
each other for a few seconds (the panel's `proposal_seconds`, 30 unless
changed) and both see a small card. Then:

- **both say "start"** — the conversation is made, exactly as a match was
  made before;
- **either says "no"** — both go quietly back to searching, and those two
  are not put in front of each other again that day. Neither is ever told
  which of them said no;
- **the time runs out** — whoever did not answer is plainly not looking at
  the screen, so their search ends (otherwise every newcomer would wait out
  the full time on somebody who has closed the app); whoever did answer
  goes back to searching.

Like every other deadline in this app nothing ticks: a proposal is settled
the moment anybody looks and finds it past its time (`sweep_due`).

Whenever people go back to searching, the matcher runs for them at once,
because matching otherwise only happens when somebody new joins — and the
next person may already be waiting.
"""

from datetime import timedelta

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.time import start_of_utc_day, utcnow
from app.live.events import announce_echo
from app.models.random_chat import (
    DEFAULT_PROPOSAL_SECONDS,
    PROPOSAL_DECLINED,
    PROPOSAL_EXPIRED,
    PROPOSAL_STARTED,
    EchoProposal,
    RandomChatTicket,
)
from app.random_chat.matching import find_match
from app.random_chat.service import schedule_for, start_session, ticket_for


def open_proposal_for(db: Session, user_id: int) -> EchoProposal | None:
    """The proposal this person is being held in right now, if any."""
    return db.scalar(
        select(EchoProposal).where(
            EchoProposal.outcome.is_(None),
            or_(EchoProposal.user_a_id == user_id, EchoProposal.user_b_id == user_id),
        )
    )


def busy_user_ids(db: Session) -> set[int]:
    """Everyone held in an open proposal. They are still searching, but
    nobody else may be put in front of them until it is settled."""
    rows = db.execute(
        select(EchoProposal.user_a_id, EchoProposal.user_b_id).where(
            EchoProposal.outcome.is_(None)
        )
    ).all()
    return {user_id for pair in rows for user_id in pair}


def declined_today_ids(db: Session, user_id: int) -> set[int]:
    """Everyone this person and somebody said no between today, in either
    direction. Only an explicit "no" counts — running out of time is not a
    judgement about anybody."""
    rows = db.execute(
        select(EchoProposal.user_a_id, EchoProposal.user_b_id).where(
            EchoProposal.outcome == PROPOSAL_DECLINED,
            EchoProposal.decided_at >= start_of_utc_day(),
            or_(EchoProposal.user_a_id == user_id, EchoProposal.user_b_id == user_id),
        )
    ).all()
    return {a if b == user_id else b for a, b in rows}


def _seconds(db: Session) -> int:
    seconds = getattr(schedule_for(db), "proposal_seconds", None)
    return seconds if seconds else DEFAULT_PROPOSAL_SECONDS


def try_match(db: Session, ticket: RandomChatTicket) -> EchoProposal | None:
    """Put this waiting person in front of the best person waiting, if
    there is one. Returns the new proposal, or None."""
    if not ticket.active or open_proposal_for(db, ticket.user_id) is not None:
        return None
    pairing = find_match(
        db,
        ticket,
        exclude=busy_user_ids(db) | declined_today_ids(db, ticket.user_id),
    )
    if pairing is None:
        return None
    low, high = sorted((pairing.ticket.user_id, pairing.other.user_id))
    now = utcnow()
    proposal = EchoProposal(
        user_a_id=low,
        user_b_id=high,
        shared_tags=pairing.shared_tags,
        shared_groups=pairing.shared_groups,
        created_at=now,
        expires_at=now + timedelta(seconds=_seconds(db)),
        accepted_by_a=False,
        accepted_by_b=False,
    )
    db.add(proposal)
    db.flush()
    announce_echo([low, high])
    return proposal


def _back_to_searching(db: Session, user_ids: list[int]) -> None:
    """These people are free again: look for somebody for each of them."""
    for user_id in user_ids:
        ticket = ticket_for(db, user_id)
        if ticket is not None:
            try_match(db, ticket)


def _settle(db: Session, proposal: EchoProposal, outcome: str) -> None:
    proposal.outcome = outcome
    proposal.decided_at = utcnow()
    announce_echo([proposal.user_a_id, proposal.user_b_id])


def accept(db: Session, proposal: EchoProposal, user_id: int) -> None:
    """One side says "start". When both have, the conversation is made."""
    if proposal.outcome is not None:
        return
    proposal.accept(user_id)
    if not proposal.accepted_by_both:
        # The other side learns nothing from this on its card; the nudge
        # only lets both screens stay in step.
        announce_echo([proposal.user_a_id, proposal.user_b_id])
        return
    one = ticket_for(db, proposal.user_a_id, active_only=False)
    other = ticket_for(db, proposal.user_b_id, active_only=False)
    session = start_session(db, one=one, other=other, shared_tags=proposal.shared_tags or [])
    proposal.session_id = session.id
    _settle(db, proposal, PROPOSAL_STARTED)


def decline(db: Session, proposal: EchoProposal, user_id: int) -> None:
    """One side says no. Both go back to searching, and both look for
    somebody else at once; neither is told who said it."""
    if proposal.outcome is not None:
        return
    proposal.declined_by_user_id = user_id
    _settle(db, proposal, PROPOSAL_DECLINED)
    db.flush()
    _back_to_searching(db, [proposal.user_a_id, proposal.user_b_id])


def expire(db: Session, proposal: EchoProposal) -> None:
    """The time ran out. Whoever did not answer is not looking at the
    screen, so their search ends; whoever did answer searches on."""
    _settle(db, proposal, PROPOSAL_EXPIRED)
    still_here: list[int] = []
    for user_id in (proposal.user_a_id, proposal.user_b_id):
        if proposal.accepted_by(user_id):
            still_here.append(user_id)
            continue
        ticket = ticket_for(db, user_id)
        if ticket is not None:
            ticket.active = False
    db.flush()
    _back_to_searching(db, still_here)


def sweep_due(db: Session) -> None:
    """Settle every proposal whose time has run out. Called wherever Echo
    is read or joined, which is all it takes for nothing to need a clock."""
    due = db.scalars(
        select(EchoProposal).where(
            EchoProposal.outcome.is_(None), EchoProposal.expires_at <= utcnow()
        )
    ).all()
    for proposal in due:
        expire(db, proposal)

