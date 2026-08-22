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

    Deliberately a checkerboard, not a flat color: a Gaussian blur of a
    perfectly uniform image produces that exact same uniform image
    (every pixel already equals the average of its neighbors), which
    would make "is the blurred version actually different?" tests
    falsely pass or fail. A checkerboard has real contrast for blur to
    visibly smooth out.
    """
    from PIL import Image, ImageDraw

    image = Image.new("RGB", (40, 40), color=(255, 255, 255))
    draw = ImageDraw.Draw(image)
    for x in range(0, 40, 10):
        for y in range(0, 40, 10):
            if (x // 10 + y // 10) % 2 == 0:
                draw.rectangle([x, y, x + 10, y + 10], fill=(0, 0, 0))

    buffer = io.BytesIO()
    image.save(buffer, format="JPEG")
    return buffer.getvalue()


def make_test_image_bytes_with_orientation(*, orientation: int, size: tuple[int, int]) -> bytes:
    """
    A plain JPEG of the given raw pixel `size`, tagged with an EXIF
    Orientation value telling viewers to rotate/flip it on display —
    the same way a phone camera saves a photo taken sideways (raw
    pixels one way, a tag saying "rotate me" on top).

    Used to test that blurring a photo corrects its orientation first
    (see test_storage.py) instead of silently dropping the tag the way
    a naive re-save would.
    """
    from PIL import Image

    image = Image.new("RGB", size, color=(255, 255, 255))
    exif = Image.Exif()
    exif[0x0112] = orientation  # 0x0112 is the standard EXIF "Orientation" tag id

    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", exif=exif.tobytes())
    return buffer.getvalue()
