"""
Unit tests for validate_init_data: pure logic only, no FastAPI, no
database, no server involved. See test_me_endpoint.py for a test that
exercises the full HTTP request chain instead.
"""

import hashlib
import hmac
import json
import time
from urllib.parse import urlencode

import pytest

from app.auth.telegram import (
    ExpiredInitDataError,
    InvalidSignatureError,
    MissingFieldError,
    validate_init_data,
)

BOT_TOKEN = "test-bot-token-for-pytest-only"


def _user_fields(auth_date: str | None = None) -> dict:
    """The set of fields a real Telegram initData would contain, before signing."""
    user = {"id": 42, "first_name": "Test", "username": "test_user"}
    return {
        "auth_date": auth_date or str(int(time.time())),
        "query_id": "AAFakeQueryId",
        "user": json.dumps(user, separators=(",", ":")),
    }


def _sign_init_data(fields: dict) -> str:
    """Signs `fields` the same way Telegram does and returns the full initData string."""
    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(fields.items()))
    secret_key = hmac.new(b"WebAppData", BOT_TOKEN.encode(), hashlib.sha256).digest()
    signature = hmac.new(
        secret_key, data_check_string.encode(), hashlib.sha256
    ).hexdigest()
    return urlencode({**fields, "hash": signature})


def test_valid_init_data_returns_telegram_user():
    init_data = _sign_init_data(_user_fields())

    user = validate_init_data(init_data, bot_token=BOT_TOKEN, max_age_seconds=3600)

    assert user.id == 42
    assert user.first_name == "Test"
    assert user.username == "test_user"


def test_tampered_content_is_rejected():
    init_data = _sign_init_data(_user_fields())
    # Changes signed content (the name inside the "user" JSON) without
    # recomputing the hash — simulates someone editing the data by hand.
    tampered = init_data.replace("Test", "Hacked")

    with pytest.raises(InvalidSignatureError):
        validate_init_data(tampered, bot_token=BOT_TOKEN, max_age_seconds=3600)


def test_wrong_bot_token_is_rejected():
    init_data = _sign_init_data(_user_fields())

    with pytest.raises(InvalidSignatureError):
        validate_init_data(init_data, bot_token="a-different-token", max_age_seconds=3600)


def test_expired_init_data_is_rejected():
    old_timestamp = int(time.time()) - 1000
    init_data = _sign_init_data(_user_fields(auth_date=str(old_timestamp)))

    with pytest.raises(ExpiredInitDataError):
        validate_init_data(init_data, bot_token=BOT_TOKEN, max_age_seconds=500)


def test_missing_hash_field_is_rejected():
    # Deliberately skip signing: no "hash" field at all.
    init_data = urlencode(_user_fields())

    with pytest.raises(MissingFieldError):
        validate_init_data(init_data, bot_token=BOT_TOKEN, max_age_seconds=3600)


def test_missing_auth_date_is_rejected():
    fields = _user_fields()
    del fields["auth_date"]
    init_data = _sign_init_data(fields)

    with pytest.raises(MissingFieldError):
        validate_init_data(init_data, bot_token=BOT_TOKEN, max_age_seconds=3600)
