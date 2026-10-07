"""
Turning notifications on and off for one browser (section 38).

The app asks the browser for permission only at a moment that explains
itself ("want to know when they answer?"), then hands the browser's
subscription here. One browser has one subscription; signing in to another
account on it moves the subscription to that account and that session.
"""

from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.auth.dependencies import current_session_id, get_current_user
from app.core.config import settings
from app.core.database import get_db
from app.models.push import PushSubscription
from app.models.user import User
from app.push import sender

router = APIRouter(prefix="/push", tags=["push"])


@router.get("/key")
def public_key() -> dict:
    """The key a browser subscribes with, or null when notifications are
    not set up on this server (and the app then never offers them)."""
    return {"key": settings.vapid_public_key if sender.ready() else None}


#: The push services browsers actually use (section 38): Google's (Chrome,
#: Android, Opera, Samsung, Brave), Mozilla's, Apple's and Microsoft's.
#: A browser reports which one it uses, but the report reaches us through
#: the page, so anybody can send any address; and the server later sends a
#: request to that address for every message. Accepting only these keeps
#: the server from being pointed at anything else — an internal service,
#: or somebody's site to be flooded. HTTPS then makes sure it really is them.
PUSH_HOSTS = {"fcm.googleapis.com", "android.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"}
#: Microsoft's endpoints carry a regional name in front ("wns2-db5p.notify.windows.com").
PUSH_HOST_SUFFIXES = (".notify.windows.com",)


def is_push_service(endpoint: str) -> bool:
    """A real push service's address: https, one of the known hosts, the
    normal port, nothing hidden in front of the host."""
    try:
        parts = urlsplit(endpoint)
        port = parts.port
    except ValueError:
        return False
    host = (parts.hostname or "").lower()
    if parts.scheme != "https" or parts.username or parts.password or port not in (None, 443):
        return False
    return host in PUSH_HOSTS or host.endswith(PUSH_HOST_SUFFIXES)


class Keys(BaseModel):
    p256dh: str = Field(max_length=200)
    auth: str = Field(max_length=100)


class SubscriptionIn(BaseModel):
    endpoint: str = Field(max_length=1000)
    keys: Keys


@router.post("/subscribe", status_code=status.HTTP_204_NO_CONTENT)
def subscribe(
    payload: SubscriptionIn,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    if not is_push_service(payload.endpoint):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail={"reason": "not_a_push_service"})
    session_id = current_session_id(request)
    if session_id is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail={"reason": "signed_out"})
    row = db.scalar(select(PushSubscription).where(PushSubscription.endpoint == payload.endpoint))
    if row is None:
        row = PushSubscription(endpoint=payload.endpoint, user_id=current_user.id, session_id=session_id, p256dh="", auth="")
        db.add(row)
    # The same browser, perhaps now signed in as somebody else.
    row.user_id = current_user.id
    row.session_id = session_id
    row.p256dh = payload.keys.p256dh
    row.auth = payload.keys.auth
    db.commit()


class PreviewIn(BaseModel):
    show: bool


@router.put("/preview", status_code=status.HTTP_204_NO_CONTENT)
def set_preview(
    payload: PreviewIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Whether my notifications show what a message says, or only who
    wrote it. For the person, on all their devices."""
    current_user.push_preview = payload.show
    db.commit()


class EndpointIn(BaseModel):
    endpoint: str = Field(max_length=1000)


@router.post("/unsubscribe", status_code=status.HTTP_204_NO_CONTENT)
def unsubscribe(
    payload: EndpointIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Notifications off on this browser."""
    db.execute(
        delete(PushSubscription).where(
            PushSubscription.endpoint == payload.endpoint, PushSubscription.user_id == current_user.id
        )
    )
    db.commit()
