"""
Friends (section 32, step 4; the model is app/models/friendship.py).

Asking, accepting, saying no, unfriending, your requests, your friends,
and somebody else's friends — the ones you share first, marked, and the
rest only as far as their privacy setting allows.

Each change is announced live to the one person it concerns, so the app
never has to keep asking whether a request has arrived.
"""

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import and_, delete, distinct, func, or_, select
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.core.database import get_db
from app.core.time import utcnow
from app.live.hub import hub
from app.models.block import Block
from app.models.chat_message import ChatMessage
from app.models.conversation import CONVERSATION_DIRECT, Conversation, ConversationParticipant
from app.models.friendship import (
    FRIENDS_SEEN_BY,
    FRIENDS_SEEN_BY_CHOSEN,
    FRIENDS_SEEN_BY_EVERYONE,
    FRIENDS_SEEN_BY_FRIENDS,
    FRIENDSHIP_ACCEPTED,
    FRIENDSHIP_PENDING,
    Friendship,
    FriendsListViewer,
)
from app.models.profile import Profile
from app.models.user import User, UserStatus
from app.profile.note import fresh_note
from app.profile.photos import get_current_avatar_urls

router = APIRouter(prefix="/friends", tags=["friends"])
me_router = APIRouter(prefix="/me", tags=["friends"])
public_router = APIRouter(prefix="/profiles", tags=["friends"])


# --- reading the graph ----------------------------------------------------


def pair_of(one: int, other: int) -> tuple[int, int]:
    return (one, other) if one < other else (other, one)


def friendship_between(db: Session, one: int, other: int) -> Friendship | None:
    low, high = pair_of(one, other)
    return db.scalar(
        select(Friendship).where(Friendship.user_low_id == low, Friendship.user_high_id == high)
    )


def friend_ids(db: Session, user_id: int) -> set[int]:
    rows = db.execute(
        select(Friendship.user_low_id, Friendship.user_high_id).where(
            Friendship.status == FRIENDSHIP_ACCEPTED,
            or_(Friendship.user_low_id == user_id, Friendship.user_high_id == user_id),
        )
    ).all()
    return {high if low == user_id else low for low, high in rows}


def are_friends(db: Session, one: int, other: int) -> bool:
    row = friendship_between(db, one, other)
    return row is not None and row.status == FRIENDSHIP_ACCEPTED


def friend_status(db: Session, viewer_id: int, other_id: int) -> str:
    """"none", "requested" (you asked), "incoming" (they asked) or
    "friends" — what the button on their page says."""
    row = friendship_between(db, viewer_id, other_id)
    if row is None:
        return "none"
    if row.status == FRIENDSHIP_ACCEPTED:
        return "friends"
    return "requested" if row.requested_by_id == viewer_id else "incoming"


def _blocked_between(db: Session, one: int, other: int) -> bool:
    return db.scalar(
        select(Block.id).where(
            or_(
                and_(Block.blocker_id == one, Block.blocked_id == other),
                and_(Block.blocker_id == other, Block.blocked_id == one),
            )
        )
    ) is not None


class PersonOut(BaseModel):
    user_id: int
    display_name: str
    avatar_url: str | None
    #: Today's note, if they wrote one.
    note: str | None
    #: A friend of the viewer too: listed first and marked.
    mutual: bool = False


def _people(db: Session, ids: list[int], mutual: set[int] | None = None) -> list[PersonOut]:
    if not ids:
        return []
    users = {u.id: u for u in db.scalars(select(User).where(User.id.in_(ids), User.status == UserStatus.ACTIVE))}
    profiles = {p.user_id: p for p in db.scalars(select(Profile).where(Profile.user_id.in_(ids)))}
    avatars = get_current_avatar_urls(db, ids)
    now = utcnow()
    return [
        PersonOut(
            user_id=uid,
            display_name=users[uid].display_name,
            avatar_url=avatars.get(uid),
            note=fresh_note(profiles.get(uid), now=now),
            mutual=uid in (mutual or set()),
        )
        for uid in ids
        if uid in users
    ]


# --- asking, answering, ending -------------------------------------------


class FriendStatusOut(BaseModel):
    status: str


@router.post("/{user_id}", response_model=FriendStatusOut)
def ask(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FriendStatusOut:
    """Asks to be friends. If they had already asked you, this is a yes."""
    if user_id == current_user.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail={"reason": "yourself"})
    other = db.get(User, user_id)
    # A block is silent: it reads as nobody there.
    if other is None or other.status != UserStatus.ACTIVE or _blocked_between(db, current_user.id, user_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail={"reason": "unavailable"})

    row = friendship_between(db, current_user.id, user_id)
    if row is None:
        low, high = pair_of(current_user.id, user_id)
        db.add(Friendship(user_low_id=low, user_high_id=high, requested_by_id=current_user.id))
        db.commit()
        hub.publish([user_id], {"type": "friends"})
        return FriendStatusOut(status="requested")
    if row.status == FRIENDSHIP_PENDING and row.requested_by_id != current_user.id:
        return _accept(db, row, current_user.id)
    return FriendStatusOut(status=friend_status(db, current_user.id, user_id))


def _accept(db: Session, row: Friendship, by_user_id: int) -> FriendStatusOut:
    row.status = FRIENDSHIP_ACCEPTED
    row.accepted_at = utcnow()
    db.commit()
    hub.publish([row.requested_by_id], {"type": "friends"})
    return FriendStatusOut(status="friends")


@router.post("/{user_id}/accept", response_model=FriendStatusOut)
def accept(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FriendStatusOut:
    row = friendship_between(db, current_user.id, user_id)
    if row is None or row.status != FRIENDSHIP_PENDING or row.requested_by_id == current_user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail={"reason": "no_request"})
    return _accept(db, row, current_user.id)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def end(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Saying no, taking back a request, or unfriending: the row goes, and
    nobody is told. Harmless when there is nothing between you."""
    row = friendship_between(db, current_user.id, user_id)
    if row is not None:
        db.delete(row)
        db.commit()


# --- lists ----------------------------------------------------------------


@router.get("", response_model=list[PersonOut])
def my_friends(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[PersonOut]:
    ids = friend_ids(db, current_user.id)
    people = _people(db, list(ids))
    return sorted(people, key=lambda p: p.display_name.casefold())


@router.get("/requests", response_model=list[PersonOut])
def my_requests(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[PersonOut]:
    """Who asked you and is waiting, newest first."""
    rows = db.scalars(
        select(Friendship)
        .where(
            Friendship.status == FRIENDSHIP_PENDING,
            Friendship.requested_by_id != current_user.id,
            or_(Friendship.user_low_id == current_user.id, Friendship.user_high_id == current_user.id),
        )
        .order_by(Friendship.created_at.desc())
    ).all()
    return _people(db, [row.requested_by_id for row in rows])


#: How far back "this week" reaches.
THIS_WEEK = timedelta(days=7)

#: A handful of faces, never a list: it is a nudge, not a directory.
THIS_WEEK_LIMIT = 8


class WeekPersonOut(PersonOut):
    #: "none", "requested" or "incoming" — what their button says. Friends
    #: are never in this list.
    status: str


@router.get("/this-week", response_model=list[WeekPersonOut])
def this_week(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[WeekPersonOut]:
    """The people you really talked with this week and are not friends with
    yet (section 32, "me": the owner chose this for the empty half of the
    page). It is where an acquaintance becomes a friendship.

    "Really talked" means both of you wrote in the last seven days, not
    only one hello: somebody who never answered you is not offered back
    to you as a friend. Chats you deleted or left, and anybody blocked
    either way, are not here. Newest conversation first, a handful at most.

    One grouped query over this week's messages in your own conversations
    (messages are indexed by conversation), so its cost follows one
    person's week, never the size of the server.
    """
    since = utcnow() - THIS_WEEK
    mine = (
        select(ConversationParticipant.conversation_id)
        .join(Conversation, Conversation.id == ConversationParticipant.conversation_id)
        .where(
            ConversationParticipant.user_id == current_user.id,
            ConversationParticipant.left_at.is_(None),
            ConversationParticipant.hidden_at.is_(None),
            Conversation.kind == CONVERSATION_DIRECT,
        )
    )
    talked = (
        select(ChatMessage.conversation_id, func.max(ChatMessage.created_at).label("last_at"))
        .where(
            ChatMessage.conversation_id.in_(mine),
            ChatMessage.created_at >= since,
            ChatMessage.deleted_at.is_(None),
        )
        .group_by(ChatMessage.conversation_id)
        .having(func.count(distinct(ChatMessage.sender_id)) >= 2)
        .subquery()
    )
    rows = db.execute(
        select(ConversationParticipant.user_id, talked.c.last_at)
        .join(talked, talked.c.conversation_id == ConversationParticipant.conversation_id)
        .where(ConversationParticipant.user_id != current_user.id)
        .order_by(talked.c.last_at.desc())
    ).all()

    friends = friend_ids(db, current_user.id)
    blocked = set(
        db.scalars(select(Block.blocked_id).where(Block.blocker_id == current_user.id))
    ) | set(db.scalars(select(Block.blocker_id).where(Block.blocked_id == current_user.id)))
    ids: list[int] = []
    for user_id, _ in rows:
        if user_id in friends or user_id in blocked or user_id in ids:
            continue
        ids.append(user_id)
        if len(ids) == THIS_WEEK_LIMIT:
            break
    return [
        WeekPersonOut(**person.model_dump(), status=friend_status(db, current_user.id, person.user_id))
        for person in _people(db, ids)
    ]


def may_see_friends_of(db: Session, viewer_id: int, owner_id: int) -> bool:
    if viewer_id == owner_id:
        return True
    seen_by = db.scalar(select(Profile.friends_seen_by).where(Profile.user_id == owner_id)) or FRIENDS_SEEN_BY_EVERYONE
    if seen_by == FRIENDS_SEEN_BY_EVERYONE:
        return True
    if seen_by == FRIENDS_SEEN_BY_FRIENDS:
        return are_friends(db, viewer_id, owner_id)
    if seen_by == FRIENDS_SEEN_BY_CHOSEN:
        return db.scalar(
            select(FriendsListViewer.id).where(
                FriendsListViewer.owner_id == owner_id, FriendsListViewer.viewer_id == viewer_id
            )
        ) is not None
    return False


class TheirFriendsOut(BaseModel):
    #: False when their setting keeps the list from you; then `people` is
    #: empty — closed means closed, shared friends included (the owner's
    #: decision: whether two people are friends is theirs to show).
    visible: bool
    people: list[PersonOut]


@public_router.get("/{user_id}/friends", response_model=TheirFriendsOut)
def their_friends(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TheirFriendsOut:
    """Somebody's friends: the ones you share first, marked as shared, then
    the rest — when their setting allows you to see the list at all."""
    if not may_see_friends_of(db, current_user.id, user_id):
        return TheirFriendsOut(visible=False, people=[])
    visible = True
    theirs = friend_ids(db, user_id)
    mine = friend_ids(db, current_user.id) if user_id != current_user.id else set()
    shared = theirs & mine
    rest = theirs - shared - {current_user.id}
    by_name = lambda people: sorted(people, key=lambda p: p.display_name.casefold())  # noqa: E731
    return TheirFriendsOut(
        visible=visible,
        people=by_name(_people(db, list(shared), shared)) + by_name(_people(db, list(rest))),
    )


# --- who may see your list ------------------------------------------------


class FriendsViewersIn(BaseModel):
    user_ids: list[int]


@me_router.get("/friends-viewers", response_model=list[int])
def read_viewers(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[int]:
    return list(db.scalars(select(FriendsListViewer.viewer_id).where(FriendsListViewer.owner_id == current_user.id)))


@me_router.put("/friends-viewers", response_model=list[int])
def write_viewers(
    payload: FriendsViewersIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[int]:
    """The people chosen to see your list ("people I choose"). Only your
    friends can be chosen: the list is of them, and it is them you know."""
    allowed = friend_ids(db, current_user.id)
    chosen = [uid for uid in dict.fromkeys(payload.user_ids) if uid in allowed]
    db.execute(delete(FriendsListViewer).where(FriendsListViewer.owner_id == current_user.id))
    for uid in chosen:
        db.add(FriendsListViewer(owner_id=current_user.id, viewer_id=uid))
    db.commit()
    return chosen


def check_seen_by(value: str) -> None:
    if value not in FRIENDS_SEEN_BY:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail={"reason": "unknown_seen_by"})
