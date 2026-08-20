"""
Validation of Telegram Mini App init data (initData).

When the mini app is opened inside Telegram, Telegram gives the frontend
JavaScript a string called initData. It contains user info (id, name, ...)
plus a signature (the "hash" field). The frontend forwards this string
as-is to the backend (e.g. in an HTTP header), and our job here is to make
sure it was really signed by Telegram and hasn't been tampered with.

Official Telegram algorithm (Telegram Mini Apps docs):
    1. Parse the initData string into key=value pairs (like a query string).
    2. Extract the "hash" field and remove it from the other fields.
    3. Sort the remaining fields alphabetically by key.
    4. Join them with a newline ("\\n") as "key=value" lines; this joined
       string is called the "data-check-string".
    5. Derive a "secret key": HMAC-SHA256 with the fixed key "WebAppData"
       and the bot token as the message.
    6. Using that secret key, compute HMAC-SHA256 over the
       data-check-string.
    7. Compare the result (as hex) to the "hash" field. If they match, the
       data genuinely came from Telegram and hasn't been altered.

Why HMAC? Because only whoever has the bot token (i.e. Telegram itself,
since we keep the token secret) can produce a valid signature. If a user
or attacker manually edits the "user" or "auth_date" value, the signature
no longer matches the content and step 7 fails.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import time
from dataclasses import dataclass
from urllib.parse import parse_qsl


class TelegramAuthError(Exception):
    """Base class for any error related to initData validation."""


class InvalidSignatureError(TelegramAuthError):
    """The signature doesn't match — the data is forged or tampered with."""


class ExpiredInitDataError(TelegramAuthError):
    """The signature is valid, but the data is too old (past max age)."""


class MissingFieldError(TelegramAuthError):
    """A required field (hash or auth_date) was missing from initData."""


@dataclass(frozen=True)
class TelegramUser:
    """User info extracted from the "user" field inside initData."""

    id: int
    first_name: str
    last_name: str | None = None
    username: str | None = None
    is_premium: bool = False


def _build_data_check_string(fields: dict[str, str]) -> str:
    """Sorts fields alphabetically and joins them into a single string."""
    sorted_items = sorted(fields.items())
    return "\n".join(f"{key}={value}" for key, value in sorted_items)


def _compute_signature(data_check_string: str, bot_token: str) -> str:
    """Computes the expected signature per Telegram's algorithm."""
    secret_key = hmac.new(
        key=b"WebAppData",
        msg=bot_token.encode("utf-8"),
        digestmod=hashlib.sha256,
    ).digest()

    return hmac.new(
        key=secret_key,
        msg=data_check_string.encode("utf-8"),
        digestmod=hashlib.sha256,
    ).hexdigest()


def validate_init_data(
    init_data: str,
    bot_token: str,
    max_age_seconds: int,
) -> TelegramUser:
    """
    Validates initData and returns the user info if it's valid.
    Raises one of the TelegramAuthError subclasses if it's invalid or
    expired.
    """
    # 1. Parse the string into key-value pairs.
    #    keep_blank_values=True means keep empty fields instead of dropping
    #    them.
    parsed_fields = dict(parse_qsl(init_data, keep_blank_values=True))

    # 2. Pull out the hash field; it's not part of the data being signed.
    received_hash = parsed_fields.pop("hash", None)
    if not received_hash:
        raise MissingFieldError("initData is missing the 'hash' field.")

    # 3 and 4. Build the data-check-string.
    data_check_string = _build_data_check_string(parsed_fields)

    # 5 and 6. Compute the expected signature.
    expected_hash = _compute_signature(data_check_string, bot_token)

    # 7. Compare using constant-time comparison (compare_digest) instead of
    #    a plain "==". This prevents timing attacks: with a plain "==",
    #    Python stops comparing at the first differing character, so an
    #    attacker could use response timing to guess the hash one
    #    character at a time. compare_digest always takes the same amount
    #    of time regardless of where the difference is.
    if not hmac.compare_digest(received_hash, expected_hash):
        raise InvalidSignatureError("initData signature is invalid.")

    # Now that we know the data came from Telegram, check how fresh it is.
    auth_date_raw = parsed_fields.get("auth_date")
    if not auth_date_raw:
        raise MissingFieldError("initData is missing the 'auth_date' field.")

    auth_timestamp = int(auth_date_raw)
    age_seconds = time.time() - auth_timestamp
    if age_seconds > max_age_seconds:
        raise ExpiredInitDataError(
            f"initData has expired (age is {int(age_seconds)} seconds)."
        )

    # The "user" field arrives as a JSON string inside initData, so it
    # needs to be decoded.
    user_raw = parsed_fields.get("user")
    if not user_raw:
        raise MissingFieldError("initData is missing the 'user' field.")

    user_data = json.loads(user_raw)

    return TelegramUser(
        id=user_data["id"],
        first_name=user_data.get("first_name", ""),
        last_name=user_data.get("last_name"),
        username=user_data.get("username"),
        is_premium=user_data.get("is_premium", False),
    )
