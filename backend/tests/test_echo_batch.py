"""
Pairing everybody waiting in Echo at once (app/random_chat/batch.py;
TECHNICAL_REQUIREMENTS.md section 32, "finding somebody for thousands").

What is defended: first come, first paired; the hard rules still hold; a
pass costs little even with a thousand people; small pools still match the
moment somebody joins; and two server processes running the pass at the
same instant can never put one person in two places. The last test is the
owner's: a thousand people joining Echo at the same time.
"""

import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import sessionmaker

from app.core.time import utcnow
from app.models.block import Block
from app.models.feature_schedule import FEATURE_RANDOM_CHAT, FeatureSchedule
from app.models.random_chat import WANT_ANYONE, EchoProposal, RandomChatTicket
from app.models.user import User
from app.random_chat import batch
from app.random_chat.batch import SMALL_POOL, plan_pairs, run_batch
from tests.helpers import sign_init_data


def _auth(telegram_id: int) -> dict:
    return {"X-Telegram-Init-Data": sign_init_data({"id": telegram_id, "first_name": "P"})}


def _ticket(user_id, *, minutes_ago=0.0, tags=None):
    return RandomChatTicket(
        user_id=user_id,
        wants_gender=WANT_ANYONE,
        tags=tags or [],
        gender=None,
        age=None,
        local_minute=600,
        joined_at=utcnow() - timedelta(minutes=minutes_ago),
        active=True,
    )


def _open_echo(db_session):
    schedule = db_session.query(FeatureSchedule).filter_by(feature=FEATURE_RANDOM_CHAT).one_or_none()
    if schedule is None:
        schedule = FeatureSchedule(feature=FEATURE_RANDOM_CHAT)
        db_session.add(schedule)
    schedule.enabled = True
    schedule.opens_at_minute = 0
    schedule.closes_at_minute = 1440
    db_session.commit()


def _people(db_session, count, first_telegram_id):
    """People who have been through Echo's door, made in one go."""
    users = [
        User(telegram_id=first_telegram_id + k, first_name=f"P{k}", adult_confirmed_at=utcnow())
        for k in range(count)
    ]
    db_session.add_all(users)
    db_session.commit()
    return users


def _open_proposals(db_session) -> list[tuple[int, int]]:
    return [
        (p.user_a_id, p.user_b_id)
        for p in db_session.scalars(select(EchoProposal).where(EchoProposal.outcome.is_(None)))
    ]


def _assert_nobody_twice(pairs):
    seen = [u for pair in pairs for u in pair]
    assert len(seen) == len(set(seen)), "somebody was put in front of two people"


# --- the plan, without a database ----------------------------------------


def test_the_one_who_came_first_is_paired_first():
    # Three people: whoever came first is never the one left waiting.
    first = _ticket(1, minutes_ago=5, tags=["music"])
    second = _ticket(2, minutes_ago=3)
    third = _ticket(3, minutes_ago=1, tags=["music"])
    pairs = plan_pairs([third, second, first], set(), set())
    assert len(pairs) == 1
    assert pairs[0].ticket.user_id == 1
    # Interests decide WHO: the first is put with the one sharing "music".
    assert pairs[0].other.user_id == 3


def test_interests_choose_who_never_when():
    # The first has an interest nobody shares; they are still paired first.
    first = _ticket(1, minutes_ago=5, tags=["chess"])
    others = [_ticket(n, minutes_ago=1, tags=["music"]) for n in (2, 3)]
    pairs = plan_pairs([first, *others], set(), set())
    assert 1 in {pairs[0].ticket.user_id, pairs[0].other.user_id}


def test_a_forbidden_pair_is_never_made_and_nobody_is_used_twice():
    tickets = [_ticket(n, minutes_ago=10 - n) for n in range(1, 5)]
    pairs = plan_pairs(tickets, {(1, 2)}, set())
    _assert_nobody_twice([(p.ticket.user_id, p.other.user_id) for p in pairs])
    assert all({p.ticket.user_id, p.other.user_id} != {1, 2} for p in pairs)
    assert len(pairs) == 2


def test_a_thousand_people_are_planned_in_well_under_a_second():
    tags = ["music", "film", "books", "games", "travel", "food"]
    tickets = [_ticket(n, minutes_ago=(n % 300) / 10, tags=[tags[n % 6]]) for n in range(1, 1001)]
    started = time.perf_counter()
    pairs = plan_pairs(tickets, set(), set())
    took = time.perf_counter() - started
    _assert_nobody_twice([(p.ticket.user_id, p.other.user_id) for p in pairs])
    assert len(pairs) == 500
    assert took < 1.0, f"planning a thousand took {took:.2f}s"


# --- with the database -----------------------------------------------------


def test_a_small_pool_still_matches_the_moment_somebody_joins(client, db_session):
    _open_echo(db_session)
    _people(db_session, 2, 70000)
    client.post("/random-chat/search", json={}, headers=_auth(70000))
    client.post("/random-chat/search", json={}, headers=_auth(70001))
    assert len(_open_proposals(db_session)) == 1


def test_a_big_pool_is_paired_by_the_pass_not_on_joining(client, db_session):
    _open_echo(db_session)
    users = _people(db_session, SMALL_POOL + 2, 71000)
    for user in users[:SMALL_POOL]:
        db_session.add(_ticket(user.id, minutes_ago=1))
    db_session.commit()
    # The pool is big: joining only waits.
    client.post("/random-chat/search", json={}, headers=_auth(71000 + SMALL_POOL))
    assert _open_proposals(db_session) == []
    paired = run_batch(db_session)
    assert paired == (SMALL_POOL + 1) // 2
    _assert_nobody_twice(_open_proposals(db_session))


def test_the_hard_rules_hold_in_the_pass(db_session):
    a, b = _people(db_session, 2, 72000)
    db_session.add_all([_ticket(a.id), _ticket(b.id), Block(blocker_id=a.id, blocked_id=b.id)])
    db_session.commit()
    assert run_batch(db_session) == 0


def test_the_pass_skips_its_turn_when_another_process_holds_the_lock(db_engine, db_session):
    a, b = _people(db_session, 2, 73000)
    db_session.add_all([_ticket(a.id), _ticket(b.id)])
    db_session.commit()
    other_process = sessionmaker(bind=db_engine)()
    try:
        assert batch.take_lock(other_process, wait=False)
        assert run_batch(db_session) == 0
    finally:
        other_process.rollback()
        other_process.close()
    # The next second, nobody holds it.
    assert run_batch(db_session) == 1


def test_a_thousand_people_joining_at_the_same_time(client, db_engine, db_session):
    """The owner's test: a thousand people press "find somebody" at once,
    while two server processes run the pass at the same moment. Everybody
    ends up in front of exactly one person, and nobody is used twice."""
    _open_echo(db_session)
    count = 1000
    _people(db_session, count, 80000)

    def join(k):
        return client.post("/random-chat/search", json={}, headers=_auth(80000 + k)).status_code

    started = time.perf_counter()
    with ThreadPoolExecutor(max_workers=32) as pool:
        codes = list(pool.map(join, range(count)))
    joined_in = time.perf_counter() - started
    assert codes.count(200) == count, {c: codes.count(c) for c in set(codes)}

    # Two processes run the pass at the same instant, a few seconds in a row.
    Session = sessionmaker(bind=db_engine)
    took: list[float] = []

    def process():
        for _ in range(3):
            with Session() as db:
                t = time.perf_counter()
                run_batch(db)
                took.append(time.perf_counter() - t)

    workers = [threading.Thread(target=process) for _ in range(2)]
    for w in workers:
        w.start()
    for w in workers:
        w.join()

    db_session.expire_all()
    pairs = _open_proposals(db_session)
    _assert_nobody_twice(pairs)
    assert len(pairs) == count // 2, f"{len(pairs)} pairs for {count} people"
    waiting = db_session.scalar(select(func.count(RandomChatTicket.id)).where(RandomChatTicket.active.is_(True)))
    assert waiting == count  # still searching, now held in a proposal each
    slowest = max(took)
    print(f"\n{count} joins in {joined_in:.1f}s; slowest pass {slowest:.2f}s")
    assert slowest < 1.0, f"a pass took {slowest:.2f}s"
