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
    # display_name/username are only pre-filled here; the user can change
    # them later inside the app (see TECHNICAL_REQUIREMENTS.md, section 2).
    new_user = User(
        telegram_id=telegram_user.id,
        display_name=telegram_user.first_name or "New User",
        username=telegram_user.username,
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)  # loads DB-generated fields, e.g. `id` and `joined_at`
    return new_user
