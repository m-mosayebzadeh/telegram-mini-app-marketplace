"""
The sky: the people the world shows you.

This is the first version of the world's data
(TECHNICAL_REQUIREMENTS.md sections 26 and 28). It deliberately does NOT
use location, because location is not collected yet — and a world built
on invented coordinates would have to be thrown away when the real ones
arrive. What it uses instead is the thing we do have and that matters
most anyway: **who is here now, and who has been alive lately.**

When location and galaxies exist, only the ORDER changes. Everything the
app draws from this — the orb, its size, its glow, its ring — stays
exactly as it is.

Three numbers describe a person, and each one rides on a different visual
property so they can never be mistaken for one another (section 22):

  presence -> size   how alive they have been lately
  trust    -> glow   a history of conversations that ended well
  online   -> ring   here right now

**Money is absent on purpose.** Nothing here says whether somebody sells
anything, because the moment the sky shows that, it becomes a ranking of
people — the paid ones desirable, the free ones available — and this is a
product about meeting them (section 26).

A fourth thing rides on moons (section 29.14, the owner's decision):

  showcase -> moons   up to three: this person has something to show

Content and offers count alike, free and paid alike, so a moon never means
"this one sells" — only "there is more to see here".
"""

from datetime import timedelta

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.auth.dependencies import ONLINE_WITHIN, get_current_user
from app.core.database import get_db
from app.core.time import utcnow
from app.models.block import Block
from app.models.chat_message import ChatMessage
from app.models.chat_session import ChatSession, ChatSessionStatus
from app.models.profile import Profile
from app.models.user import User, UserStatus
from app.profile.photos import get_current_avatar_urls

router = APIRouter(prefix="/sky", tags=["sky"])

#: How many people one screen of sky holds.
#:
#: The device never receives more than this, however many people exist —
#: which is the whole reason the world can work at a million users. The
#: server decides who the nearest sixty are; the rest never travel.
SKY_PAGE = 60

#: How far back "lately" reaches when working out presence. Long enough
#: that a quiet couple of days does not erase somebody, short enough that
#: the sky is about now rather than about history.
PRESENCE_WINDOW = timedelta(days=14)

#: Days active within that window that count as fully present. Low on
#: purpose: the point is to tell "around" from "gone", not to rank the
#: devoted against the very devoted. A wide range would make a handful of
#: people tower over the sky and everyone else stop trying.
PRESENCE_FULL_DAYS = 6

#: Finished conversations that count as fully trusted. Also low: trust
#: should be reachable, or a newcomer looks at the sky and sees a wall.
TRUST_FULL_SESSIONS = 8

#: Somebody who joined this recently and has no history yet is drawn as
#: NEW rather than as dim — dim reads as "nobody wanted this person",
#: which is a judgement the sky has no business making about a stranger.
NEW_FOR = timedelta(days=7)


class SkyPersonOut(BaseModel):
    user_id: int
    display_name: str
    username: str | None
    #: Shown inside the orb. Sent from here rather than sliced in the app,
    #: because "the first letter" is not the same operation in every
    #: script and the server already knows the name.
    initial: str
    #: One line of their own words, for the card that opens when you tap
    #: them. Null when they have not written one.
    tagline: str | None
    #: Only loaded when somebody is actually looked at — the sky itself
    #: draws no photographs, which is what lets it open on a bad
    #: connection (section 26).
    avatar_url: str | None

    presence: float
    trust: float
    online: bool
    is_new: bool
    #: How many moons circle them, 0 to 3: things they have to show.
    moons: int = 0


@router.get("", response_model=list[SkyPersonOut])
def get_sky(
    limit: int = SKY_PAGE,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[SkyPersonOut]:
    """One screen of sky, nearest first.

    "Nearest" means here-now-and-lately for as long as the world has no
    geography. The client lays these out by their position in this list
    and never by any number in it, so the day this ordering becomes
    distance-based, nothing in the app changes.
    """
    now = utcnow()
    limit = max(1, min(limit, SKY_PAGE))

    hidden = _blocked_either_way(db, current_user.id)
    hidden.add(current_user.id)

    online_since = now - ONLINE_WITHIN
    presence_since = now - PRESENCE_WINDOW
    new_since = now - NEW_FOR

    # Days on which this person said something, counted per person in one
    # pass rather than per candidate — the alternative is a query inside a
    # loop, which is the shape that stops working at scale.
    presence_days = dict(
        db.execute(
            select(
                ChatMessage.sender_id,
                func.count(func.distinct(func.date(ChatMessage.created_at))),
            )
            .where(ChatMessage.created_at >= presence_since)
            .group_by(ChatMessage.sender_id)
        ).all()
    )

    finished = dict(
        db.execute(
            select(ChatSession.conversation_id, func.count(ChatSession.id))
            .where(ChatSession.status == ChatSessionStatus.CLOSED)
            .group_by(ChatSession.conversation_id)
        ).all()
    )
    trust_counts = _sessions_per_person(db, finished)

    candidates = db.scalars(
        select(User).where(
            User.status == UserStatus.ACTIVE,
            User.id.notin_(hidden) if hidden else True,
        )
    ).all()

    people = []
    for user in candidates:
        online = user.last_seen_at is not None and user.last_seen_at >= online_since
        presence = min(1.0, presence_days.get(user.id, 0) / PRESENCE_FULL_DAYS)
        trust = min(1.0, trust_counts.get(user.id, 0) / TRUST_FULL_SESSIONS)
        is_new = user.joined_at >= new_since and trust == 0
        people.append((user, online, presence, trust, is_new))

    # Here now first, then whoever has been most alive lately. Ties broken
    # by the newest account, so a fresh face is the one that surfaces
    # rather than whoever happens to have the lowest id.
    people.sort(
        key=lambda row: (row[1], row[2], row[0].joined_at),
        reverse=True,
    )
    people = people[:limit]

    profiles = {
        profile.user_id: profile
        for profile in db.scalars(
            select(Profile).where(Profile.user_id.in_([p[0].id for p in people]))
        )
    }
    avatars = get_current_avatar_urls(db, [p[0].id for p in people])
    moons = _showcase_counts(db, [p[0].id for p in people])

    return [
        SkyPersonOut(
            user_id=user.id,
            display_name=user.display_name,
            username=user.username,
            initial=user.display_name[:1],
            tagline=(profiles.get(user.id).bio if profiles.get(user.id) else None),
            avatar_url=avatars.get(user.id),
            presence=round(presence, 3),
            trust=round(trust, 3),
            online=online,
            is_new=is_new,
            moons=min(MAX_MOONS, moons.get(user.id, 0)),
        )
        for user, online, presence, trust, is_new in people
    ]


#: The most moons one person gets. More than three reads as clutter at the
#: size an orb is drawn, and turns "has something to show" into a count
#: to compete on.
MAX_MOONS = 3


def _showcase_counts(db: Session, user_ids: list[int]) -> dict[int, int]:
    """How many things each of these people has to show: public content
    that has not been deleted, and offers that are open.

    Only public content counts. A picture shared with one person or one
    group is not something the rest of the sky can see, and a moon that
    leads to nothing is a promise the app does not keep.

    Two grouped queries for the whole page of sky, never one per person.
    """
    if not user_ids:
        return {}
    from app.models.content import Content, ContentAudience
    from app.models.offer import Offer, OfferStatus

    counts: dict[int, int] = {}
    for owner, count in db.execute(
        select(Content.user_id, func.count(Content.id))
        .where(
            Content.user_id.in_(user_ids),
            Content.deleted_at.is_(None),
            Content.audience_type == ContentAudience.PUBLIC,
        )
        .group_by(Content.user_id)
    ).all():
        counts[owner] = counts.get(owner, 0) + count
    for owner, count in db.execute(
        select(Offer.provider_id, func.count(Offer.id))
        .where(Offer.provider_id.in_(user_ids), Offer.status == OfferStatus.ACTIVE)
        .group_by(Offer.provider_id)
    ).all():
        counts[owner] = counts.get(owner, 0) + count
    return counts


def _blocked_either_way(db: Session, user_id: int) -> set[int]:
    """Everyone this person must not see, and who must not see them.

    Both directions, even though a block is one-directional: a block that
    only worked one way would leave the blocked person still looking at
    somebody who wanted them gone.
    """
    rows = db.execute(
        select(Block.blocker_id, Block.blocked_id).where(
            or_(Block.blocker_id == user_id, Block.blocked_id == user_id)
        )
    ).all()
    return {blocker if blocked == user_id else blocked for blocker, blocked in rows}


def _sessions_per_person(db: Session, per_conversation: dict[int, int]) -> dict[int, int]:
    """Turns finished sessions per conversation into finished sessions per
    person, by looking up who was in each conversation."""
    if not per_conversation:
        return {}

    from app.models.conversation import ConversationParticipant

    counts: dict[int, int] = {}
    rows = db.execute(
        select(ConversationParticipant.conversation_id, ConversationParticipant.user_id).where(
            ConversationParticipant.conversation_id.in_(per_conversation.keys())
        )
    ).all()
    for conversation_id, user_id in rows:
        counts[user_id] = counts.get(user_id, 0) + per_conversation[conversation_id]
    return counts
