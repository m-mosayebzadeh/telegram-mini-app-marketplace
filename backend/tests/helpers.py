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

from app.core.config import settings


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
