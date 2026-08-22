"""
Photo endpoints: upload, list, metadata, reveal, purchase (stub), delete.

Every route that takes a photo_id first loads the photo and calls
can_view_photo() (see app/photo/access.py) — if that's False, the route
raises a plain 404, exactly as if the photo didn't exist. This is what
makes a group/user-only photo genuinely invisible to anyone outside its
audience, not just spoilered (TECHNICAL_REQUIREMENTS.md section 4).

There's only one image-serving route (/photos/{id}/file) — no separate
"default blurred view." A spoiler is a generic overlay the frontend
draws over the locked state (using the `has_spoiler` / `can_see_original`
fields from the metadata routes below) without ever requesting an image;
this route is only hit once eligibility is worth checking for real,
whether that's a free tap-to-reveal or a paid unlock.
"""

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.core.database import get_db
from app.core.storage import delete_photo_file, save_photo_file
from app.models.audience_group import AudienceGroup
from app.models.photo import Photo, PhotoAudience
from app.models.photo_access import PhotoOpenLog, PhotoPurchase
from app.models.profile import Profile
from app.models.user import User
from app.photo.access import can_see_original, can_view_photo
from app.photo.schemas import PhotoOut, PurchaseResult

router = APIRouter(prefix="/photos", tags=["photos"])


def _to_photo_out(db: Session, viewer: User, photo: Photo) -> PhotoOut:
    return PhotoOut(
        id=photo.id,
        is_paid=photo.is_paid,
        price_stars=photo.price_stars,
        has_spoiler=photo.has_spoiler,
        audience_type=photo.audience_type.value,
        created_at=photo.created_at,
        can_see_original=can_see_original(db, viewer, photo),
    )


def _get_visible_photo(db: Session, photo_id: int, viewer: User) -> Photo:
    """Loads a photo and enforces the audience check in one place — every
    route below needs exactly this, so a route can't accidentally skip it."""
    photo = db.get(Photo, photo_id)
    if photo is None or not can_view_photo(db, viewer, photo):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Photo not found.")
    return photo


def _validate_audience(
    db: Session,
    *,
    audience_type: PhotoAudience,
    audience_user_id: int | None,
    audience_group_id: int | None,
    owner_id: int,
) -> tuple[int | None, int | None]:
    """
    Mirrors the ck_audience_target_matches_type CHECK constraint, but
    runs *before* we touch the database — so a bad request gets a clean
    400 with a real message instead of a raw IntegrityError. Also checks
    that a "group" target is actually one of the caller's own groups.
    """
    if audience_type in (PhotoAudience.PUBLIC, PhotoAudience.FOLLOWERS):
        return None, None

    if audience_type == PhotoAudience.USER:
        if audience_user_id is None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "audience_user_id is required for a 'user' audience."
            )
        if db.get(User, audience_user_id) is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Target user not found.")
        return audience_user_id, None

    # audience_type == GROUP
    if audience_group_id is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "audience_group_id is required for a 'group' audience."
        )
    group = (
        db.query(AudienceGroup)
        .filter(AudienceGroup.id == audience_group_id, AudienceGroup.owner_id == owner_id)
        .first()
    )
    if group is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Audience group not found.")
    return None, audience_group_id


@router.post("", response_model=PhotoOut, status_code=status.HTTP_201_CREATED)
def upload_photo(
    file: UploadFile = File(...),
    is_paid: bool = Form(False),
    price_stars: int | None = Form(None),
    has_spoiler: bool = Form(False),
    audience_type: PhotoAudience = Form(PhotoAudience.PUBLIC),
    audience_user_id: int | None = Form(None),
    audience_group_id: int | None = Form(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PhotoOut:
    profile = db.query(Profile).filter(Profile.user_id == current_user.id).first()
    if profile is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Create a profile before uploading photos."
        )

    # Business rule: paid implies spoiler — force it rather than reject,
    # since "I want to sell this" already implies "and keep it hidden
    # until paid," so there's nothing wrong to reject here.
    if is_paid:
        has_spoiler = True
        if price_stars is None or price_stars <= 0:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "price_stars is required for a paid photo."
            )
    else:
        price_stars = None

    target_user_id, target_group_id = _validate_audience(
        db,
        audience_type=audience_type,
        audience_user_id=audience_user_id,
        audience_group_id=audience_group_id,
        owner_id=current_user.id,
    )

    original_path = save_photo_file(current_user.id, file)

    photo = Photo(
        profile_id=profile.id,
        original_file_path=original_path,
        is_paid=is_paid,
        price_stars=price_stars,
        has_spoiler=has_spoiler,
        audience_type=audience_type,
        audience_user_id=target_user_id,
        audience_group_id=target_group_id,
    )
    db.add(photo)
    db.commit()
    db.refresh(photo)
    return _to_photo_out(db, current_user, photo)


@router.get("", response_model=list[PhotoOut])
def list_photos(
    profile_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[PhotoOut]:
    """
    Only photos `current_user` is allowed to know about at all — a
    group/user-restricted photo is simply absent from this list for
    anyone outside its audience, not merely marked hidden.
    """
    all_photos = db.query(Photo).filter(Photo.profile_id == profile_id).all()
    visible = [p for p in all_photos if can_view_photo(db, current_user, p)]
    return [_to_photo_out(db, current_user, p) for p in visible]


@router.get("/{photo_id}", response_model=PhotoOut)
def get_photo(
    photo_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PhotoOut:
    """
    Metadata only — `has_spoiler` and `can_see_original` are all a
    frontend needs to render the locked/unlocked state; it never has to
    request /file just to find out whether a photo is worth tapping.
    """
    photo = _get_visible_photo(db, photo_id, current_user)
    return _to_photo_out(db, current_user, photo)


@router.get("/{photo_id}/file")
def get_photo_file(
    photo_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FileResponse:
    """
    The actual image bytes — requested either directly (no spoiler, just
    show it) or as the "tap to reveal" action (spoiler on). Every call
    re-checks access; there's no "already revealed, stays visible from
    now on" state — even an already-purchased photo keeps its spoiler by
    default and needs another tap each time.
    """
    photo = _get_visible_photo(db, photo_id, current_user)

    if not can_see_original(db, current_user, photo):
        # 402 Payment Required: exists for exactly this situation.
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail={"reason": "payment_required", "price_stars": photo.price_stars},
        )

    if photo.has_spoiler:
        # Only a real "reveal" is worth logging (see PhotoOpenLog) — a
        # plain, always-visible photo has nothing to "open."
        db.add(PhotoOpenLog(user_id=current_user.id, photo_id=photo.id))
        db.commit()

    return FileResponse(photo.original_file_path)


@router.post("/{photo_id}/purchase", response_model=PurchaseResult, status_code=status.HTTP_201_CREATED)
def purchase_photo(
    photo_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PurchaseResult:
    """
    STUB — grants access unconditionally, no real payment involved yet.

    TODO(payment): once Telegram Stars is wired up (see
    TECHNICAL_REQUIREMENTS.md section 7, still an open decision), this
    must charge/verify the payment FIRST and only create the
    PhotoPurchase row after that succeeds. Everything else here —
    can_see_original() checking for a PhotoPurchase row, /file logging an
    open — already works correctly once that's added; only this
    endpoint's body needs to change.
    """
    photo = _get_visible_photo(db, photo_id, current_user)
    if not photo.is_paid:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This photo isn't for sale.")

    existing = (
        db.query(PhotoPurchase)
        .filter(PhotoPurchase.user_id == current_user.id, PhotoPurchase.photo_id == photo.id)
        .first()
    )
    if existing is None:
        db.add(PhotoPurchase(user_id=current_user.id, photo_id=photo.id))
        db.commit()

    return PurchaseResult(unlocked=True)


@router.delete("/{photo_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_photo(
    photo_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    photo = db.get(Photo, photo_id)
    if photo is None or photo.profile.user_id != current_user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Photo not found.")

    delete_photo_file(photo.original_file_path)
    db.delete(photo)
    db.commit()
