"""
Sessions: what signing in gives a person (TECHNICAL_REQUIREMENTS.md section
32; the tables are in app/models/auth_session.py).

How it works, in plain terms. When somebody signs in — by any door — the
server makes a long random token, keeps only its SHA-256, and hands the
token to the browser in a cookie with three locks on it:

- **HttpOnly** — the page's own code cannot read it, so a bad piece of
  script that ever got into the page could not steal it;
- **Secure** — it only travels over HTTPS, so nobody listening on the way
  sees it (off for local development over plain http);
- **SameSite=Lax** — the browser only shows it to our own site, so another
  site cannot act as you with it.

Every request after that is known by the cookie alone. A session lasts
ninety days from its last use (the owner's decision); "used" is written at
most every few minutes, so reading the app is not a stream of writes.
Closing a session — signing out, or closing it from another device — marks
it revoked at once; that device's next request is refused with
"signed_out" and the app sends it to the sign-in page (the owner's
instruction), and its live connection is cut the same moment.
"""

from __future__ import annotations

import hashlib
import secrets
from datetime import timedelta

from fastapi import Response
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.time import utcnow
from app.models.auth_session import AuthIdentity, AuthSession
from app.models.user import User

#: The cookie's name. Plain, so it is easy to find when debugging.
COOKIE = "cosmos_session"

#: "Last used" is written at most this often.
TOUCH_EVERY = timedelta(minutes=5)
#: How long a confirmation through one of the account's ways in lets the
#: ways in be changed (section 36): long enough to make the change, short
#: enough that a phone picked up later cannot.
CONFIRM_FOR = timedelta(minutes=10)
#: Sessions that do not count as confirmed when they open: one approved by
#: another signed-in phone proves only that somebody holds that phone,
#: which is exactly what the confirmation exists to look past.
NOT_CONFIRMING = {"device"}


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def lifetime() -> timedelta:
    return timedelta(days=settings.session_days)


def device_name(user_agent: str | None) -> str:
    """A short, human name for the device from the browser's own words —
    only so a person recognises their sessions in the list. Not trusted
    for anything else."""
    ua = (user_agent or "").lower()
    browser = next(
        (name for key, name in (("edg/", "Edge"), ("telegram", "Telegram"), ("firefox", "Firefox"), ("chrome", "Chrome"), ("safari", "Safari")) if key in ua),
        "",
    )
    system = next(
        (name for key, name in (("iphone", "iPhone"), ("ipad", "iPad"), ("android", "Android"), ("windows", "Windows"), ("mac os", "Mac"), ("linux", "Linux")) if key in ua),
        "",
    )
    if browser and system:
        return f"{browser} · {system}"
    return browser or system or "?"


def start_session(db: Session, user: User, *, provider: str, user_agent: str | None) -> str:
    """Opens a session for this person and returns the token for the
    cookie. Commits."""
    token = secrets.token_urlsafe(32)
    now = utcnow()
    db.add(
        AuthSession(
            user_id=user.id,
            token_hash=hash_token(token),
            provider=provider,
            device=device_name(user_agent)[:80],
            created_at=now,
            last_used_at=now,
            # Signing in through Google or Telegram just proved who this is.
            confirmed_at=None if provider in NOT_CONFIRMING else now,
        )
    )
    db.commit()
    return token


def is_confirmed(row: AuthSession | None) -> bool:
    """This session proved it is the owner within CONFIRM_FOR (section 36)."""
    return row is not None and row.confirmed_at is not None and utcnow() - row.confirmed_at < CONFIRM_FOR


def session_for(db: Session, token: str | None) -> AuthSession | None:
    """The open session this token belongs to, or None: unknown, closed, or
    unused for longer than its lifetime. Refreshes "last used"."""
    if not token:
        return None
    row = db.scalar(select(AuthSession).where(AuthSession.token_hash == hash_token(token)))
    if row is None or row.revoked_at is not None:
        return None
    now = utcnow()
    if now - row.last_used_at > lifetime():
        return None
    if now - row.last_used_at >= TOUCH_EVERY:
        row.last_used_at = now
        db.commit()
    return row


def close_session(db: Session, row: AuthSession) -> None:
    """Closes one session, and cuts its live connection everywhere."""
    if row.revoked_at is None:
        row.revoked_at = utcnow()
        db.commit()
    from app.live.hub import hub  # imported here: the hub imports nothing of ours

    hub.close_session(row.id)


def close_other_sessions(db: Session, user_id: int, keep_id: int) -> int:
    """Closes every open session of this person but one. Returns how many."""
    ids = list(
        db.scalars(
            select(AuthSession.id).where(
                AuthSession.user_id == user_id,
                AuthSession.revoked_at.is_(None),
                AuthSession.id != keep_id,
            )
        )
    )
    if ids:
        db.execute(update(AuthSession).where(AuthSession.id.in_(ids)).values(revoked_at=utcnow()))
        db.commit()
        from app.live.hub import hub

        for session_id in ids:
            hub.close_session(session_id)
    return len(ids)


def close_all_sessions(db: Session, user_id: int) -> None:
    """Every session of this person, closed — for deleting an account."""
    close_other_sessions(db, user_id, keep_id=-1)


def set_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        COOKIE,
        token,
        max_age=int(lifetime().total_seconds()),
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite="lax",
        path="/",
    )


def clear_cookie(response: Response) -> None:
    response.delete_cookie(COOKIE, path="/", httponly=True, secure=settings.session_cookie_secure, samesite="lax")


def user_for_door(db: Session, provider: str, subject: str) -> User | None:
    """The person behind this door, if anybody has come through it before."""
    identity = db.scalar(
        select(AuthIdentity).where(AuthIdentity.provider == provider, AuthIdentity.subject == subject)
    )
    return db.get(User, identity.user_id) if identity is not None else None


def remember_door(db: Session, user: User, provider: str, subject: str, label: str | None = None) -> None:
    """Records that this person can come in through this door, and keeps
    its label up to date (a new @username, say). Commits."""
    identity = db.scalar(
        select(AuthIdentity).where(AuthIdentity.provider == provider, AuthIdentity.subject == subject)
    )
    if identity is None:
        db.add(AuthIdentity(user_id=user.id, provider=provider, subject=subject, label=label))
        db.commit()
    elif label and identity.label != label and identity.user_id == user.id:
        identity.label = label
        db.commit()


def doors_of(db: Session, user_id: int) -> list[AuthIdentity]:
    """Every way in this person has, oldest first."""
    return list(
        db.scalars(select(AuthIdentity).where(AuthIdentity.user_id == user_id).order_by(AuthIdentity.created_at, AuthIdentity.id))
    )


def replace_door(db: Session, user: User, provider: str, subject: str, label: str | None) -> None:
    """This person's way in through `provider` becomes `subject`: one Google
    account and one Telegram account per person, so connecting another
    replaces the one there was. The caller has made sure nobody else has
    that door. Commits."""
    for identity in doors_of(db, user.id):
        if identity.provider == provider:
            db.delete(identity)
    db.flush()
    db.add(AuthIdentity(user_id=user.id, provider=provider, subject=subject, label=label))
    db.commit()


def mask_email(address: str | None) -> str | None:
    """"m.mosaiebzadeh@gmail.com" -> "m.m***h@gmail.com": the start and the
    end of the name, so its owner recognises it, and the rest hidden, so a
    leak of the label is not a leak of the address (the owner's decision,
    section 36)."""
    if not address or "@" not in address:
        return None
    name, _, domain = address.rpartition("@")
    if len(name) <= 2:
        shown = name[:1] + "***"
    elif len(name) <= 5:
        shown = name[:1] + "***" + name[-1:]
    else:
        shown = name[:3] + "***" + name[-1:]
    return f"{shown}@{domain}"[:128]
