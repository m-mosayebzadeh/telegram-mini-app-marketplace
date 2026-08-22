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
from PIL import Image, ImageFilter, ImageOps

from app.core.config import settings

# The blurred copy is built by shrinking the photo down to a tiny
# thumbnail and stretching it back up — the same trick Telegram (and
# most chat apps) use for blurred previews. It produces soft, large
# blocks of averaged color ("frosted glass") instead of the harsher,
# more detailed haze a plain Gaussian blur leaves when applied directly
# to a full-resolution image.
BLUR_THUMBNAIL_SIZE = 32  # longest side, in pixels, for the shrink step
# A light blur pass after stretching back up, just to soften the harder
# edges the upscale step leaves between those color blocks.
BLUR_FINAL_RADIUS = 2


def _user_dir(user_id: int) -> Path:
    # Read settings.uploads_dir freshly each call (not a module-level
    # constant) so tests can point it at a temp directory — see
    # tests/conftest.py.
    directory = settings.uploads_dir / str(user_id)
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def _make_blurred_copy(image: Image.Image) -> Image.Image:
    """
    Builds the blurred version of an uploaded photo. Two things happen
    here, in this order, and the order matters:

      1. Bake the photo's EXIF orientation into the actual pixels.
         Phones commonly save a photo "sideways" in raw pixels, plus an
         EXIF tag saying "rotate me on display". A normal viewer opening
         the *original* file reads that tag and shows it correctly. But
         when Pillow re-saves an image — as we do here, for the blurred
         copy — that EXIF tag is dropped, so a viewer opening the
         blurred file has nothing telling it to rotate and shows the
         raw, sideways pixels instead. ImageOps.exif_transpose() reads
         the tag first and physically rotates/flips the pixels to
         match, so the file we save afterwards looks right on its own,
         without depending on any tag surviving the save.
      2. Shrink the now-correctly-oriented image down to a tiny
         thumbnail, then stretch it back up to that same size. This is
         the "frosted glass" trick described next to BLUR_THUMBNAIL_SIZE
         above — it must run on already-oriented pixels, otherwise the
         blurred result would still end up sideways even though the
         rotation was "fixed" a moment ago.
    """
    # exif_transpose() returns a new image, or the same image unchanged
    # if there was no orientation tag to apply — the `or image` guards
    # the (documented, if rare) case where it returns None.
    oriented = ImageOps.exif_transpose(image) or image
    original_size = oriented.size

    # thumbnail() resizes in place, preserves aspect ratio, and never
    # enlarges — exactly the shrink step we want (we do the upscale
    # ourselves next, back to the exact original size).
    thumbnail = oriented.copy()
    thumbnail.thumbnail((BLUR_THUMBNAIL_SIZE, BLUR_THUMBNAIL_SIZE), Image.BILINEAR)

    # Stretch back up. BILINEAR is deliberately soft — BICUBIC/LANCZOS
    # would sharpen detail back in, undoing the point of blurring.
    blurred = thumbnail.resize(original_size, Image.BILINEAR)
    blurred = blurred.filter(ImageFilter.GaussianBlur(BLUR_FINAL_RADIUS))

    # Flatten to RGB before saving as JPEG-compatible formats can't hold
    # e.g. a PNG's alpha channel; safe for any input format.
    return blurred.convert("RGB")


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
        _make_blurred_copy(image).save(blurred_path)

    return str(original_path), str(blurred_path)


def delete_photo_files(*paths: str | None) -> None:
    """Best-effort cleanup — used when a Photo row is deleted."""
    for path in paths:
        if path:
            Path(path).unlink(missing_ok=True)
