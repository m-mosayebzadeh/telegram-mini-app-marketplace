"""
FastAPI dependency that turns a raw request into an authenticated `User`.

"Dependency" is FastAPI's term for a function that a route can ask for as
a parameter; FastAPI calls it automatically before running the route, and
passes whatever it returns into the route function. We use this to keep
"who is making this request, and are they real?" out of every individual
route — each route just asks for a `User` and gets one, or the request
never reaches it.
"""

from datetime import timedelta

from fastapi import HTTPException, Request, status
from sqlalchemy.orm import Session

from app.auth import sessions
from app.auth.telegram import TelegramUser
from app.core.config import settings
from app.core.database import get_db
from app.core.time import utcnow
from app.models.admin_grant import AdminGrant
from app.models.auth_session import PROVIDER_TELEGRAM
from app.models.role import Role
from app.models.user import User, UserStatus

# FastAPI's `Depends` mechanism supports nesting: this dependency itself
# depends on `get_db`, so FastAPI resolves get_db() first, gets a Session,
# and passes it in here automatically.
from fastapi import Depends


def _signed_out() -> HTTPException:
    """Refused because nobody is signed in on this device (any more). The
    app sends the person to the sign-in page on this reason."""
    return HTTPException(status.HTTP_401_UNAUTHORIZED, detail={"reason": "signed_out"})


def _shut_if_deleted(user: User) -> None:
    # A deleted account stays shut rather than quietly becoming a new
    # one: the app keeps asking things in the background, and each of
    # those would otherwise create an empty account that shows up in
    # the world. Starting again is a deliberate step of its own
    # (POST /me/start-over, app/account/router.py).
    if user.status == UserStatus.DELETED:
        raise HTTPException(status.HTTP_410_GONE, detail={"reason": "account_deleted"})


def get_current_user(
    request: Request,
    db: Session = Depends(get_db),
) -> User:
    """
    Who is making this request. The dependency routes should use.

    Known by the sign-in session's cookie (app/auth/sessions.py): every way
    in — Google, a phone number, Telegram through our bot, another phone —
    ends in a session, and from then on the session alone says who this
    is. A cookie that no longer opens anything (signed out, closed from
    another device, unused for ninety days) is refused with "signed_out",
    and the app goes to the sign-in page.

    Nothing else is accepted: the app is not opened inside Telegram any more
    (the owner's decision), so Telegram's launch data means nothing here.
    """
    token = request.cookies.get(sessions.COOKIE)
    if token:
        session = sessions.session_for(db, token)
        user = db.get(User, session.user_id) if session is not None else None
        if user is None:
            raise _signed_out()
        _shut_if_deleted(user)
        request.state.session_id = session.id
        _touch_last_seen(db, user)
        return user
    raise _signed_out()


def current_session_id(request: Request) -> int | None:
    """The session the current request came with (set by get_current_user)."""
    return getattr(request.state, "session_id", None)


def user_from_telegram(db: Session, telegram_user: TelegramUser) -> User:
    """
    The person behind a Telegram identity, creating them the first time.
    For signing in through our bot, and for development sign-in.
    """
    existing_user = (
        db.query(User).filter(User.telegram_id == telegram_user.id).first()
    )
    if existing_user is not None:
        _shut_if_deleted(existing_user)
        _touch_last_seen(db, existing_user)
        sessions.remember_door(db, existing_user, PROVIDER_TELEGRAM, str(telegram_user.id))
        return existing_user

    # First time we've seen this telegram_id — create our own user record.
    # first_name/last_name/username are only pre-filled here; the user
    # can change them later inside the app (see TECHNICAL_REQUIREMENTS.md,
    # section 2).
    #
    # username is UNIQUE on this table (see User.username's docstring): a
    # collision between two real Telegram accounts should be impossible,
    # but local tooling can produce one, and falling back to no username
    # beats failing the whole sign-in over something this minor.
    prefilled_username = telegram_user.username
    if prefilled_username and db.query(User).filter(User.username == prefilled_username).first():
        prefilled_username = None

    new_user = User(
        telegram_id=telegram_user.id,
        first_name=telegram_user.first_name or "New User",
        last_name=telegram_user.last_name,
        username=prefilled_username,
        # Somebody whose very first request this is, is here right now —
        # leaving it null would show a person who just arrived as away.
        last_seen_at=utcnow(),
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)  # loads DB-generated fields, e.g. `id` and `joined_at`
    sessions.remember_door(db, new_user, PROVIDER_TELEGRAM, str(telegram_user.id))
    return new_user


#: How stale "last seen" is allowed to get before it is written again.
#:
#: Without it, every read in the app would become a write, which is a
#: remarkable amount of database traffic to buy a number nobody reads to
#: the second. A minute is finer than the world can show anyway.
LAST_SEEN_WRITE_EVERY = timedelta(minutes=1)

#: How recently somebody must have been seen to count as here RIGHT NOW.
#:
#: Generous on purpose: somebody reading a long message has not left, and
#: a ring that blinks out while they are mid-sentence is worse than one
#: that lingers a few minutes after they really have gone.
ONLINE_WITHIN = timedelta(minutes=5)


def _touch_last_seen(db: Session, user: User) -> None:
    now = utcnow()
    if user.last_seen_at is not None and now - user.last_seen_at < LAST_SEEN_WRITE_EVERY:
        return
    user.last_seen_at = now
    db.commit()


def seen_roughly(user: User, *, now=None) -> str:
    """When this person was last here, only as roughly as a conversation's
    header needs it: "now", "minutes", "hours", "days" or "long".

    Coarse on purpose. "Here right now" is already public — it is the ring
    in the sky — but an exact last-seen time is a thing people are careful
    about (Telegram lets them hide it), and nothing in the design needs one.
    """
    if user.last_seen_at is None:
        return "long"
    gone = (now or utcnow()) - user.last_seen_at
    if gone <= ONLINE_WITHIN:
        return "now"
    if gone <= timedelta(hours=1):
        return "minutes"
    if gone <= timedelta(days=1):
        return "hours"
    if gone <= timedelta(days=7):
        return "days"
    return "long"


def is_online(user: User, *, now=None) -> bool:
    """Whether this person is here at this moment.

    Read from the stored time rather than tracked by anything that ticks,
    the same as every other deadline in this app.
    """
    if user.last_seen_at is None:
        return False
    return (now or utcnow()) - user.last_seen_at <= ONLINE_WITHIN


def is_owner(user: User) -> bool:
    """The one true super-admin — see app/core/config.py's
    owner_telegram_id docstring for why this is a fixed .env value
    instead of "first user to register"."""
    return settings.owner_telegram_id is not None and user.telegram_id == settings.owner_telegram_id


def require_owner(current_user: User = Depends(get_current_user)) -> User:
    """
    Stricter than require_admin(...): only the real owner, never a
    scoped AdminGrant holder — used for managing admin access itself
    (app/admin/router.py's grant endpoints), since letting a granted
    admin hand out MORE access (even to themselves) would defeat the
    whole point of narrow, owner-controlled grants.
    """
    if not is_owner(current_user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Owner only.")
    return current_user


def effective_admin_scopes(db: Session, user_id: int) -> set[str]:
    """
    The union of scopes from every ACTIVE role `user_id` currently
    holds (see app/models/role.py — a deactivated role contributes
    nothing, even though the AdminGrant assignment row to it still
    exists). This is the one place that turns "which roles does this
    person have" into "what can they actually do", so both
    require_admin() below and GET /admin/me (app/admin/router.py) stay
    in sync automatically.
    """
    role_scope_lists = (
        db.query(Role.scopes)
        .join(AdminGrant, AdminGrant.role_id == Role.id)
        .filter(AdminGrant.user_id == user_id, Role.is_active.is_(True))
        .all()
    )
    scopes: set[str] = set()
    for (scopes_for_one_role,) in role_scope_lists:
        scopes.update(scopes_for_one_role)
    return scopes


def require_admin(scope: str):
    """
    Returns a FastAPI dependency that only lets a request through if
    the caller is either the owner (unrestricted) or holds an active
    role that includes `scope` (see effective_admin_scopes above).
    Anyone else gets a 403 — same "don't even hint this exists further
    than necessary" instinct as the rest of this app's access checks,
    though here a plain 403 is fine since admin routes are already only
    reachable by someone who's authenticated as SOME real user.

    Usage: `Depends(require_admin("finance.topups"))` in a route's
    signature — the returned callable is itself the dependency FastAPI
    calls, not something routes invoke directly.
    """

    def _dependency(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> User:
        if is_owner(current_user):
            return current_user

        if scope in effective_admin_scopes(db, current_user.id):
            return current_user

        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not authorized.")

    return _dependency
