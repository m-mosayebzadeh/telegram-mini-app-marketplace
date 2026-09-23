"""
Fill the world with people, so it can be looked at.

A sky with one account in it cannot be judged. Everything that gives the
world its shape — how sizes vary, whether a field of orbs reads as a
system or as wallpaper, whether trust and presence are legible without a
caption — is a question about a CROWD, and none of it can be answered
from a single dot.

Nothing here is invented at the display layer. The three numbers the sky
draws are computed by the real endpoint from real rows:

  presence -> distinct days this person sent a message, last 14 days
  trust    -> conversations with finished paid sessions behind them
  online   -> when they were last seen

so this script creates those rows rather than faking the outputs. What
shows up on screen is therefore what the real thing will look like when
real people have done these things.

Development only. Idempotent: run it as often as you like.

    python scripts/seed_world.py            # add/refresh the crowd
    python scripts/seed_world.py --clear    # remove them again
"""

from __future__ import annotations

import argparse
import random
import sys
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402

from app.core.database import SessionLocal  # noqa: E402
from app.core.time import utcnow  # noqa: E402
from app.models.chat_message import ChatMessage, ChatMessageType  # noqa: E402
from app.models.chat_session import ChatSession, ChatSessionStatus  # noqa: E402
from app.models.conversation import Conversation, ConversationParticipant  # noqa: E402
from app.models.offer import Offer  # noqa: E402
from app.models.profile import GENDER_FEMALE, GENDER_MALE, GENDER_UNSAID, Profile  # noqa: E402
from app.models.profile_photo import ProfilePhoto  # noqa: E402
from app.models.request import Request  # noqa: E402
from app.models.user import User  # noqa: E402

#: Seeded accounts are telegram ids in this range and nothing else is, so
#: --clear can find exactly what this script made and nothing a person
#: has been using.
FAKE_ID_BASE = 900_000_000

PEOPLE = [
    ("مهتاب", GENDER_FEMALE, "شب‌ها بیدارم و وسط حرف کسی نمی‌پرم."),
    ("آرش", GENDER_MALE, "کوه، شکست، و اینکه هیچ‌کدام آن‌قدر بزرگ نیستند."),
    ("نگار", GENDER_FEMALE, "فقط گوش می‌دهم. اگر لازم شد حرف می‌زنم."),
    ("کیان", GENDER_MALE, "از چیزهایی می‌پرسم که کسی نمی‌پرسد."),
    ("سوگند", GENDER_FEMALE, "قهوه، کتاب، و سکوتِ ساعت سه."),
    ("نوید", GENDER_MALE, "هر چیزی جز نصیحت."),
    ("بهار", GENDER_FEMALE, "آدمِ حرف‌های نصفه‌کاره‌ام."),
    ("سامان", GENDER_MALE, "می‌خندم، ولی نه به همه‌چیز."),
    ("یلدا", GENDER_FEMALE, "دیر می‌خوابم و زود پشیمان می‌شوم."),
    ("هومن", GENDER_MALE, "درباره‌ی موسیقی می‌شود ساعت‌ها حرف زد."),
    ("شبنم", GENDER_FEMALE, "تازه آمده‌ام. هنوز نمی‌دانم اینجا چه خبر است."),
    ("کاوه", GENDER_MALE, "سفر رفتن از رسیدن بهتر است."),
    ("ترانه", GENDER_FEMALE, "شعر می‌خوانم، بلند."),
    ("بردیا", GENDER_UNSAID, "اسمم مهم نیست."),
    ("نازنین", GENDER_FEMALE, "از سکوت نمی‌ترسم."),
    ("فرهاد", GENDER_MALE, "کار، و بعدش هیچی."),
    ("آیدا", GENDER_FEMALE, "عکس می‌گیرم از چیزهای بی‌اهمیت."),
    ("سپهر", GENDER_MALE, "شطرنج، و باختن‌های طولانی."),
    ("مینا", GENDER_FEMALE, "هر شب یک فیلم، هر هفته یک پشیمانی."),
    ("رامین", GENDER_UNSAID, "بیشتر گوش می‌دهم."),
    ("شیوا", GENDER_FEMALE, "حیوان‌ها را به آدم‌ها ترجیح می‌دهم، بعضی روزها."),
    ("بابک", GENDER_MALE, "استارتاپ ساختم، خوابید. دوباره می‌سازم."),
    ("دریا", GENDER_FEMALE, "شنا، و فکر نکردن."),
    ("کسری", GENDER_MALE, "زبان یاد می‌گیرم تا با آدم‌های بیشتری حرف بزنم."),
    ("هستی", GENDER_FEMALE, "نقاشی می‌کشم و نشان نمی‌دهم."),
    ("امید", GENDER_MALE, "همین که اسمم است کافی است."),
    ("ژاله", GENDER_FEMALE, "از صبح‌ها بدم می‌آید."),
    ("پویا", GENDER_MALE, "درس می‌خوانم، ظاهراً."),
]


def seed(db, rng: random.Random) -> None:
    now = utcnow()
    me = db.scalars(select(User).where(User.telegram_id < FAKE_ID_BASE)).first()

    made = 0
    for index, (name, gender, bio) in enumerate(PEOPLE):
        telegram_id = FAKE_ID_BASE + index
        user = db.scalars(select(User).where(User.telegram_id == telegram_id)).first()
        if user is None:
            user = User(telegram_id=telegram_id, first_name=name)
            db.add(user)
            db.flush()
            made += 1

        user.first_name = name

        # A spread of arrival dates, because "new" is one of the three
        # things the sky says and it needs somebody to say it about.
        user.joined_at = now - timedelta(days=rng.choice([1, 2, 4, 9, 20, 60, 140, 300]))

        # Online is simply "seen recently". A third of them, so the green
        # ring means something by being uncommon.
        user.last_seen_at = now - timedelta(
            minutes=rng.choice([1, 3, 9, 40, 300, 1500, 4000])
        )

        profile = db.scalars(select(Profile).where(Profile.user_id == user.id)).first()
        if profile is None:
            profile = Profile(user_id=user.id)
            db.add(profile)
        profile.bio = bio
        profile.gender = gender
        profile.birthday_year = rng.randint(1975, 2006)
        profile.birthday_month = rng.randint(1, 12)
        profile.birthday_day = rng.randint(1, 28)

        # A stand-in portrait, served by the frontend from its own public
        # folder. These are FACES, and they have to be: the abstract shapes
        # that were here first could not answer the only question the sky
        # asks of a photograph — whether you can tell who somebody is at
        # sixty pixels while the camera is moving. A pattern always reads;
        # a face is the hard case, so a face is what gets tested.
        #
        # They are stock portraits of no one in particular, kept as files
        # in the repository so development needs no network. Development
        # data only: nothing here ships.
        #
        # Set rather than inserted-if-missing, so changing what a portrait
        # is does not need the whole crowd deleted first.
        photo = db.scalars(
            select(ProfilePhoto).where(ProfilePhoto.user_id == user.id)
        ).first()
        if photo is None:
            db.add(ProfilePhoto(user_id=user.id, url=f"/seed/p{index:02d}.jpg"))
        else:
            photo.url = f"/seed/p{index:02d}.jpg"

    db.flush()

    if me is None:
        print("no real account yet — open the app once, then run this again")
        db.commit()
        return

    fakes = db.scalars(select(User).where(User.telegram_id >= FAKE_ID_BASE)).all()

    for user in fakes:
        conversation = _conversation_between(db, me.id, user.id)

        # PRESENCE: distinct days with a message, within the last
        # fortnight. Spread wide on purpose — the sky is meant to show
        # the difference between somebody around and somebody gone, and
        # it cannot if everyone is the same.
        wanted_days = rng.choice([0, 0, 1, 2, 3, 4, 6, 6, 8])
        existing = db.scalars(
            select(ChatMessage).where(ChatMessage.conversation_id == conversation.id)
        ).all()
        for message in existing:
            db.delete(message)
        db.flush()

        for day in range(wanted_days):
            db.add(
                ChatMessage(
                    conversation_id=conversation.id,
                    sender_id=user.id,
                    type=ChatMessageType.TEXT,
                    text="سلام",
                    created_at=now - timedelta(days=day, hours=rng.randint(0, 20)),
                )
            )

        # TRUST: finished paid sessions. The chain is real — an offer, a
        # request against it, a session that closed — because the sky
        # counts sessions and a shortcut here would be a number that does
        # not exist anywhere else.
        wanted_sessions = rng.choice([0, 0, 0, 1, 2, 4, 6, 8])
        have = db.scalars(
            select(ChatSession).where(ChatSession.conversation_id == conversation.id)
        ).all()
        for extra in have[wanted_sessions:]:
            db.delete(extra)
        for _ in range(wanted_sessions - len(have)):
            offer = Offer(
                provider_id=user.id,
                # Must divide into four equal blocks — the offer table
                # enforces it, because a session is priced per block.
                price_drops=rng.choice([60, 80, 100, 160]),
                session_duration_seconds=1800,
                title="گفتگو",
                description="گفتگوی آزمایشی",
            )
            db.add(offer)
            db.flush()
            request = Request(buyer_id=me.id, offer_id=offer.id)
            db.add(request)
            db.flush()
            db.add(
                ChatSession(
                    request_id=request.id,
                    conversation_id=conversation.id,
                    status=ChatSessionStatus.CLOSED,
                )
            )

    db.commit()
    print(f"{len(fakes)} people in the world ({made} new)")


def _conversation_between(db, a: int, b: int) -> Conversation:
    """The thread these two share, made if it is not there yet.

    Looked up by the direct key rather than by walking participants: the
    key is what the database's uniqueness rule is built on, so using
    anything else to find a thread is how a second one gets created.
    """
    key = Conversation.direct_key_for(a, b)
    found = db.scalars(select(Conversation).where(Conversation.direct_key == key)).first()
    if found is not None:
        return found

    conversation = Conversation(direct_key=key)
    db.add(conversation)
    db.flush()
    db.add(ConversationParticipant(conversation_id=conversation.id, user_id=a))
    db.add(ConversationParticipant(conversation_id=conversation.id, user_id=b))
    db.flush()
    return conversation


def clear(db) -> None:
    fakes = db.scalars(select(User).where(User.telegram_id >= FAKE_ID_BASE)).all()
    ids = [user.id for user in fakes]
    if not ids:
        print("nothing to remove")
        return

    convs = db.scalars(
        select(ConversationParticipant.conversation_id).where(
            ConversationParticipant.user_id.in_(ids)
        )
    ).all()
    for model in (ChatSession, ChatMessage):
        for row in db.scalars(select(model).where(model.conversation_id.in_(convs))).all():
            db.delete(row)
    db.flush()
    for row in db.scalars(
        select(ConversationParticipant).where(
            ConversationParticipant.conversation_id.in_(convs)
        )
    ).all():
        db.delete(row)
    db.flush()
    for row in db.scalars(select(Request).where(Request.buyer_id.notin_([]))).all():
        if row.offer and row.offer.provider_id in ids:
            db.delete(row)
    db.flush()
    for row in db.scalars(select(Offer).where(Offer.provider_id.in_(ids))).all():
        db.delete(row)
    for conversation_id in convs:
        conversation = db.get(Conversation, conversation_id)
        if conversation is not None:
            db.delete(conversation)
    for row in db.scalars(select(ProfilePhoto).where(ProfilePhoto.user_id.in_(ids))).all():
        db.delete(row)
    for row in db.scalars(select(Profile).where(Profile.user_id.in_(ids))).all():
        db.delete(row)
    db.flush()
    for user in fakes:
        db.delete(user)
    db.commit()
    print(f"removed {len(fakes)} people")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--clear", action="store_true", help="remove the seeded people")
    parser.add_argument("--seed", type=int, default=7, help="so the world is the same each run")
    args = parser.parse_args()

    session = SessionLocal()
    try:
        if args.clear:
            clear(session)
        else:
            seed(session, random.Random(args.seed))
    finally:
        session.close()
