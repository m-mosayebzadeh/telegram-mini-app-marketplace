"""
Dev-only: fills in a full-looking Profile + a handful of Content items for
the "Sara" demo user (telegram_id=111222333 — the same one
app/dev/router.py's /dev/test-init-data mints by default), so the actual
running app can be compared against the profile design mockups instead of
an empty just-logged-in profile.

Run from the backend/ directory, with the same virtualenv the server
itself uses:

    python scripts/seed_demo_profile.py

Safe to re-run: it upserts the Profile row and replaces (deletes, then
recreates) this user's demo Content items each time rather than piling up
duplicates. It runs against whatever settings.database_url points at, which
is a local development database — there is no production data this could
touch.

It used to patch columns onto the profiles table by hand, from a time before
this project had migrations. It no longer does: Alembic owns the schema, and
a script that quietly alters tables alongside it is a second source of truth
waiting to disagree.
"""

import io
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from sqlalchemy import inspect, text  # noqa: E402
from PIL import Image  # noqa: E402

from app.core.database import Base, SessionLocal, engine  # noqa: E402
from app.core.config import settings  # noqa: E402
from app.models.content import Content, ContentAudience, ContentType  # noqa: E402
from app.models.profile import Profile  # noqa: E402
from app.models.profile_photo import ProfilePhoto  # noqa: E402
from app.models.user import User  # noqa: E402

DEMO_TELEGRAM_ID = 111222333
DEMO_DISPLAY_NAME = "Sara"
DEMO_USERNAME = "sara_dev"

# Jalali 1405/05/26 ("۲۶ مرداد") — the exact date used throughout the
# design mockups — converted to the Gregorian month/day this column
# actually stores (see lib/jalali.ts on the frontend for the reverse
# conversion used at display time).
DEMO_BIRTHDAY_GREGORIAN_MONTH = 8
DEMO_BIRTHDAY_GREGORIAN_DAY = 17

DEMO_BIO = "یه‌جایی بین آهنگ‌های آروم نیمه‌شب و حرف‌های بی‌وقفه؛ دنبال گفتگوهایی می‌گردم که غیرمنتظره باشن."
DEMO_LOCATION = "تهران"
DEMO_INTERESTS = ["موسیقی", "سفر", "فیلم و سریال", "کتاب"]
DEMO_AVATAR_URL = "https://i.pravatar.cc/300?img=47"

# A short-hand marker written into every demo Content's file path
# (demo_<slug>_<uuid>.jpg) so a re-run can find and replace exactly the
# rows this script owns, without touching anything a real upload created.
DEMO_FILE_PREFIX = "demo_"


def _gradient_jpeg_bytes(top_rgb: tuple[int, int, int], bottom_rgb: tuple[int, int, int]) -> bytes:
    """A plain top-to-bottom gradient square — just enough for the
    content grid to show something photo-shaped instead of a blank tile.
    No external image dependency beyond Pillow, which is already a
    project dependency (requirements.txt)."""
    size = 640
    image = Image.new("RGB", (size, size))
    pixels = image.load()
    for y in range(size):
        t = y / (size - 1)
        r = round(top_rgb[0] + (bottom_rgb[0] - top_rgb[0]) * t)
        g = round(top_rgb[1] + (bottom_rgb[1] - top_rgb[1]) * t)
        b = round(top_rgb[2] + (bottom_rgb[2] - top_rgb[2]) * t)
        for x in range(size):
            pixels[x, y] = (r, g, b)
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=82)
    return buffer.getvalue()


# (top, bottom) RGB pairs — loosely echoing the mockups' velvet/wine/ember
# tones, but these are just placeholder photo colors, independent of
# whichever --hp-* theme is active on the frontend.
DEMO_IMAGE_GRADIENTS = {
    "free_1": ((48, 28, 52), (85, 41, 62)),
    "free_2": ((34, 28, 44), (58, 40, 70)),
    "free_video": ((40, 30, 50), (70, 45, 85)),
    "spoiler": ((45, 30, 60), (30, 20, 38)),
    "premium": ((55, 40, 30), (35, 24, 20)),
}


def _save_demo_file(user_id: int, slug: str) -> str:
    directory = settings.uploads_dir / str(user_id)
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{DEMO_FILE_PREFIX}{slug}.jpg"
    top, bottom = DEMO_IMAGE_GRADIENTS[slug]
    path.write_bytes(_gradient_jpeg_bytes(top, bottom))
    return str(path)


def main() -> None:
    print("Ensuring tables/columns exist...")
    Base.metadata.create_all(engine)

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.telegram_id == DEMO_TELEGRAM_ID).first()
        if user is None:
            user = User(
                telegram_id=DEMO_TELEGRAM_ID,
                first_name=DEMO_DISPLAY_NAME,
                username=DEMO_USERNAME,
            )
            db.add(user)
            db.flush()
            print(f"Created demo user id={user.id}.")
        else:
            print(f"Found existing demo user id={user.id}.")

        profile = db.query(Profile).filter(Profile.user_id == user.id).first()
        if profile is None:
            profile = Profile(user_id=user.id)
            db.add(profile)

        # avatar_url is no longer a Profile column — see
        # app/models/profile_photo.py; only add a demo photo if this
        # user doesn't already have one, so re-running the script
        # doesn't pile up duplicates.
        if db.query(ProfilePhoto).filter(ProfilePhoto.user_id == user.id).first() is None:
            db.add(ProfilePhoto(user_id=user.id, url=DEMO_AVATAR_URL))
        profile.bio = DEMO_BIO
        profile.location = DEMO_LOCATION
        profile.interests = DEMO_INTERESTS
        profile.is_trusted = True
        profile.birthday_month = DEMO_BIRTHDAY_GREGORIAN_MONTH
        profile.birthday_day = DEMO_BIRTHDAY_GREGORIAN_DAY
        db.flush()
        print("Upserted demo profile (bio, avatar, interests, trust badge, birthday).")

        # Replace this user's previous demo content, if any, so re-running
        # the script doesn't pile up duplicates.
        old_demo_items = (
            db.query(Content)
            .filter(Content.user_id == user.id, Content.original_file_path.like(f"%/{DEMO_FILE_PREFIX}%"))
            .all()
        )
        for item in old_demo_items:
            Path(item.original_file_path).unlink(missing_ok=True)
            db.delete(item)
        db.flush()
        if old_demo_items:
            print(f"Replaced {len(old_demo_items)} previous demo content item(s).")

        demo_items = [
            dict(
                slug="free_1",
                content_type=ContentType.PHOTO,
                is_pinned=True,
            ),
            dict(
                slug="free_2",
                content_type=ContentType.PHOTO,
            ),
            dict(
                slug="free_video",
                content_type=ContentType.SHORT_VIDEO,
                duration_seconds=14,
            ),
            dict(
                slug="spoiler",
                content_type=ContentType.PHOTO,
                has_spoiler=True,
            ),
            dict(
                slug="premium",
                content_type=ContentType.PHOTO,
                has_spoiler=True,
                is_paid=True,
                price_drops=100,
            ),
        ]

        for item in demo_items:
            slug = item.pop("slug")
            path = _save_demo_file(user.id, slug)
            db.add(
                Content(
                    user_id=user.id,
                    original_file_path=path,
                    audience_type=ContentAudience.PUBLIC,
                    duration_seconds=item.pop("duration_seconds", None),
                    is_paid=item.pop("is_paid", False),
                    price_drops=item.pop("price_drops", None),
                    has_spoiler=item.pop("has_spoiler", False),
                    is_pinned=item.pop("is_pinned", False),
                    **item,
                )
            )

        db.commit()
        print(f"Seeded {len(demo_items)} demo content item(s) for user id={user.id}.")
        print(
            "\nDone. Log in as the dev user (GET /dev/test-init-data with "
            f"telegram_id={DEMO_TELEGRAM_ID}, or just reuse the existing dev "
            "login) and open the profile tab."
        )
    finally:
        db.close()


if __name__ == "__main__":
    main()
