"""
Sessions, from the person's side (TECHNICAL_REQUIREMENTS.md section 32):
which devices are signed in, closing one or all the others, and signing
out. The ways in (Google, a phone number, Telegram through our bot, another
phone) each add one route here that ends by calling `_sign_in`.
"""

import asyncio
import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response, status
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.auth import google, sessions
from app.auth.dependencies import current_session_id, get_current_user
from app.core.database import get_db, open_db
from app.core.time import utcnow
from app.models.auth_session import PROVIDER_DEVICE, PROVIDER_GOOGLE, AuthSession, DeviceSignInRequest
from app.models.user import User

router = APIRouter(prefix="/auth", tags=["auth"])


def _sign_in(db: Session, response: Response, user: User, provider: str, user_agent: str | None) -> None:
    """The one ending every way in shares: a new session, in the cookie."""
    token = sessions.start_session(db, user, provider=provider, user_agent=user_agent)
    sessions.set_cookie(response, token)


class SessionOut(BaseModel):
    id: int
    provider: str
    device: str
    created_at: datetime
    last_used_at: datetime
    #: The session this very request came with.
    current: bool


@router.get("/sessions", response_model=list[SessionOut])
def my_sessions(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[SessionOut]:
    """Every open session of mine, this device first, then the most
    recently used."""
    now = sessions.utcnow()
    mine = current_session_id(request)
    rows = db.scalars(
        select(AuthSession)
        .where(AuthSession.user_id == current_user.id, AuthSession.revoked_at.is_(None))
        .order_by(AuthSession.last_used_at.desc())
    ).all()
    out = [
        SessionOut(
            id=r.id,
            provider=r.provider,
            device=r.device,
            created_at=r.created_at,
            last_used_at=r.last_used_at,
            current=r.id == mine,
        )
        for r in rows
        if now - r.last_used_at <= sessions.lifetime()
    ]
    return sorted(out, key=lambda s: not s.current)


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def close_one(
    session_id: int,
    request: Request,
    response: Response,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Closes one of my sessions. Closing this device's own signs it out."""
    row = db.get(AuthSession, session_id)
    if row is None or row.user_id != current_user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    sessions.close_session(db, row)
    if row.id == current_session_id(request):
        sessions.clear_cookie(response)


@router.post("/sessions/close-others")
def close_others(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Signs out every device but this one."""
    closed = sessions.close_other_sessions(db, current_user.id, keep_id=current_session_id(request) or -1)
    return {"closed": closed}


@router.post("/sign-out", status_code=status.HTTP_204_NO_CONTENT)
def sign_out(request: Request, response: Response, db: Session = Depends(get_db)) -> None:
    """Signs this device out. Works even if the session is already gone, so
    the button can never fail: the cookie is cleared either way."""
    row = sessions.session_for(db, request.cookies.get(sessions.COOKIE))
    if row is not None:
        sessions.close_session(db, row)
    sessions.clear_cookie(response)


# --- what the sign-in page offers ---------------------------------------------


@router.get("/ways")
def ways_in() -> dict:
    """Which ways in are set up, for the sign-in page: Google appears only
    with a Client ID, development sign-in only with dev tools on. Asked by
    somebody not signed in, so it says nothing about anybody."""
    from app.core.config import settings

    return {"google_client_id": settings.google_client_id, "dev": settings.enable_dev_tools}


# --- signing in with Google -------------------------------------------------


class GoogleIn(BaseModel):
    #: The token Google's sign-in button handed the page.
    credential: str


@router.post("/google")
def sign_in_with_google(
    payload: GoogleIn,
    response: Response,
    db: Session = Depends(get_db),
    user_agent: str | None = Header(None),
) -> dict:
    """Signs in with a Google account (app/auth/google.py checks the token).
    The first time, a new account is made, pre-filled with the name Google
    gives; every time after, the same account."""
    try:
        account = google.verify(payload.credential)
    except google.GoogleSignInError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail={"reason": "google_refused"})
    user = sessions.user_for_door(db, PROVIDER_GOOGLE, account.subject)
    new = user is None
    if user is None:
        user = User(first_name=account.first_name, last_name=account.last_name, last_seen_at=utcnow())
        db.add(user)
        db.commit()
        sessions.remember_door(db, user, PROVIDER_GOOGLE, account.subject)
    _sign_in(db, response, user, PROVIDER_GOOGLE, user_agent)
    return {"new": new}


# --- signing in with another phone ------------------------------------------
#
# The new device asks (start), shows the code and waits (wait); somebody
# signed in on their phone looks at the request (see) and approves or
# refuses it; the new device then collects its session (claim) with the
# secret only it holds.

#: How long a request can be approved.
DEVICE_REQUEST_LIFETIME = timedelta(minutes=2)
#: The longest one "wait" is held open before the device asks again.
WAIT_HOLD_SECONDS = 25
#: Letters that cannot be mistaken for each other when typed.
CODE_LETTERS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


class DeviceStartOut(BaseModel):
    code: str
    #: Only the asking device ever has this; it collects the session with it.
    secret: str
    expires_at: datetime


@router.post("/device/start", response_model=DeviceStartOut)
def start_device_request(db: Session = Depends(get_db), user_agent: str | None = Header(None)) -> DeviceStartOut:
    """A device that is not signed in asks to be signed in by a phone."""
    now = utcnow()
    # Old requests go as new ones come, so the table never grows.
    db.execute(delete(DeviceSignInRequest).where(DeviceSignInRequest.expires_at < now - timedelta(hours=1)))
    secret = secrets.token_urlsafe(24)
    code = ""
    for _ in range(5):
        code = "".join(secrets.choice(CODE_LETTERS) for _ in range(8))
        if db.scalar(select(DeviceSignInRequest.id).where(DeviceSignInRequest.code == code)) is None:
            break
    row = DeviceSignInRequest(
        code=code,
        secret_hash=sessions.hash_token(secret),
        device=sessions.device_name(user_agent)[:80],
        created_at=now,
        expires_at=now + DEVICE_REQUEST_LIFETIME,
    )
    db.add(row)
    db.commit()
    return DeviceStartOut(code=code, secret=secret, expires_at=row.expires_at)


def _status(row: DeviceSignInRequest | None) -> str:
    if row is None:
        return "expired"
    if row.claimed_at is not None:
        return "used"
    if row.refused_at is not None:
        return "refused"
    if row.approved_at is not None:
        return "approved"
    if utcnow() > row.expires_at:
        return "expired"
    return "pending"


class DeviceSecretIn(BaseModel):
    code: str
    secret: str


def _own_request(db: Session, payload: DeviceSecretIn) -> DeviceSignInRequest | None:
    row = db.scalar(select(DeviceSignInRequest).where(DeviceSignInRequest.code == payload.code.upper()))
    if row is None or row.secret_hash != sessions.hash_token(payload.secret):
        return None
    return row


@router.post("/device/wait")
async def wait_for_approval(payload: DeviceSecretIn, db: Session = Depends(open_db)) -> dict:
    """The asking device waits here for an answer, held open up to
    WAIT_HOLD_SECONDS, so it asks a handful of times in two minutes rather
    than every second. The database is looked at once a second, briefly,
    and its connection given back in between."""

    def look() -> str:
        db.expire_all()
        state = _status(_own_request(db, payload))
        db.close()
        return state

    for _ in range(WAIT_HOLD_SECONDS):
        state = await run_in_threadpool(look)
        if state != "pending":
            return {"status": state}
        await asyncio.sleep(1)
    return {"status": "pending"}


@router.post("/device/claim", status_code=status.HTTP_204_NO_CONTENT)
def claim_device_session(
    payload: DeviceSecretIn,
    response: Response,
    db: Session = Depends(get_db),
    user_agent: str | None = Header(None),
) -> None:
    """The asking device collects its session, once, after approval."""
    row = _own_request(db, payload)
    state = _status(row)
    if state != "approved":
        raise HTTPException(status.HTTP_409_CONFLICT, detail={"reason": state})
    row.claimed_at = utcnow()
    db.commit()
    user = db.get(User, row.approved_by_user_id)
    _sign_in(db, response, user, PROVIDER_DEVICE, user_agent)


class DeviceRequestOut(BaseModel):
    code: str
    #: Which device is asking, so the person approving knows it is theirs.
    device: str
    created_at: datetime
    status: str


def _live_by_code(db: Session, code: str) -> DeviceSignInRequest:
    row = db.scalar(select(DeviceSignInRequest).where(DeviceSignInRequest.code == code.upper()))
    if row is None or _status(row) == "expired":
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail={"reason": "expired"})
    return row


@router.get("/device/{code}", response_model=DeviceRequestOut)
def see_device_request(code: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> DeviceRequestOut:
    """What the phone shows before approving: which device, asked when."""
    row = _live_by_code(db, code)
    return DeviceRequestOut(code=row.code, device=row.device, created_at=row.created_at, status=_status(row))


@router.post("/device/{code}/approve", status_code=status.HTTP_204_NO_CONTENT)
def approve_device_request(code: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> None:
    """Signs the asking device in to MY account."""
    row = _live_by_code(db, code)
    state = _status(row)
    if state != "pending":
        raise HTTPException(status.HTTP_409_CONFLICT, detail={"reason": state})
    row.approved_by_user_id = current_user.id
    row.approved_at = utcnow()
    db.commit()


@router.post("/device/{code}/refuse", status_code=status.HTTP_204_NO_CONTENT)
def refuse_device_request(code: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> None:
    """Not mine, or not now: the asking device is told no."""
    row = _live_by_code(db, code)
    if _status(row) == "pending":
        row.refused_at = utcnow()
        db.commit()
