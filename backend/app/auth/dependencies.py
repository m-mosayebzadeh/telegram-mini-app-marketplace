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

from fastapi import Header, HTTPException, status
from sqlalchemy.orm import Session

from app.auth.telegram import TelegramAuthError, TelegramUser, validate_init_data
from app.core.config import settings
from app.core.database import get_db
from app.core.time import utcnow
from app.models.admin_grant import AdminGrant
from app.models.role import Role
from app.models.user import User

# FastAPI's `Depends` mechanism supports nesting: this dependency itself
# depends on `get_db`, so FastAPI resolves get_db() first, gets a Session,
# and passes it in here automatically.
from fastapi import Depends


def _get_telegram_user(x_telegram_init_data: str = Header(...)) -> TelegramUser:
    """
    Reads the raw initData from the "X-Telegram-Init-Data" request header
    and validates it. Any failure becomes a 401 Unauthorized response —
    a route never needs to know *why* auth failed, just that it did.
    """
    try:
        return validate_init_data(
            init_data=x_telegram_init_data,
            bot_token=settings.telegram_bot_token,
            max_age_seconds=settings.telegram_auth_max_age_seconds,
        )
    except TelegramAuthError as error:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(error),
        ) from error


def get_current_user(
    telegram_user: TelegramUser = Depends(_get_telegram_user),
    db: Session = Depends(get_db),
) -> User:
    """
    Resolves the verified TelegramUser to our own `User` row, creating one
    on first login. This is the dependency routes should actually use.
    """
    existing_user = (
        db.query(User).filter(User.telegram_id == telegram_user.id).first()
    )
    if existing_user is not None:
        _touch_last_seen(db, existing_user)
        return existing_user

    # First time we've seen this telegram_id — create our own user record.
    # first_name/last_name/username are only pre-filled here; the user
    # can change them later inside the app (see TECHNICAL_REQUIREMENTS.md,
    # section 2).
    #
    # username is now UNIQUE on this table (see User.username's
    # docstring) — a genuine collision between two different real
    # Telegram accounts' usernames should be essentially impossible
    # (Telegram itself enforces @usernames are globally unique), but
    # this pre-check still exists as a real safety net: local dev/test
    # tooling can easily produce one on purpose, and it's a one-line
    # guard against a first login ever crashing with a raw 500 over
    # something this minor — falling back to no username (the user can
    # always set one themselves via PUT /me/username) beats failing the
    # whole login.
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
