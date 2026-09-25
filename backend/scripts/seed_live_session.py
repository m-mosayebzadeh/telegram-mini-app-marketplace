"""
Dev-only: puts Sara in a live chat session, so the block bar and the
live-session bar can be looked at in the running app instead of reasoned
about.

    python scripts/seed_live_session.py            # 40 min, started 12 min ago
    python scripts/seed_live_session.py --waiting  # reserved, not started yet
    python scripts/seed_live_session.py --minutes 20 --elapsed 0

Sara (telegram_id 111222333) is the buyer, because the buyer is the side
with the more interesting screen: she sees the clock, the money, and the
"add a block" control. Bob is the provider. Both are the accounts
app/dev/router.py's /dev/test-init-data already mints, so logging in as
either from the dev login screen lands straight in this session.

Everything goes through the product's own code paths -- create the offer,
create the request, accept it, start the session, start the clock -- so
what ends up in the database is a real session and not a hand-written row
that happens to look like one. The one thing it fakes is TIME: started_at
is moved backwards afterwards, which is the only way to see a session
part-way through without waiting ten minutes for it.

Safe to re-run: it closes whatever live session these two already have
before opening a new one.
"""

import argparse
import sys
from datetime import timedelta
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from app.core.database import SessionLocal  # noqa: E402
from app.core.time import utcnow  # noqa: E402
from app.models.chat_message import ChatMessage, ChatMessageType  # noqa: E402
from app.models.chat_session import ChatSession, ChatSessionStatus  # noqa: E402
from app.models.offer import Offer, OfferStatus  # noqa: E402
from app.models.request import Request, RequestStatus  # noqa: E402
from app.models.user import User  # noqa: E402
from app.wallet import blocks  # noqa: E402
from app.wallet.service import credit_topup, get_balance_toman  # noqa: E402

BUYER_TELEGRAM_ID = 111222333  # Sara
PROVIDER_TELEGRAM_ID = 222222  # Bob

#: A short exchange, alternating sides, so both bubble styles and the
#: gap between them are actually visible. Kept plain text: the point is
#: to look at the conversation's shape, not at media handling.
DEMO_MESSAGES = [
    ('provider', 'سلام سارا، خوش اومدی 🙂'),
    ('buyer', 'سلام! ممنون'),
    ('buyer', 'راستش تازه سریال جدیدی رو شروع کردم و نمی‌دونم ادامه بدم یا نه'),
    ('provider', 'کدوم؟'),
    ('buyer', 'همونی که همه دربارش حرف می‌زنن'),
]

DEFAULT_MINUTES = 40
DEFAULT_PRICE_PHOTONS = 100
DEFAULT_ELAPSED_MINUTES = 12


def _user(db, telegram_id: int, first_name: str) -> User:
    user = db.query(User).filter(User.telegram_id == telegram_id).first()
    if user is None:
        raise SystemExit(
            f"No user with telegram_id={telegram_id}. Open the app and log in as "
            f"{first_name} once from the dev login screen, then re-run this."
        )
    return user


def _close_live_sessions(db, buyer_id: int, provider_id: int) -> int:
    """
    One live session per person is a real product rule, so a second run of
    this script would otherwise be refused by the app itself.
    """
    live = (
        db.query(ChatSession)
        .join(Request, ChatSession.request_id == Request.id)
        .join(Offer, Request.offer_id == Offer.id)
        .filter(
            ChatSession.status == ChatSessionStatus.OPEN,
            Request.buyer_id.in_([buyer_id, provider_id]),
        )
        .all()
    )
    for chat_session in live:
        blocks.close_and_settle(
            db,
            chat_session,
            reason=blocks.EndReason.BUYER_CLOSED,
            closed_by_user_id=buyer_id,
            at=utcnow(),
        )
    return len(live)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--minutes', type=int, default=DEFAULT_MINUTES,
                        help='session length in minutes (must split into whole blocks)')
    parser.add_argument('--price', type=int, default=DEFAULT_PRICE_PHOTONS,
                        help='session price in Photons (must split into whole blocks)')
    parser.add_argument('--elapsed', type=int, default=DEFAULT_ELAPSED_MINUTES,
                        help='how many minutes into the session to place it')
    parser.add_argument('--waiting', action='store_true',
                        help='leave it reserved and not started, to see the waiting state')
    args = parser.parse_args()

    db = SessionLocal()
    try:
        buyer = _user(db, BUYER_TELEGRAM_ID, 'Sara')
        provider = _user(db, PROVIDER_TELEGRAM_ID, 'Bob')

        closed = _close_live_sessions(db, buyer.id, provider.id)
        if closed:
            print(f'closed {closed} live session(s) from a previous run')

        # A session reserves its whole price up front, so the buyer has to
        # actually have the money.
        needed_toman = args.price * 1000
        balance = get_balance_toman(db, buyer.id)
        if balance < needed_toman:
            topped_up = needed_toman - balance + 500_000
            credit_topup(db, user_id=buyer.id, amount_toman=topped_up)
            print(f'topped Sara up by {topped_up:,} Toman so the session can be paid for')

        offer = Offer(
            provider_id=provider.id,
            price_photons=args.price,
            session_duration_seconds=args.minutes * 60,
            title='گپ درباره فیلم و سریال',
            description='یک گفتگوی راحت درباره‌ی فیلم‌ها و سریال‌هایی که این روزها دیده‌ایم.',
            status=OfferStatus.ACTIVE,
        )
        db.add(offer)
        db.flush()

        request = Request(offer_id=offer.id, buyer_id=buyer.id, status=RequestStatus.ACCEPTED)
        db.add(request)
        db.flush()

        chat_session = blocks.start_session(
            db, request_id=request.id, offer=offer, buyer_id=buyer.id
        )
        db.flush()

        if args.waiting:
            print('left reserved and NOT started — this is the waiting-to-start state')
        else:
            blocks.start_clock(db, chat_session)
            # The only fabricated part: rewind the start so the session is
            # already part-way through. Everything derived from it -- which
            # block is running, what is left, what has been consumed -- is
            # arithmetic over this one field.
            chat_session.started_at = utcnow() - timedelta(minutes=args.elapsed)
            if chat_session.scheduled_end_at is not None:
                chat_session.scheduled_end_at = chat_session.started_at + timedelta(
                    minutes=args.minutes
                )

        # A few messages, spread back through the elapsed time, so the
        # conversation has a shape to look at rather than one empty
        # screen with a bar on top.
        if not args.waiting and args.elapsed > 0:
            step = timedelta(minutes=args.elapsed / (len(DEMO_MESSAGES) + 1))
            for index, (side, text) in enumerate(DEMO_MESSAGES, start=1):
                db.add(
                    ChatMessage(
                        chat_session_id=chat_session.id,
                        sender_id=provider.id if side == 'provider' else buyer.id,
                        type=ChatMessageType.TEXT,
                        text=text,
                        created_at=chat_session.started_at + step * index,
                    )
                )
            print(f'added {len(DEMO_MESSAGES)} messages across the elapsed time')

        db.commit()

        block_minutes = args.minutes / chat_session.reserved_blocks
        print()
        print(f'session #{chat_session.id} — Sara (buyer) with Bob (provider)')
        print(f'  {args.minutes} minutes, {args.price} Photons')
        print(f'  {chat_session.reserved_blocks} blocks of {block_minutes:g} min, '
              f'{chat_session.block_price_photons} Photons each')
        if not args.waiting:
            print(f'  placed {args.elapsed} minutes in — '
                  f'block {int(args.elapsed // block_minutes) + 1} is running')
        print()
        print('Log in as Sara from the dev login screen to see it.')
    finally:
        db.close()


if __name__ == '__main__':
    main()
