"""
"Settings -> ways in" (TECHNICAL_REQUIREMENTS.md section 36): which ways
in this account has, and changing them from inside the account.

A person may come in through Google and through Telegram, one account of
each. From inside the account they can connect either, swap it for
another, or take it away — under three rules the owner approved:

1. The last way in cannot be taken away, or nobody could come in again.
2. Every change needs a fresh confirmation, through one of the ways in
   connected right now (sessions.is_confirmed): having the session — a
   phone left open — is not enough to swap the ways in and keep the
   account. Signing in through Google or Telegram counts as confirming;
   being let in by another phone does not.
3. Every change is told to the owner through our Telegram bot, so a change
   they did not make does not go unnoticed.

Connecting goes through the way itself — off to Google and back
(app/auth/router.py), or through the bot (app/auth/telegram_router.py) —
so a way in is only ever connected by whoever really holds it. This module
holds the list, taking a way away, and telling the owner.
"""


from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth import google, sessions, telegram_bot
from app.auth.dependencies import current_session_id, get_current_user
from app.core import team
from app.core.config import settings
from app.core.database import get_db
from app.models.auth_session import PROVIDER_GOOGLE, PROVIDER_TELEGRAM, AuthSession
from app.models.user import User

router = APIRouter(prefix="/auth/doors", tags=["auth"])

#: The ways in a person manages here. Development sign-in is not one.
MANAGED = (PROVIDER_GOOGLE, PROVIDER_TELEGRAM)


def telegram_ready() -> bool:
    return bool(settings.telegram_bot_token and settings.telegram_bot_username)


def tell_owner(
    db: Session,
    later: BackgroundTasks,
    user: User,
    event: str,
    label: str | None = None,
    also_telegram_id: int | None = None,
) -> None:
    """Rule 3: tells the owner, through our bot, that a way in changed — at
    the Telegram account connected now, and at `also_telegram_id` (the one
    just taken away or replaced, which may be the real owner's). Sent after
    the answer (`later`), so a slow Telegram slows nothing.

    Also in the app, from Cosmos Team (section 37): somebody with no
    Telegram connected — only Google — is told too."""
    try:
        team.door_changed(db, user, event, label)
    except Exception:  # noqa: BLE001 — the change is made; a lost note must not undo it
        db.rollback()
    if not settings.telegram_bot_token:
        return
    to = {int(d.subject) for d in sessions.doors_of(db, user.id) if d.provider == PROVIDER_TELEGRAM and d.subject.lstrip("-").isdigit()}
    if also_telegram_id is not None:
        to.add(also_telegram_id)
    text = telegram_bot.door_changed(event, label)
    for chat_id in to:
        later.add_task(telegram_bot.say, chat_id, text)


class DoorOut(BaseModel):
    provider: str
    #: How it is shown: the Google address half hidden, the Telegram @name.
    label: str | None


class DoorsOut(BaseModel):
    doors: list[DoorOut]
    #: This session may change the ways in right now (rule 2).
    confirmed: bool
    #: Which ways can be connected on this server at all.
    google: bool
    telegram: bool


def _this_session(request: Request, db: Session) -> AuthSession | None:
    session_id = current_session_id(request)
    return db.get(AuthSession, session_id) if session_id is not None else None


@router.get("", response_model=DoorsOut)
def my_doors(request: Request, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> DoorsOut:
    """My ways in, and whether this session may change them now."""
    return DoorsOut(
        doors=[DoorOut(provider=d.provider, label=d.label) for d in sessions.doors_of(db, current_user.id) if d.provider in MANAGED],
        confirmed=sessions.is_confirmed(_this_session(request, db)),
        google=google.ready(),
        telegram=telegram_ready(),
    )


@router.delete("/{provider}", status_code=status.HTTP_204_NO_CONTENT)
def take_door_away(
    provider: str,
    request: Request,
    later: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Takes one way in away from this account (rules 1, 2 and 3)."""
    if provider not in MANAGED:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if not sessions.is_confirmed(_this_session(request, db)):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail={"reason": "confirm_first"})
    mine = [d for d in sessions.doors_of(db, current_user.id) if d.provider in MANAGED]
    going = [d for d in mine if d.provider == provider]
    if not going:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if len(going) == len(mine):
        raise HTTPException(status.HTTP_409_CONFLICT, detail={"reason": "last_way"})
    old_telegram = None
    for door in going:
        if provider == PROVIDER_TELEGRAM and door.subject.lstrip("-").isdigit():
            old_telegram = int(door.subject)
        db.delete(door)
    if provider == PROVIDER_TELEGRAM:
        # The account no longer answers to that Telegram account: the next
        # sign-in through it makes a new account (dependencies.user_from_telegram).
        current_user.telegram_id = None
    db.commit()
    tell_owner(db, later, current_user, f"{provider}_removed", also_telegram_id=old_telegram)
