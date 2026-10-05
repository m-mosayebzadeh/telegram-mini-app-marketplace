"""
Developer-only routes. NEVER include this router unless
settings.enable_dev_tools is True (see app/main.py) — see the warning in
app/core/config.py for why.

One route: signing a browser in as a development person, with a real
session (app/auth/sessions.py) — what the development sign-in screen uses.
It used to mint Telegram launch data for tools like Bruno; that went when
the app stopped being opened inside Telegram (TECHNICAL_REQUIREMENTS.md
section 32).
"""

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.auth import sessions
from app.auth.dependencies import user_from_telegram
from app.auth.telegram import TelegramUser
from app.core.database import get_db
from app.models.auth_session import PROVIDER_DEV
from pydantic import BaseModel

router = APIRouter(prefix="/dev", tags=["dev-tools (local only)"])


def _require_localhost(request: Request) -> None:
    """
    Extra safety net on top of the enable_dev_tools flag: even when dev
    tools are on, only allow this from the machine running the server.

    We return 404 (not 403) so a probing outsider can't even tell this
    route exists.
    """
    client_host = request.client.host if request.client else None
    if client_host not in {"127.0.0.1", "::1"}:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)


class DevSignInIn(BaseModel):
    telegram_id: int
    first_name: str = "Test"
    username: str | None = None


@router.post("/sign-in", status_code=status.HTTP_204_NO_CONTENT)
def dev_sign_in(
    payload: DevSignInIn,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> None:
    """Signs this browser in as a development person (the picker on the
    development sign-in screen), with a real session cookie — the same
    session every way in ends with (app/auth/sessions.py), so local
    development exercises the real thing. Local only, like everything here.
    """
    _require_localhost(request)
    user = user_from_telegram(
        db, TelegramUser(id=payload.telegram_id, first_name=payload.first_name, username=payload.username)
    )
    token = sessions.start_session(db, user, provider=PROVIDER_DEV, user_agent=request.headers.get("user-agent"))
    sessions.set_cookie(response, token)
