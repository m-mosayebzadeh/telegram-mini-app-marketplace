"""
Shared test helpers — plain functions, not fixtures, so they're imported
explicitly wherever needed instead of being auto-injected like the
fixtures in conftest.py.
"""

import hashlib
import hmac
import io
import json
import time
from urllib.parse import urlencode

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.credit_ledger import CreditLedgerEntry, LedgerEntryType


def sign_init_data(user: dict) -> str:
    """Builds a validly-signed initData string, the same way Telegram does."""
    fields = {
        "auth_date": str(int(time.time())),
        "query_id": "AAFakeQueryId",
        "user": json.dumps(user, separators=(",", ":")),
    }
    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(fields.items()))
    secret_key = hmac.new(
        b"WebAppData", settings.telegram_bot_token.encode(), hashlib.sha256
    ).digest()
    fields["hash"] = hmac.new(
        secret_key, data_check_string.encode(), hashlib.sha256
    ).hexdigest()
    return urlencode(fields)


def make_test_image_bytes() -> bytes:
    """
    A tiny valid JPEG, generated in memory — good enough for upload
    tests, without needing a real image file checked into the repo.
    """
    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", (40, 40), color=(255, 0, 0)).save(buffer, format="JPEG")
    return buffer.getvalue()


def give_wallet_balance(db_session: Session, user_id: int, amount_toman: int) -> None:
    """
    Directly credits `user_id`'s wallet for test setup, bypassing HTTP
    entirely — the real top-up endpoint only exists when dev tools are
    enabled, and tests deliberately run with them off (matching
    production; see conftest.py's `db_session` fixture docstring). Uses
    the same TOPUP_DEV_STUB ledger entry type the real dev endpoint uses.
    """
    db_session.add(
        CreditLedgerEntry(
            user_id=user_id, amount_toman=amount_toman, type=LedgerEntryType.TOPUP_DEV_STUB
        )
    )
    db_session.commit()


def sign_in(client, db_session: Session, telegram_id: int, first_name: str = "Test") -> None:
    """Gives this test client a real sign-in session cookie for a test
    person, created first if needed — for the tests about sessions and the
    live connection, which must go through the real cookie path rather than
    the test header (tests/signed_in.py)."""
    from app.auth import sessions
    from app.models.user import User

    client.get("/me", headers={"X-Telegram-Init-Data": sign_init_data({"id": telegram_id, "first_name": first_name})})
    user = db_session.query(User).filter_by(telegram_id=telegram_id).one()
    token = sessions.start_session(db_session, user, provider="telegram", user_agent="test")
    client.cookies.set(sessions.COOKIE, token)


def session_cookie_for(client, telegram_id: int, first_name: str = "Test") -> None:
    """Like sign_in, for tests without a db_session at hand: sets this
    client's session cookie for a test person, through the test database
    the client is wired to."""
    from app.auth import sessions
    from app.core.database import get_db
    from app.main import app
    from app.models.user import User

    client.get("/me", headers={"X-Telegram-Init-Data": sign_init_data({"id": telegram_id, "first_name": first_name})})
    gen = app.dependency_overrides[get_db]()
    db = next(gen)
    try:
        user = db.query(User).filter_by(telegram_id=telegram_id).one()
        token = sessions.start_session(db, user, provider="telegram", user_agent="test")
    finally:
        gen.close()
    client.cookies.set(sessions.COOKIE, token)
