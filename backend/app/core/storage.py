"""
Local disk storage for uploaded photos.

Files live at backend/uploads/{user.id}/{uuid}_original.<ext>, plus a
matching _blurred.<ext> ONLY when the photo actually needs one (most
photos are expected to be public and unblurred — no reason to spend
processing time or disk space blurring those).

Two deliberate choices, both security-driven (see the conversation that
led here):
  - The folder is named after our own internal `User.id`, never
    telegram_id — a path like this is exactly the kind of thing that
    ends up embedded in a signed URL later, and telegram_id must never
    be exposed to other users (TECHNICAL_REQUIREMENTS.md, section 5).
  - File names are random UUIDs, not sequential ids, so a leaked path
    can't be used to guess/enumerate someone else's other photos.

For local development only. Swapping this out for real object storage
(S3-compatible) later only changes what save_photo_files() returns (a
storage key/URL instead of a local path) — Photo.original_file_path /
blurred_file_path are already just opaque strings, so nothing else in
the app needs to change.
"""

import uuid
from pathlib import Path

from fastapi import UploadFile
from PIL import Image, ImageFilter

from app.core.config import settings

# How strong the blur is — high enough that the underlying image is
# genuinely unrecognizable, not just slightly softened.
BLUR_RADIUS = 30


def _user_dir(user_id: int) -> Path:
    # Read settings.uploads_dir freshly each call (not a module-level
    # constant) so tests can point it at a temp directory — see
    # tests/conftest.py.
    directory = settings.uploads_dir / str(user_id)
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def save_photo_files(
    user_id: int, upload: UploadFile, *, should_blur: bool
) -> tuple[str, str | None]:
    """
    Saves the uploaded file to disk, and — only when should_blur is True
    — also generates and saves a blurred copy next to it.

    Returns (original_path, blurred_path_or_None), ready to store
    directly in Photo.original_file_path / Photo.blurred_file_path.
    """
    directory = _user_dir(user_id)
    extension = Path(upload.filename or "").suffix or ".jpg"
    photo_uuid = uuid.uuid4().hex

    original_path = directory / f"{photo_uuid}_original{extension}"
    with original_path.open("wb") as destination:
        destination.write(upload.file.read())

    if not should_blur:
        return str(original_path), None

    blurred_path = directory / f"{photo_uuid}_blurred{extension}"
    with Image.open(original_path) as image:
        blurred = image.filter(ImageFilter.GaussianBlur(BLUR_RADIUS))
        # Flatten to RGB before saving as JPEG-compatible formats can't
        # hold e.g. a PNG's alpha channel; safe for any input format.
        blurred.convert("RGB").save(blurred_path)

    return str(original_path), str(blurred_path)


def delete_photo_files(*paths: str | None) -> None:
    """Best-effort cleanup — used when a Photo row is deleted."""
    for path in paths:
        if path:
            Path(path).unlink(missing_ok=True)
