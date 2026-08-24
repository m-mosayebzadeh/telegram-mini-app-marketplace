"""
Application entry point. Run locally with:
    uvicorn app.main:app --reload
"""

from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.core.config import settings
from app.core.database import Base, engine, get_db
from app.audience_group.router import router as audience_group_router
from app.chat_session.router import router as chat_session_router
from app.content.router import router as content_router
from app.follow.router import router as follow_router
from app.models import User  # importing app.models registers every model with Base
from app.models.follow import Follow, FollowStatus
from app.offer.router import router as offer_router
from app.profile.router import public_router as public_profile_router
from app.profile.router import router as profile_router
from app.request.router import router as request_router
from app.wallet.router import router as wallet_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # For local development only: creates any tables that don't exist yet,
    # based on the models imported above (e.g. User). This is fine for now
    # with SQLite, but is not how schema changes are managed once we move
    # to Postgres — at that point we'll use a proper migration tool
    # instead of create_all, so existing data isn't wiped or left out of
    # sync.
    #
    # This runs when the app actually *starts* (not merely on import).
    # That distinction matters for tests: test_me_endpoint.py imports
    # this module but never starts it, so it never touches the real
    # database file — it wires up its own isolated one instead.
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(title="Telegram Mini App Marketplace API", lifespan=lifespan)

app.include_router(profile_router)
app.include_router(public_profile_router)
app.include_router(follow_router)
app.include_router(audience_group_router)
app.include_router(content_router)
app.include_router(offer_router)
app.include_router(request_router)
app.include_router(wallet_router)
app.include_router(chat_session_router)

# Only wire up developer-only routes (see app/dev/router.py) when the
# flag is explicitly turned on. Since it defaults to False, forgetting to
# set it just means those routes don't exist — the safe failure mode.
if settings.enable_dev_tools:
    from app.dev.router import router as dev_router

    app.include_router(dev_router)


@app.get("/health")
def health_check() -> dict[str, str]:
    """Simple endpoint to confirm the server is running, no auth needed."""
    return {"status": "ok"}


@app.get("/pricing")
def read_pricing_config(
    current_user: User = Depends(get_current_user),  # requires auth; not otherwise used
) -> dict:
    """
    The current Star-to-Toman rate and commission percentages (see
    TECHNICAL_REQUIREMENTS.md section 10 and app/core/config.py) — a
    provider setting an offer's price needs these client-side, to show
    "X Stars = Y Toman, Z commission, W net" as they type, without a
    round trip per keystroke. These are phase-1 constants today (fixed
    in settings, not a database table an admin panel edits yet), so this
    endpoint's response is the same for everyone right now — but every
    screen already reads it from here instead of hardcoding the numbers,
    so nothing else has to change once phase 2 makes them dynamic.
    """
    return {
        "star_to_toman_rate": settings.star_to_toman_rate,
        "chat_commission_percent": settings.chat_commission_percent,
        "content_commission_percent": settings.content_commission_percent,
    }


@app.get("/me")
def read_current_user(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> dict:
    """
    Returns the authenticated user's own record.

    This is the first real proof that the whole chain works end to end:
    request → X-Telegram-Init-Data header → validate_init_data →
    TelegramUser → get_current_user → our own User row.
    """
    pending_follow_requests_count = (
        db.query(Follow)
        .filter(Follow.followee_id == current_user.id, Follow.status == FollowStatus.PENDING)
        .count()
    )
    return {
        "id": current_user.id,
        "telegram_id": current_user.telegram_id,
        "display_name": current_user.display_name,
        "username": current_user.username,
        "status": current_user.status.value,
        "joined_at": current_user.joined_at.isoformat(),
        # Shown as a badge on the Profile tab (see GET
        # /follow/incoming-requests for the full inbox) — checked every
        # time the app loads, since there's no push-notification system
        # yet (TECHNICAL_REQUIREMENTS.md section 9 still has that as an
        # undone idea).
        "pending_follow_requests_count": pending_follow_requests_count,
    }
