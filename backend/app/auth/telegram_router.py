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

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response, status
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.auth import sessions, telegram_bot
from app.auth.dependencies import user_from_telegram
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
from app.models.auth_session import PROVIDER_TELEGRAM, BotSignInRequest

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
    state = _status(row)
    if state != "approved":
        raise HTTPException(status.HTTP_409_CONFLICT, detail={"reason": state})
    row.claimed_at = utcnow()
    db.commit()
    user = user_from_telegram(
        db,
        TelegramUser(id=row.telegram_id, first_name=row.first_name or "", last_name=row.last_name, username=row.username),
    )
    _sign_in(db, response, user, PROVIDER_TELEGRAM, user_agent)


# --- what Telegram sends us ---------------------------------------------------


@router.post("/telegram/webhook", status_code=status.HTTP_204_NO_CONTENT)
def telegram_webhook(
    update: dict,
    db: Session = Depends(get_db),
    secret: str | None = Header(None, alias="X-Telegram-Bot-Api-Secret-Token"),
) -> None:
    """Every message and button tap the bot receives. Anything that is not
    from Telegram — without the secret — is refused; anything else is
    answered with 204 whatever it was, or Telegram would keep resending it."""
    expected = settings.telegram_webhook_secret
    if not expected or not secret or not secrets.compare_digest(secret, expected):
        raise HTTPException(status.HTTP_403_FORBIDDEN)
    if "callback_query" in update:
        _button_tapped(db, update["callback_query"])
    elif "message" in update:
        _message(db, update["message"])


def _live_request(db: Session, code: str) -> BotSignInRequest | None:
    row = db.scalar(select(BotSignInRequest).where(BotSignInRequest.code == code))
    return row if _status(row) == "pending" else None


def _message(db: Session, message: dict) -> None:
    sender = message.get("from") or {}
    chat_id = (message.get("chat") or {}).get("id")
    text = (message.get("text") or "").strip()
    if not chat_id or sender.get("is_bot") or not sender.get("id"):
        return
    said = telegram_bot.words(sender.get("language_code"))
    command, _, code = text.partition(" ")
    if command != "/start" or not code:
        telegram_bot.say(chat_id, said["hello"])
        return
    row = _live_request(db, code.strip())
    if row is None or (row.telegram_id is not None and row.telegram_id != sender["id"]):
        # Run out, used, or already opened by somebody else.
        telegram_bot.say(chat_id, said["expired"])
        return
    row.seen_at = row.seen_at or utcnow()
    row.telegram_id = sender["id"]
    row.first_name = (sender.get("first_name") or "")[:64] or None
    row.last_name = (sender.get("last_name") or "")[:64] or None
    row.username = (sender.get("username") or "")[:64] or None
    db.commit()
    hub.device_request_changed(row.code)  # the page: "now confirm in Telegram"
    device = row.device if row.device not in ("", "?") else said["unknown"]
    telegram_bot.ask(chat_id, said["ask"].format(device=device), said["yes"], said["no"], row.code)


def _button_tapped(db: Session, tap: dict) -> None:
    sender = tap.get("from") or {}
    message = tap.get("message") or {}
    chat_id = (message.get("chat") or {}).get("id")
    said = telegram_bot.words(sender.get("language_code"))
    choice, _, code = (tap.get("data") or "").partition(":")
    row = _live_request(db, code)
    # Only the account that tapped Start may answer for it.
    if row is None or row.telegram_id != sender.get("id"):
        telegram_bot.answer_button(tap.get("id", ""), chat_id, message.get("message_id"), said["expired"])
        return
    if choice == "ok":
        row.approved_at = utcnow()
        outcome = said["signed_in"]
    else:
        row.refused_at = utcnow()
        outcome = said["refused"]
    db.commit()
    hub.device_request_changed(row.code)
    telegram_bot.answer_button(tap.get("id", ""), chat_id, message.get("message_id"), outcome)
