"""
Sessions, from the person's side (TECHNICAL_REQUIREMENTS.md section 32):
which devices are signed in, closing one or all the others, and signing
out. The ways in (Google, a phone number, Telegram through our bot, another
phone) each add one route here that ends by calling `_sign_in`.
"""

import asyncio
import logging
import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, BackgroundTasks, Cookie, Depends, Form, Header, HTTPException, Request, Response, status
from fastapi.responses import RedirectResponse
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.auth import doors, google, sessions
from app.auth.dependencies import current_session_id, get_current_user
from app.core.attempts import Attempts
from app.core.database import get_db, open_db
from app.core.time import utcnow
from app.live.hub import hub
from app.models.auth_session import (
    PROVIDER_DEVICE,
    PROVIDER_GOOGLE,
    PURPOSE_CONFIRM,
    PURPOSE_LINK,
    AuthSession,
    DeviceSignInRequest,
)
from app.models.user import User

router = APIRouter(prefix="/auth", tags=["auth"])
log = logging.getLogger(__name__)


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
    when it is set up, development sign-in only with dev tools on. Asked by
    somebody not signed in, so it says nothing about anybody."""
    from app.core.config import settings

    from app.auth import telegram_router

    return {"google": google.ready(), "telegram": telegram_router.ready(), "dev": settings.enable_dev_tools}


# --- signing in with Google -------------------------------------------------
#
# The browser goes to Google (start) and comes back with a signed token
# (callback). The two halves are tied together by a short-lived cookie
# holding the request's `state` and `nonce`: an answer that does not match
# the request this very browser started is refused, so nobody can slip
# their own Google sign-in into somebody else's browser.

#: Holds "state.nonce" between going to Google and coming back.
GOOGLE_COOKIE = "cosmos_google"
#: Long enough to choose an account, or even make one.
GOOGLE_COOKIE_SECONDS = 600


def _back_to_sign_in(reason: str) -> RedirectResponse:
    """Back to the sign-in page, which reads `reason` and says what went wrong."""
    response = RedirectResponse(f"/?signin={reason}", status_code=status.HTTP_303_SEE_OTHER)
    response.delete_cookie(GOOGLE_COOKIE, path="/", secure=True, httponly=True, samesite="none")
    return response


#: Trips to Google started from inside the account (section 36).
GOOGLE_PURPOSES = {PURPOSE_CONFIRM, PURPOSE_LINK}
#: Where those trips come back to: "Settings -> ways in".
WAYS_PAGE = "/settings/ways"


def _back_to_ways(outcome: str) -> RedirectResponse:
    """Back to "Settings -> ways in", which reads `outcome` and says it."""
    response = RedirectResponse(f"{WAYS_PAGE}?google={outcome}", status_code=status.HTTP_303_SEE_OTHER)
    response.delete_cookie(GOOGLE_COOKIE, path="/", secure=True, httponly=True, samesite="none")
    return response


@router.get("/google/start")
def start_google(
    request: Request,
    lang: str | None = None,
    purpose: str | None = None,
    db: Session = Depends(get_db),
) -> RedirectResponse:
    """Where a Google button leads: off to Google's account chooser, in the
    page's language. From the sign-in page, to sign in; from "Settings ->
    ways in" (`purpose`), to confirm it is the owner or to connect a Google
    account — then the trip is noted on this session, because Google's
    answer comes back without this session's cookie."""
    if not google.ready():
        return _back_to_ways("off") if purpose in GOOGLE_PURPOSES else _back_to_sign_in("google_off")
    state, nonce = secrets.token_urlsafe(24), secrets.token_urlsafe(24)
    if purpose in GOOGLE_PURPOSES:
        session = sessions.session_for(db, request.cookies.get(sessions.COOKIE))
        if session is None:
            return _back_to_sign_in("signed_out")
        session.google_state_hash = sessions.hash_token(state)
        session.google_purpose = purpose
        db.commit()
    language = lang if lang in {"fa", "en"} else None
    response = RedirectResponse(google.authorization_url(state, nonce, language), status_code=status.HTTP_302_FOUND)
    # Google posts the answer back from its own site, and a browser sends
    # a cookie on such a post only when it is SameSite=None, which in turn
    # must be Secure (browsers accept that on http://localhost too).
    response.set_cookie(
        GOOGLE_COOKIE,
        f"{state}.{nonce}",
        max_age=GOOGLE_COOKIE_SECONDS,
        httponly=True,
        secure=True,
        samesite="none",
        path="/",
    )
    return response


@router.post("/google/callback")
def google_callback(
    later: BackgroundTasks,
    id_token: str | None = Form(None),
    state: str | None = Form(None),
    error: str | None = Form(None),
    kept: str | None = Cookie(None, alias=GOOGLE_COOKIE),
    db: Session = Depends(get_db),
    user_agent: str | None = Header(None),
) -> RedirectResponse:
    """Google sends the browser back here with the token. Checked, the
    person is signed in — the first time a new account is made, pre-filled
    with the name Google gives — and lands in the app."""
    if error:
        # Closed the chooser, or said no: nothing to apologise for.
        if state and db.scalar(select(AuthSession.id).where(AuthSession.google_state_hash == sessions.hash_token(state))):
            return _back_to_ways("cancelled")
        return _back_to_sign_in("google_cancelled")
    started_state, _, nonce = (kept or "").partition(".")
    if not (id_token and state and started_state and nonce and secrets.compare_digest(started_state, state)):
        # Most often the browser did not send the cookie back.
        log.warning("Google sign-in refused: state missing or not this browser's (cookie sent: %s)", bool(kept))
        return _back_to_sign_in("google_failed")
    # A trip started from inside an account finds its session by the state.
    trip = db.scalar(select(AuthSession).where(AuthSession.google_state_hash == sessions.hash_token(state)))
    try:
        account = google.verify(id_token, nonce)
    except google.GoogleSignInError as error:
        log.warning("Google sign-in refused: %s", error)
        return _back_to_ways("failed") if trip is not None else _back_to_sign_in("google_failed")
    if trip is not None:
        return _google_from_inside(db, later, trip, account)
    user = sessions.user_for_door(db, PROVIDER_GOOGLE, account.subject)
    if user is None:
        user = User(first_name=account.first_name, last_name=account.last_name, last_seen_at=utcnow())
        db.add(user)
        db.commit()
    sessions.remember_door(db, user, PROVIDER_GOOGLE, account.subject, account.label)
    response = RedirectResponse("/", status_code=status.HTTP_303_SEE_OTHER)
    _sign_in(db, response, user, PROVIDER_GOOGLE, user_agent)
    response.delete_cookie(GOOGLE_COOKIE, path="/", secure=True, httponly=True, samesite="none")
    return response


def _google_from_inside(db: Session, later: BackgroundTasks, trip: AuthSession, account) -> RedirectResponse:
    """The answer to a trip to Google started from "Settings -> ways in"
    (section 36): confirming it is the owner, or connecting this Google
    account to the account."""
    purpose = trip.google_purpose
    trip.google_state_hash = None
    trip.google_purpose = None
    db.commit()
    if trip.revoked_at is not None:
        return _back_to_sign_in("signed_out")
    user = db.get(User, trip.user_id)
    owner = sessions.user_for_door(db, PROVIDER_GOOGLE, account.subject)
    if purpose == PURPOSE_CONFIRM:
        # Only the Google account already connected here proves anything.
        if owner is None or owner.id != user.id:
            return _back_to_ways("not_yours")
        trip.confirmed_at = utcnow()
        db.commit()
        sessions.remember_door(db, user, PROVIDER_GOOGLE, account.subject, account.label)
        return _back_to_ways("confirmed")
    # Connecting: only right after proving it is the owner.
    if not sessions.is_confirmed(trip):
        return _back_to_ways("confirm_first")
    if owner is not None and owner.id != user.id:
        return _back_to_ways("taken")
    if owner is None:
        sessions.replace_door(db, user, PROVIDER_GOOGLE, account.subject, account.label)
        doors.tell_owner(db, later, user, "google_linked", account.label)
    else:
        sessions.remember_door(db, user, PROVIDER_GOOGLE, account.subject, account.label)
    return _back_to_ways("linked")


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


#: Ten codes in ten minutes from one place (the owner's decision): far more
#: than anybody signing in needs, and it stops somebody making thousands.
device_starts = Attempts(limit=10, window_seconds=600)


def too_many_tries() -> HTTPException:
    """What every way in says when one place has tried too often."""
    return HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, detail={"reason": "too_many_tries"})


def _where_from(request: Request) -> str:
    """Who is asking, for counting tries: their address. Behind a load
    balancer the server must be told to trust its forwarded address
    (uvicorn --proxy-headers), or everybody looks like the balancer."""
    return request.client.host if request.client else "?"


@router.post("/device/start", response_model=DeviceStartOut)
def start_device_request(
    request: Request, db: Session = Depends(get_db), user_agent: str | None = Header(None)
) -> DeviceStartOut:
    """A device that is not signed in asks to be signed in by a phone."""
    if not device_starts.allow(_where_from(request)):
        raise too_many_tries()
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


def _own_request(db: Session, payload: DeviceSecretIn, model=DeviceSignInRequest):
    """The request with this code, if the secret is the asking device's.
    Device codes are typed, so any case is accepted; bot codes are exact."""
    code = payload.code.upper() if model is DeviceSignInRequest else payload.code
    row = db.scalar(select(model).where(model.code == code))
    if row is None or row.secret_hash != sessions.hash_token(payload.secret):
        return None
    return row


class DeviceWaitIn(DeviceSecretIn):
    #: Whether the device already knows a phone has opened the request, so
    #: it is told about that once rather than on every wait.
    seen: bool = False


def _news(state: str, seen: bool, problem: str | None) -> dict:
    """What a wait answers; `problem` only when the bot refused on its own."""
    return {"status": state, "seen": seen, **({"problem": problem} if problem else {})}


async def wait_for_news(db: Session, payload: DeviceWaitIn, model=DeviceSignInRequest) -> dict:
    """Holds a waiting sign-in page open up to WAIT_HOLD_SECONDS (never past
    the request's end), so it asks only a handful of times in two minutes.
    Shared by "another phone" and "Telegram through our bot".

    It does not look at the database while it waits: the phone's or the
    bot's answer wakes it through the live hub (`device_request_changed`),
    on whichever process it waits. The database is read once when the wait
    starts and once each time it is woken, its connection given back in
    between.

    News is an answer (approved, refused, expired) or, once, that the
    request has been opened — scanned on a phone, or Start tapped in
    Telegram — so the page can say "now confirm it there".
    """

    def look() -> tuple[str, bool, datetime | None, str | None]:
        db.expire_all()
        row = _own_request(db, payload, model)
        answer = (
            _status(row),
            bool(row is not None and row.seen_at is not None),
            row.expires_at if row else None,
            # Why the bot refused on its own, for requests from inside an account.
            getattr(row, "problem", None),
        )
        db.close()
        return answer

    key = payload.code.upper() if model is DeviceSignInRequest else payload.code
    loop = asyncio.get_running_loop()
    deadline = loop.time() + WAIT_HOLD_SECONDS
    # Watched before the first look, so a change between the look and the
    # wait still wakes it.
    woken = hub.watch_device_request(key)
    try:
        while True:
            woken.clear()
            state, seen, expires_at, problem = await run_in_threadpool(look)
            if state != "pending" or seen != payload.seen:
                return _news(state, seen, problem)
            left = deadline - loop.time()
            if expires_at is not None:
                # Wake at the request's end too, to say it ran out.
                left = min(left, (expires_at - utcnow()).total_seconds() + 0.5)
            if left <= 0:
                return _news(state, seen, problem)
            try:
                await asyncio.wait_for(woken.wait(), left)
            except asyncio.TimeoutError:
                pass
    finally:
        hub.unwatch_device_request(key, woken)


@router.post("/device/wait")
async def wait_for_approval(payload: DeviceWaitIn, db: Session = Depends(open_db)) -> dict:
    """The asking device waits here for the phone (see wait_for_news)."""
    return await wait_for_news(db, payload)


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
    """What the phone shows before approving: which device, asked when.
    The first look also tells the waiting device the code was scanned."""
    row = _live_by_code(db, code)
    if row.seen_at is None:
        row.seen_at = utcnow()
        db.commit()
        hub.device_request_changed(row.code)
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
    hub.device_request_changed(row.code)


@router.post("/device/{code}/refuse", status_code=status.HTTP_204_NO_CONTENT)
def refuse_device_request(code: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> None:
    """Not mine, or not now: the asking device is told no."""
    row = _live_by_code(db, code)
    if _status(row) == "pending":
        row.refused_at = utcnow()
        db.commit()
        hub.device_request_changed(row.code)
