"""
The account itself (TECHNICAL_REQUIREMENTS.md section 32, step 4): the
eighteen-or-over confirmation, the privacy settings, deleting the account,
and "report a problem".

Privacy defaults to the freest setting — anyone may message you and your
online is shown — and whoever wants it narrower narrows it (the owner's
rule).
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, or_, select, update
from sqlalchemy.orm import Session

from app.auth import sessions
from app.models.auth_session import AuthIdentity
from app.auth.dependencies import get_current_user, require_admin
from app.core.database import get_db
from app.core.time import utcnow
from app.models.block import Block
from app.models.feedback import MAX_FEEDBACK_TEXT, Feedback
from app.models.friendship import Friendship, FriendsListViewer
from app.friends.router import check_seen_by
from app.models.profile import CHAT_DOOR_OPEN, CHAT_DOORS, Profile
from app.models.profile_photo import ProfilePhoto
from app.models.random_chat import RandomChatTicket
from app.models.user import User, UserStatus
from app.random_chat import proposals

router = APIRouter(tags=["account"])
admin_router = APIRouter(prefix="/admin/feedback", tags=["admin"])

#: What a deleted account is called on the other side of its old
#: conversations. The app shows its own words for it (it knows the
#: account is deleted); this is what is stored.
DELETED_NAME = "Deleted account"


# --- eighteen or over ----------------------------------------------------


@router.post("/me/adult", status_code=status.HTTP_204_NO_CONTENT)
def confirm_adult(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """"I am eighteen or over", once. Asking again changes nothing."""
    if current_user.adult_confirmed_at is None:
        current_user.adult_confirmed_at = utcnow()
        db.commit()


#: The languages the app is shown in.
LANGUAGES = {"fa", "en"}


class LanguageIn(BaseModel):
    language: str


@router.put("/me/language", status_code=status.HTTP_204_NO_CONTENT)
def set_language(
    payload: LanguageIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """The language the app is shown in, so what the server writes to this
    person (Cosmos Team, notifications) is in it too. The app says it once
    when it differs, not on every start."""
    if payload.language not in LANGUAGES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail={"reason": "unknown_language"})
    if current_user.language != payload.language:
        current_user.language = payload.language
        db.commit()


# --- privacy ---------------------------------------------------------------


class PrivacyOut(BaseModel):
    #: "open" — anyone may start a conversation; "friends" — only friends.
    chat_door: str
    #: Not shown as online, and not shown anybody else's (core/presence.py).
    hide_online: bool
    #: Who may see your list of friends: everyone, friends, chosen, nobody.
    friends_seen_by: str = "everyone"


class PrivacyIn(BaseModel):
    chat_door: str = CHAT_DOOR_OPEN
    hide_online: bool = False
    friends_seen_by: str = "everyone"


def _profile_row(db: Session, user_id: int) -> Profile:
    profile = db.scalar(select(Profile).where(Profile.user_id == user_id))
    if profile is None:
        profile = Profile(user_id=user_id)
        db.add(profile)
        db.flush()
    return profile


@router.get("/me/privacy", response_model=PrivacyOut)
def read_privacy(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PrivacyOut:
    profile = db.scalar(select(Profile).where(Profile.user_id == current_user.id))
    if profile is None:
        return PrivacyOut(chat_door=CHAT_DOOR_OPEN, hide_online=False)
    return PrivacyOut(chat_door=profile.chat_door, hide_online=profile.hide_online, friends_seen_by=profile.friends_seen_by)


@router.put("/me/privacy", response_model=PrivacyOut)
def update_privacy(
    payload: PrivacyIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PrivacyOut:
    if payload.chat_door not in CHAT_DOORS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail={"reason": "unknown_door"})
    check_seen_by(payload.friends_seen_by)
    profile = _profile_row(db, current_user.id)
    was_hiding = profile.hide_online
    profile.chat_door = payload.chat_door
    profile.hide_online = payload.hide_online
    profile.friends_seen_by = payload.friends_seen_by
    db.commit()
    if was_hiding != payload.hide_online:
        # Hiding is, to everyone else, leaving; showing again is arriving:
        # the ring changes in the worlds that show this person at once
        # (section 43), instead of when each of them next opens the world.
        from app.auth.dependencies import is_online
        from app.live.hub import hub

        hub.presence(current_user.id, not payload.hide_online and is_online(current_user))
    return PrivacyOut(chat_door=profile.chat_door, hide_online=profile.hide_online, friends_seen_by=profile.friends_seen_by)


# --- deleting the account -----------------------------------------------


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(
    sure: bool = False,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Deletes this account.

    What goes: the profile and everything in it, the photos, follows both
    ways, blocks, and the place in Echo. The person leaves the world at
    once and nobody can find or message them.

    What stays: the user row, emptied and renamed, so the other side of
    their old conversations still reads as a conversation, and the
    messages themselves, so a complaint about them can still be looked
    into — the same rule as clearing a chat.

    Every device is signed out at once, and every door let go of: coming
    back through Google, a phone number or Telegram starts a new, empty
    account, with nothing of this one in it.

    `sure=true` is required, so nothing deletes an account by accident;
    the app asks twice before sending it.
    """
    if not sure:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail={"reason": "not_sure"})
    user_id = current_user.id

    # Out of Echo first: a card in front of somebody is declined, so they
    # go straight back to searching instead of waiting on a ghost.
    held = proposals.open_proposal_for(db, user_id)
    if held is not None:
        proposals.decline(db, held, user_id)
    db.execute(update(RandomChatTicket).where(RandomChatTicket.user_id == user_id).values(active=False))

    db.execute(delete(Friendship).where(or_(Friendship.user_low_id == user_id, Friendship.user_high_id == user_id)))
    db.execute(delete(FriendsListViewer).where(or_(FriendsListViewer.owner_id == user_id, FriendsListViewer.viewer_id == user_id)))
    db.execute(delete(Block).where(or_(Block.blocker_id == user_id, Block.blocked_id == user_id)))
    db.execute(delete(ProfilePhoto).where(ProfilePhoto.user_id == user_id))
    db.execute(delete(Profile).where(Profile.user_id == user_id))

    # Every door let go of, so the same Google account or phone number
    # starts a new, empty account next time rather than finding this one.
    db.execute(delete(AuthIdentity).where(AuthIdentity.user_id == user_id))

    current_user.status = UserStatus.DELETED
    current_user.deleted_at = utcnow()
    # The Telegram id is let go of too (ids are positive, so a negative one
    # never collides with a real person).
    if current_user.telegram_id is not None:
        current_user.telegram_id = -current_user.id
    current_user.first_name = DELETED_NAME
    current_user.last_name = None
    current_user.username = None
    db.commit()
    # Signed out everywhere at once, every device sent to the sign-in page.
    sessions.close_all_sessions(db, user_id)


# --- report a problem -----------------------------------------------------


class FeedbackIn(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_FEEDBACK_TEXT)
    where: str | None = Field(default=None, max_length=120)


@router.post("/feedback", status_code=status.HTTP_201_CREATED)
def send_feedback(
    payload: FeedbackIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    text = payload.text.strip()
    if not text:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail={"reason": "empty"})
    db.add(Feedback(user_id=current_user.id, text=text, where=payload.where))
    db.commit()
    return {"ok": True}


class FeedbackOut(BaseModel):
    id: int
    user_id: int
    display_name: str
    text: str
    where: str | None
    created_at: datetime


@admin_router.get("", response_model=list[FeedbackOut])
def list_feedback(
    _: User = Depends(require_admin("moderation.reports")),
    db: Session = Depends(get_db),
) -> list[FeedbackOut]:
    """The newest first; the last two hundred are plenty to read."""
    rows = db.execute(
        select(Feedback, User.first_name, User.last_name)
        .join(User, User.id == Feedback.user_id)
        .order_by(Feedback.created_at.desc())
        .limit(200)
    ).all()
    return [
        FeedbackOut(
            id=row.Feedback.id,
            user_id=row.Feedback.user_id,
            display_name=" ".join(part for part in (row.first_name, row.last_name) if part),
            text=row.Feedback.text,
            where=row.Feedback.where,
            created_at=row.Feedback.created_at,
        )
        for row in rows
    ]
