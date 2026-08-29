"""
FastAPI dependency that turns a raw request into an authenticated `User`.

"Dependency" is FastAPI's term for a function that a route can ask for as
a parameter; FastAPI calls it automatically before running the route, and
passes whatever it returns into the route function. We use this to keep
"who is making this request, and are they real?" out of every individual
route — each route just asks for a `User` and gets one, or the request
never reaches it.
"""

from fastapi import Header, HTTPException, status
from sqlalchemy.orm import Session

from app.auth.telegram import TelegramAuthError, TelegramUser, validate_init_data
from app.core.config import settings
from app.core.database import get_db
from app.models.admin_grant import AdminGrant
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
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)  # loads DB-generated fields, e.g. `id` and `joined_at`
    return new_user


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


def require_admin(scope: str):
    """
    Returns a FastAPI dependency that only lets a request through if
    the caller is either the owner (unrestricted) or holds an
    AdminGrant that includes `scope` (see app/models/admin_grant.py).
    Anyone else gets a 403 — same "don't even hint this exists further
    than necessary" instinct as the rest of this app's access checks,
    though here a plain 403 is fine since admin routes are already only
    reachable by someone who's authenticated as SOME real user.

    Usage: `Depends(require_admin("wallet_topups"))` in a route's
    signature — the returned callable is itself the dependency FastAPI
    calls, not something routes invoke directly.
    """

    def _dependency(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> User:
        if is_owner(current_user):
            return current_user

        grant = db.query(AdminGrant).filter(AdminGrant.user_id == current_user.id).first()
        if grant is not None and scope in grant.scopes:
            return current_user

        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not authorized.")

    return _dependency
