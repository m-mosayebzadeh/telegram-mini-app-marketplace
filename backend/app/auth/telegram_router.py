"""
Signing in through our Telegram bot (TECHNICAL_REQUIREMENTS.md section 32).

1. The sign-in page asks for a request (start) and shows the bot link —
   a button, and a picture to scan for somebody on a computer — then waits
   (wait, the same held-open wait as "another phone").
2. In Telegram the person taps Start: the bot gets "/start <code>"
   (webhook), notes who they are, and asks, naming the device, whether it
   is really them. The page hears that and says "now confirm in Telegram".
3. "Yes" — from that same Telegram account — approves the request; the
   page wakes, collects its session with the secret only it holds (claim),
   and comes in. The first time a new account is made, pre-filled with the
   Telegram name; somebody who came from Telegram before gets their own
   account back.

Telegram reaches us only through the webhook, which must carry the secret
we gave Telegram (scripts/set_telegram_webhook.py). Nothing here asks
Telegram anything on a clock.
"""


import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Request, Response, status
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.auth import doors, sessions, telegram_bot
from app.auth.dependencies import current_session_id, get_current_user, user_from_telegram
from app.auth.router import (
    DeviceSecretIn,
    DeviceWaitIn,
    _own_request,
    _sign_in,
    _status,
    _where_from,
    too_many_tries,
    wait_for_news,
)
from app.auth.telegram import TelegramUser
from app.core.attempts import Attempts
from app.core.config import settings
from app.core.database import get_db, open_db
from app.core.time import utcnow
from app.live.hub import hub
from app.models.auth_session import (
    PROVIDER_TELEGRAM,
    PURPOSE_CONFIRM,
    PURPOSE_LINK,
    PURPOSE_SIGN_IN,
    AuthSession,
    BotSignInRequest,
)
from app.models.user import User

router = APIRouter(tags=["auth"])

#: Long enough to open Telegram, tap Start and answer (longer than another
#: phone's two minutes: switching apps takes a moment).
BOT_REQUEST_LIFETIME = timedelta(minutes=5)

#: Lighter than text messages, which cost money (the owner's decision):
#: twenty sign-ins through the bot in ten minutes from one place.
bot_starts = Attempts(limit=20, window_seconds=600)


def ready() -> bool:
    """The Telegram button appears only when the bot is set up."""
    return bool(settings.telegram_bot_token and settings.telegram_bot_username)


class BotStartOut(BaseModel):
    code: str
    #: Only the asking page has this; it collects the session with it.
    secret: str
    expires_at: datetime
    #: Opens our bot with the code, in the app or on the web.
    link: str


@router.post("/auth/telegram/start", response_model=BotStartOut)
def start_bot_sign_in(
    request: Request, db: Session = Depends(get_db), user_agent: str | None = Header(None)
) -> BotStartOut:
    if not ready():
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail={"reason": "telegram_off"})
    if not bot_starts.allow(_where_from(request)):
        raise too_many_tries()
    return _new_request(db, user_agent, PURPOSE_SIGN_IN, None)


def _new_request(db: Session, user_agent: str | None, purpose: str, user_id: int | None) -> BotStartOut:
    """A request through the bot, for signing in or — from inside an
    account — for confirming or connecting (section 36)."""
    now = utcnow()
    # Old requests go as new ones come, so the table never grows.
    db.execute(delete(BotSignInRequest).where(BotSignInRequest.expires_at < now - timedelta(hours=1)))
    secret = secrets.token_urlsafe(24)
    # 16 random bytes: unguessable, and within Telegram's 64 characters.
    code = secrets.token_urlsafe(16)
    row = BotSignInRequest(
        code=code,
        secret_hash=sessions.hash_token(secret),
        device=sessions.device_name(user_agent)[:80],
        created_at=now,
        expires_at=now + BOT_REQUEST_LIFETIME,
        purpose=purpose,
        user_id=user_id,
    )
    db.add(row)
    db.commit()
    return BotStartOut(
        code=code,
        secret=secret,
        expires_at=row.expires_at,
        link=f"https://t.me/{settings.telegram_bot_username}?start={code}",
    )


@router.post("/auth/telegram/wait")
async def wait_for_telegram(payload: DeviceWaitIn, db: Session = Depends(open_db)) -> dict:
    """The page waits here for the bot (see app/auth/router.py, wait_for_news)."""
    return await wait_for_news(db, payload, BotSignInRequest)


@router.post("/auth/telegram/claim", status_code=status.HTTP_204_NO_CONTENT)
def claim_bot_session(
    payload: DeviceSecretIn,
    response: Response,
    db: Session = Depends(get_db),
    user_agent: str | None = Header(None),
) -> None:
    """The page collects its session, once, after "yes" in Telegram."""
    row = _own_request(db, payload, BotSignInRequest)
    if row is not None and row.purpose != PURPOSE_SIGN_IN:
        # A "yes" to connecting a Telegram account to somebody's account is
        # not a "yes" to signing in to the Telegram owner's own account.
        row = None
    state = _status(row)
    if state != "approved":
        raise HTTPException(status.HTTP_409_CONFLICT, detail={"reason": state})
    row.claimed_at = utcnow()
    db.commit()
    user = user_from_telegram(
        db,
        TelegramUser(id=row.telegram_id, first_name=row.first_name or "", last_name=row.last_name, username=row.username),
    )
    sessions.remember_door(db, user, PROVIDER_TELEGRAM, str(row.telegram_id), _label(row))
    _sign_in(db, response, user, PROVIDER_TELEGRAM, user_agent)


def _label(row: BotSignInRequest) -> str | None:
    """How a Telegram account is shown in "Settings -> ways in"."""
    if row.username:
        return f"@{row.username}"
    return " ".join(part for part in (row.first_name, row.last_name) if part) or None


def _telegram_owner(db: Session, telegram_id: int) -> User | None:
    """Whose way in this Telegram account is, if anybody's."""
    owner = sessions.user_for_door(db, PROVIDER_TELEGRAM, str(telegram_id))
    return owner or db.scalar(select(User).where(User.telegram_id == telegram_id))


def _telegram_door(db: Session, user_id: int) -> int | None:
    for door in sessions.doors_of(db, user_id):
        if door.provider == PROVIDER_TELEGRAM and door.subject.lstrip("-").isdigit():
            return int(door.subject)
    return None


# --- from inside the account: confirming, and connecting (section 36) ---------


class DoorStartIn(BaseModel):
    #: PURPOSE_CONFIRM or PURPOSE_LINK.
    purpose: str


@router.post("/auth/doors/telegram/start", response_model=BotStartOut)
def start_door_request(
    payload: DoorStartIn,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    user_agent: str | None = Header(None),
) -> BotStartOut:
    """From "Settings -> ways in": the bot link to confirm it is the owner
    with the Telegram account already connected, or to connect one."""
    if not ready():
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail={"reason": "telegram_off"})
    if payload.purpose not in (PURPOSE_CONFIRM, PURPOSE_LINK):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY)
    if payload.purpose == PURPOSE_CONFIRM and _telegram_door(db, current_user.id) is None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail={"reason": "no_telegram"})
    if not bot_starts.allow(_where_from(request)):
        raise too_many_tries()
    return _new_request(db, user_agent, payload.purpose, current_user.id)


@router.post("/auth/doors/telegram/claim")
def claim_door_request(
    payload: DeviceSecretIn,
    request: Request,
    later: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """After "yes" in Telegram: this session is confirmed, or the Telegram
    account is connected (rule 2: only right after confirming)."""
    row = _own_request(db, payload, BotSignInRequest)
    if row is not None and (row.purpose == PURPOSE_SIGN_IN or row.user_id != current_user.id):
        row = None
    state = _status(row)
    if state != "approved":
        raise HTTPException(status.HTTP_409_CONFLICT, detail={"reason": (row.problem if row is not None else None) or state})
    row.claimed_at = utcnow()
    db.commit()
    session_id = current_session_id(request)
    session = db.get(AuthSession, session_id) if session_id is not None else None
    if row.purpose == PURPOSE_CONFIRM:
        if _telegram_door(db, current_user.id) != row.telegram_id:
            raise HTTPException(status.HTTP_409_CONFLICT, detail={"reason": "not_yours"})
        session.confirmed_at = utcnow()
        db.commit()
        return {"done": "confirmed"}
    if not sessions.is_confirmed(session):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail={"reason": "confirm_first"})
    owner = _telegram_owner(db, row.telegram_id)
    if owner is not None and owner.id != current_user.id:
        raise HTTPException(status.HTTP_409_CONFLICT, detail={"reason": "taken"})
    old = _telegram_door(db, current_user.id)
    sessions.replace_door(db, current_user, PROVIDER_TELEGRAM, str(row.telegram_id), _label(row))
    # Kept in step with the door: signing in through the bot finds people by it.
    current_user.telegram_id = row.telegram_id
    db.commit()
    if old != row.telegram_id:
        doors.tell_owner(db, later, current_user, "telegram_linked", _label(row), also_telegram_id=old)
    return {"done": "linked"}


# --- what Telegram sends us ---------------------------------------------------


@router.post("/telegram/webhook", status_code=status.HTTP_204_NO_CONTENT)
def telegram_webhook(
    update: dict,
    later: BackgroundTasks,
    db: Session = Depends(get_db),
    secret: str | None = Header(None, alias="X-Telegram-Bot-Api-Secret-Token"),
) -> None:
    """Every message and button tap the bot receives. Anything that is not
    from Telegram — without the secret — is refused; anything else is
    answered with 204 whatever it was, or Telegram would keep resending it.

    What the bot says back is sent `later`: after this answer has gone and
    the database place has been given back. Telegram can take seconds to
    reply, and holding one of the few database places all that time is how
    a slow Telegram would slow down the whole app."""
    expected = settings.telegram_webhook_secret
    if not expected or not secret or not secrets.compare_digest(secret, expected):
        raise HTTPException(status.HTTP_403_FORBIDDEN)
    if "callback_query" in update:
        _button_tapped(db, later, update["callback_query"])
    elif "message" in update:
        _message(db, later, update["message"])


def _live_request(db: Session, code: str) -> BotSignInRequest | None:
    row = db.scalar(select(BotSignInRequest).where(BotSignInRequest.code == code))
    return row if _status(row) == "pending" else None


def _message(db: Session, later: BackgroundTasks, message: dict) -> None:
    sender = message.get("from") or {}
    chat_id = (message.get("chat") or {}).get("id")
    text = (message.get("text") or "").strip()
    if not chat_id or sender.get("is_bot") or not sender.get("id"):
        return
    said = telegram_bot.words(sender.get("language_code"))
    command, _, code = text.partition(" ")
    if command != "/start" or not code:
        later.add_task(telegram_bot.say, chat_id, said["hello"])
        return
    row = _live_request(db, code.strip())
    if row is None or (row.telegram_id is not None and row.telegram_id != sender["id"]):
        # Run out, used, or already opened by somebody else.
        later.add_task(telegram_bot.say, chat_id, said["expired"])
        return
    if row.purpose != PURPOSE_SIGN_IN:
        _start_from_inside(db, later, row, sender, chat_id, said)
        return
    row.seen_at = row.seen_at or utcnow()
    row.telegram_id = sender["id"]
    row.first_name = (sender.get("first_name") or "")[:64] or None
    row.last_name = (sender.get("last_name") or "")[:64] or None
    row.username = (sender.get("username") or "")[:64] or None
    db.commit()
    hub.device_request_changed(row.code)  # the page: "now confirm in Telegram"
    device = row.device if row.device not in ("", "?") else said["unknown"]
    later.add_task(telegram_bot.ask, chat_id, said["ask"].format(device=device), said["yes"], said["no"], row.code)


def _start_from_inside(db: Session, later: BackgroundTasks, row: BotSignInRequest, sender: dict, chat_id: int, said: dict) -> None:
    """Start tapped on a request made from inside an account: to confirm,
    it must be that account's own Telegram; to connect, it must not be
    another account's. Otherwise the bot says why and the page hears it."""
    problem = None
    if row.purpose == PURPOSE_CONFIRM and _telegram_door(db, row.user_id) != sender["id"]:
        problem = "not_yours"
    elif row.purpose == PURPOSE_LINK:
        owner = _telegram_owner(db, sender["id"])
        if owner is not None and owner.id != row.user_id:
            problem = "taken"
    row.seen_at = row.seen_at or utcnow()
    row.telegram_id = sender["id"]
    row.first_name = (sender.get("first_name") or "")[:64] or None
    row.last_name = (sender.get("last_name") or "")[:64] or None
    row.username = (sender.get("username") or "")[:64] or None
    if problem:
        row.refused_at = utcnow()
        row.problem = problem
    db.commit()
    hub.device_request_changed(row.code)
    if problem:
        later.add_task(telegram_bot.say, chat_id, said[problem])
        return
    if row.purpose == PURPOSE_CONFIRM:
        question = said["ask_confirm"]
    else:
        account = db.get(User, row.user_id)
        question = said["ask_link"].format(name=account.first_name if account else "")
    later.add_task(telegram_bot.ask, chat_id, question, said["yes"], said["no"], row.code)


def _button_tapped(db: Session, later: BackgroundTasks, tap: dict) -> None:
    sender = tap.get("from") or {}
    message = tap.get("message") or {}
    chat_id = (message.get("chat") or {}).get("id")
    said = telegram_bot.words(sender.get("language_code"))
    choice, _, code = (tap.get("data") or "").partition(":")
    row = _live_request(db, code)
    # Only the account that tapped Start may answer for it.
    if row is None or row.telegram_id != sender.get("id"):
        later.add_task(telegram_bot.answer_button, tap.get("id", ""), chat_id, message.get("message_id"), said["expired"])
        return
    if choice == "ok":
        row.approved_at = utcnow()
        outcome = said[{PURPOSE_CONFIRM: "confirmed", PURPOSE_LINK: "linked"}.get(row.purpose, "signed_in")]
    else:
        row.refused_at = utcnow()
        outcome = said["refused"]
    db.commit()
    hub.device_request_changed(row.code)
    later.add_task(telegram_bot.answer_button, tap.get("id", ""), chat_id, message.get("message_id"), outcome)
