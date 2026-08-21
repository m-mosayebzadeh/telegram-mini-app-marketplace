"""
Application entry point. Run locally with:
    uvicorn app.main:app --reload
"""

from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI

from app.auth.dependencies import get_current_user
from app.core.config import settings
from app.core.database import Base, engine
from app.models import User  # importing app.models registers every model with Base


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


@app.get("/me")
def read_current_user(current_user: User = Depends(get_current_user)) -> dict:
    """
    Returns the authenticated user's own record.

    This is the first real proof that the whole chain works end to end:
    request → X-Telegram-Init-Data header → validate_init_data →
    TelegramUser → get_current_user → our own User row.
    """
    return {
        "id": current_user.id,
        "telegram_id": current_user.telegram_id,
        "display_name": current_user.display_name,
        "username": current_user.username,
        "status": current_user.status.value,
        "joined_at": current_user.joined_at.isoformat(),
    }
