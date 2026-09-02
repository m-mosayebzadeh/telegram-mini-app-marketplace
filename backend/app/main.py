"""
Application entry point. Run locally with:
    uvicorn app.main:app --reload
"""

import re
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.core.config import settings
from app.core.database import get_db
from app.core.migrate import run_migrations
from app.admin.router import router as admin_router
from app.audience_group.router import router as audience_group_router
from app.chat_message.router import router as chat_message_router
from app.chat_session.router import router as chat_session_router
from app.content.router import router as content_router
from app.follow.router import router as follow_router
from app.models import User  # importing app.models registers every model with Base
from app.models.follow import Follow, FollowStatus
from app.models.offer import Offer
from app.models.request import Request
from app.offer.router import router as offer_router
from app.profile.router import public_router as public_profile_router
from app.profile.router import router as profile_router
from app.request.router import router as request_router
from app.topup.router import router as topup_router
from app.wallet.router import router as wallet_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Brings the database up to date with every model change, whether
    # that's a brand new table or a new column on an existing one — see
    # app/core/migrate.py's docstring for the real incident that made
    # this matter (a stale local database on one machine, from before a
    # column was added, silently erroring on every request that touched
    # it). Safe to run on every startup: a database already at the
    # latest migration is simply a no-op.
    #
    # This runs when the app actually *starts* (not merely on import).
    # That distinction matters for tests: test_me_endpoint.py imports
    # this module but never starts it, so it never touches the real
    # database file — it wires up its own isolated one instead.
    run_migrations()
    yield


app = FastAPI(title="Telegram Mini App Marketplace API", lifespan=lifespan)

# The ONLY plain, unauthenticated static mount in the app — safe here
# specifically because a profile avatar is already fully public with no
# audience/spoiler rule (see PublicProfileOut). Content's own uploaded
# files live in a completely separate, non-mounted directory
# (uploads/{user_id}/..., vs. avatars' uploads/avatars/{user_id}/...)
# and stay reachable only through the access-checked /content/{id}/file
# route — see app/core/storage.py's module docstring.
settings.uploads_dir.mkdir(parents=True, exist_ok=True)
(settings.uploads_dir / "avatars").mkdir(parents=True, exist_ok=True)
app.mount("/avatars", StaticFiles(directory=str(settings.uploads_dir / "avatars")), name="avatars")

app.include_router(profile_router)
app.include_router(public_profile_router)
app.include_router(follow_router)
app.include_router(audience_group_router)
app.include_router(content_router)
app.include_router(offer_router)
app.include_router(request_router)
app.include_router(wallet_router)
app.include_router(chat_session_router)
app.include_router(chat_message_router)
app.include_router(topup_router)
app.include_router(admin_router)

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
    # Whether ANY of this user's own offers has a request they haven't
    # seen yet (see app/offer/router.py's list_offers and
    # app/request/router.py's list_requests_for_offer, which together
    # own the actual per-offer counting/clearing) — just a boolean here,
    # for the bottom nav's plain "something needs attention" dot (see
    # App.tsx), which has no room for — and doesn't need — an exact
    # number. Same "checked on every app load" limitation as
    # pending_follow_requests_count above, until a real push-notification
    # system exists (TECHNICAL_REQUIREMENTS.md section 9).
    has_unseen_requests = (
        db.query(Request)
        .join(Offer, Request.offer_id == Offer.id)
        .filter(
            Offer.provider_id == current_user.id,
            or_(
                Offer.requests_last_viewed_at.is_(None),
                Request.created_at > Offer.requests_last_viewed_at,
            ),
        )
        .first()
        is not None
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
        "has_unseen_requests": has_unseen_requests,
    }


# a-z, A-Z, 0-9, and underscore only — matches what the product asked
# for, not Telegram's own (stricter) @username rules, since this is our
# app's own username, independent of the user's real Telegram handle.
USERNAME_PATTERN = re.compile(r"^[a-zA-Z0-9_]{3,32}$")


class UsernameUpdate(BaseModel):
    username: str = Field(min_length=1, max_length=64)


@app.put("/me/username")
def update_username(
    payload: UsernameUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """
    Lets a user pick their own in-app username (separate from their real
    Telegram @username — see User.username's docstring). Two distinct,
    checkable error reasons on failure (not just one generic 400) so the
    frontend can show the right hint: "invalid_characters" for anything
    outside a-zA-Z0-9_ or the wrong length, "username_taken" if someone
    else already has it.
    """
    if not USERNAME_PATTERN.match(payload.username):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, {"reason": "invalid_characters"})

    # Checked up front (not just left to the database's unique
    # constraint) so a taken username gets its own clear reason instead
    # of a generic "integrity error" — the constraint itself stays as a
    # second line of defense against a race between this check and the
    # commit below (caught right after).
    taken = (
        db.query(User)
        .filter(User.username == payload.username, User.id != current_user.id)
        .first()
    )
    if taken is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, {"reason": "username_taken"})

    current_user.username = payload.username
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, {"reason": "username_taken"}) from None

    return {"username": current_user.username}
