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
duplicates. Never runs against anything but the local SQLite dev database
this project already uses (settings.database_url) — there is no
production data this could touch.

This is exactly the kind of one-off dev fixture TECHNICAL_REQUIREMENTS.md
already expects for schema changes on the local SQLite file (no real
migration tool is set up yet — see the project's repo-status notes): it
also ALTERs the profiles table in place to add the columns this seed data
needs (is_trusted, birthday_month, birthday_day), so this script doubles
as that migration. It is not a general migration tool — just enough to
get this one table's new columns onto an existing local app.db without
losing whatever else is already in it (follows, offers, wallet history).
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


def _ensure_profile_columns() -> None:
    """ALTERs the (SQLite-only) profiles table in place if this is an
    existing app.db from before is_trusted/birthday_month/birthday_day
    existed. A no-op on a fresh database, where create_all() below
    already creates the columns — and a no-op on a second run, since it
    checks the actual column list first rather than blindly ALTERing."""
    if not settings.database_url.startswith("sqlite"):
        print("Non-SQLite database_url — skipping ALTER TABLE (add the columns yourself).")
        return

    inspector = inspect(engine)
    if "profiles" not in inspector.get_table_names():
        return  # create_all() below will create it with the new columns already.

    existing = {col["name"] for col in inspector.get_columns("profiles")}
    statements = []
    if "is_trusted" not in existing:
        statements.append("ALTER TABLE profiles ADD COLUMN is_trusted BOOLEAN NOT NULL DEFAULT 0")
    if "birthday_month" not in existing:
        statements.append("ALTER TABLE profiles ADD COLUMN birthday_month INTEGER")
    if "birthday_day" not in existing:
        statements.append("ALTER TABLE profiles ADD COLUMN birthday_day INTEGER")

    if not statements:
        return

    with engine.begin() as conn:
        for stmt in statements:
            print(f"  {stmt}")
            conn.execute(text(stmt))


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
    _ensure_profile_columns()

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.telegram_id == DEMO_TELEGRAM_ID).first()
        if user is None:
            user = User(
                telegram_id=DEMO_TELEGRAM_ID,
                display_name=DEMO_DISPLAY_NAME,
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

        profile.avatar_url = DEMO_AVATAR_URL
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
                price_stars=100,
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
                    price_stars=item.pop("price_stars", None),
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
