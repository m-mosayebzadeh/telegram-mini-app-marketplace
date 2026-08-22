"""
Local disk storage for uploaded photos.

Files live at backend/uploads/{user.id}/{uuid}<ext>. Two deliberate
choices, both security-driven (see the conversation that led here):
  - The folder is named after our own internal `User.id`, never
    telegram_id — a path like this is exactly the kind of thing that
    ends up embedded in a signed URL later, and telegram_id must never
    be exposed to other users (TECHNICAL_REQUIREMENTS.md, section 5).
  - File names are random UUIDs, not sequential ids, so a leaked path
    can't be used to guess/enumerate someone else's other photos.

There is only ONE stored file per photo — no separate blurred/spoiler
copy. A "spoiler" photo is a generic overlay drawn by the frontend, not
a different image; access control still happens the same way it always
did, at the API layer (see app/photo/access.py), before these bytes are
ever served.

For local development only. Swapping this out for real object storage
(S3-compatible) later only changes what save_photo_file() returns (a
storage key/URL instead of a local path) — Photo.original_file_path is
already just an opaque string, so nothing else in the app needs to change.
"""

import uuid
from pathlib import Path

from fastapi import UploadFile

from app.core.config import settings


def _user_dir(user_id: int) -> Path:
    # Read settings.uploads_dir freshly each call (not a module-level
    # constant) so tests can point it at a temp directory — see
    # tests/conftest.py.
    directory = settings.uploads_dir / str(user_id)
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def save_photo_file(user_id: int, upload: UploadFile) -> str:
    """Saves the uploaded file to disk and returns its path, ready to
    store directly in Photo.original_file_path."""
    directory = _user_dir(user_id)
    extension = Path(upload.filename or "").suffix or ".jpg"
    path = directory / f"{uuid.uuid4().hex}{extension}"

    with path.open("wb") as destination:
        destination.write(upload.file.read())

    return str(path)


def delete_photo_file(path: str | None) -> None:
    """Best-effort cleanup — used when a Photo row is deleted."""
    if path:
        Path(path).unlink(missing_ok=True)
