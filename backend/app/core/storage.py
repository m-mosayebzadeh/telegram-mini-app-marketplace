"""
Local disk storage for uploaded content (photos and short videos).

Files live at backend/uploads/{user.id}/{uuid}<ext>. Two deliberate
choices, both security-driven (see the conversation that led here):
  - The folder is named after our own internal `User.id`, never
    telegram_id — a path like this is exactly the kind of thing that
    ends up embedded in a signed URL later, and telegram_id must never
    be exposed to other users (TECHNICAL_REQUIREMENTS.md, section 5).
  - File names are random UUIDs, not sequential ids, so a leaked path
    can't be used to guess/enumerate someone else's other content.

There is only ONE stored file per content item — no separate
blurred/spoiler copy. A "spoiler" item is a generic overlay drawn by the
frontend, not a different file; access control still happens the same
way it always did, at the API layer (see app/content/access.py), before
these bytes are ever served.

For local development only. Swapping this out for real object storage
(S3-compatible) later only changes what save_content_file() returns (a
storage key/URL instead of a local path) — Content.original_file_path is
already just an opaque string, so nothing else in the app needs to change.
"""

import uuid
from pathlib import Path

from fastapi import HTTPException, UploadFile, status

from app.core.config import settings
from app.models.content import MAX_UPLOAD_SIZE_BYTES


def _user_dir(user_id: int) -> Path:
    # Read settings.uploads_dir freshly each call (not a module-level
    # constant) so tests can point it at a temp directory — see
    # tests/conftest.py.
    directory = settings.uploads_dir / str(user_id)
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def save_content_file(user_id: int, upload: UploadFile) -> str:
    """Saves the uploaded file to disk and returns its path, ready to
    store directly in Content.original_file_path.

    Enforces MAX_UPLOAD_SIZE_BYTES here rather than trusting a
    Content-Length header — reads the body once, checks its real size,
    and only then writes it to disk.
    """
    directory = _user_dir(user_id)
    extension = Path(upload.filename or "").suffix or ".jpg"
    path = directory / f"{uuid.uuid4().hex}{extension}"

    data = upload.file.read()
    if len(data) > MAX_UPLOAD_SIZE_BYTES:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"File too large: max {MAX_UPLOAD_SIZE_BYTES // (1024 * 1024)}MB.",
        )

    with path.open("wb") as destination:
        destination.write(data)

    return str(path)


def delete_content_file(path: str | None) -> None:
    """Best-effort cleanup — used when a Content row is deleted."""
    if path:
        Path(path).unlink(missing_ok=True)
