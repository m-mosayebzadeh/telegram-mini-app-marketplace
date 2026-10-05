"""
How the tests say who is asking — a test-only shortcut, never part of the
app.

The app knows people only by their sign-in session's cookie
(app/auth/sessions.py). Hundreds of tests act as several people in turn
through one client, by passing `_auth(telegram_id)` headers; rewriting each
of them to juggle cookies would test nothing new. So in tests only, the
current-user dependency is replaced: a request carrying a test person's
header acts as that person (created the first time, through the very same
user_from_telegram that development and bot sign-in use), and any other
request goes through the real cookie check unchanged.

The header is the shape tests/helpers.sign_init_data builds. It is not
checked for a signature: nothing outside a test can reach this code.
"""

import json
from urllib.parse import parse_qsl

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user, user_from_telegram
from app.auth.telegram import TelegramUser
from app.core.database import get_db
from app.models.user import User

HEADER = "X-Telegram-Init-Data"


def current_user_for_tests(request: Request, db: Session = Depends(get_db)) -> User:
    raw = request.headers.get(HEADER)
    if raw:
        fields = dict(parse_qsl(raw))
        person = json.loads(fields["user"])
        return user_from_telegram(
            db,
            TelegramUser(
                id=int(person["id"]),
                first_name=person.get("first_name") or "Test",
                last_name=person.get("last_name"),
                username=person.get("username"),
            ),
        )
    return get_current_user(request, db)
