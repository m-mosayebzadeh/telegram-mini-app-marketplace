"""
Content endpoints: upload, list, metadata, reveal, purchase, pin, delete,
like/unlike.

Every route that takes a content_id first loads the item and calls
can_view_content() (see app/content/access.py) — if that's False, the
route raises a plain 404, exactly as if the item didn't exist. This is
what makes a group/user-only item genuinely invisible to anyone outside
its audience, not just spoilered (TECHNICAL_REQUIREMENTS.md section 4).

There's only one file-serving route (/content/{id}/file) — no separate
"default blurred view." A spoiler is a generic overlay the frontend
draws over the locked state (using the `has_spoiler` / `can_see_original`
fields from the metadata routes below) without ever requesting a file;
this route is only hit once eligibility is worth checking for real,
whether that's a free tap-to-reveal or a paid unlock.

Content connects directly to User, not Profile (see app/models/content.py)
— a Profile is optional, so requiring one before a user could post would
mean nobody could post until they'd separately created a profile. Upload
therefore has no "create a profile first" gate.
"""

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.content.access import can_see_original, can_view_content
from app.content.schemas import ContentOut, PurchaseResult
from app.core.config import settings
from app.core.database import get_db
from app.core.storage import delete_content_file, save_content_file
from app.models.audience_group import AudienceGroup
from app.models.content import (
    MAX_VIDEO_DURATION_SECONDS,
    Content,
    ContentAudience,
    ContentType,
)
from app.models.content_access import ContentOpenLog, ContentPurchase
from app.models.like import Like
from app.models.transaction import TransactionKind
from app.models.user import User
from app.wallet.service import InsufficientBalanceError, pay_for_item

router = APIRouter(prefix="/content", tags=["content"])

# Up to 3 pinned items per user — mirrors MAX_ACTIVE_OFFERS_PER_USER in
# app/offer/router.py: a small, application-level cap rather than a
# CHECK constraint, since "how many rows of a table satisfy X" isn't
# something a single-row CHECK can express.
MAX_PINNED_CONTENT_PER_USER = 3


def _like_stats(db: Session, viewer: User, content: Content) -> tuple[int, bool]:
    count = db.query(Like).filter(Like.content_id == content.id).count()
    liked_by_me = (
        db.query(Like)
        .filter(Like.content_id == content.id, Like.user_id == viewer.id)
        .first()
        is not None
    )
    return count, liked_by_me


def _to_content_out(db: Session, viewer: User, content: Content) -> ContentOut:
    like_count, liked_by_me = _like_stats(db, viewer, content)
    return ContentOut(
        id=content.id,
        user_id=content.user_id,
        content_type=content.content_type.value,
        duration_seconds=content.duration_seconds,
        is_paid=content.is_paid,
        price_stars=content.price_stars,
        has_spoiler=content.has_spoiler,
        audience_type=content.audience_type.value,
        is_pinned=content.is_pinned,
        created_at=content.created_at,
        can_see_original=can_see_original(db, viewer, content),
        like_count=like_count,
        liked_by_me=liked_by_me,
    )


def _get_visible_content(db: Session, content_id: int, viewer: User) -> Content:
    """Loads a content item and enforces the audience check in one place
    — every route below needs exactly this, so a route can't accidentally
    skip it."""
    content = db.get(Content, content_id)
    if content is None or not can_view_content(db, viewer, content):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Content not found.")
    return content


def _validate_audience(
    db: Session,
    *,
    audience_type: ContentAudience,
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
    if audience_type in (ContentAudience.PUBLIC, ContentAudience.FOLLOWERS):
        return None, None

    if audience_type == ContentAudience.USER:
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


@router.post("", response_model=ContentOut, status_code=status.HTTP_201_CREATED)
def upload_content(
    file: UploadFile = File(...),
    content_type: ContentType = Form(...),
    duration_seconds: int | None = Form(None),
    is_paid: bool = Form(False),
    price_stars: int | None = Form(None),
    has_spoiler: bool = Form(False),
    audience_type: ContentAudience = Form(ContentAudience.PUBLIC),
    audience_user_id: int | None = Form(None),
    audience_group_id: int | None = Form(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ContentOut:
    # duration_seconds is client-reported (we don't decode video files
    # server-side to measure it) — an acceptable tradeoff since this is
    # a policy limit, not a security boundary the way spoiler access is.
    if content_type == ContentType.SHORT_VIDEO:
        if duration_seconds is None or not (0 < duration_seconds <= MAX_VIDEO_DURATION_SECONDS):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"duration_seconds must be between 1 and {MAX_VIDEO_DURATION_SECONDS} for a short video.",
            )
    else:
        duration_seconds = None

    # Business rule: paid implies spoiler — force it rather than reject,
    # since "I want to sell this" already implies "and keep it hidden
    # until paid," so there's nothing wrong to reject here.
    if is_paid:
        has_spoiler = True
        if price_stars is None or price_stars <= 0:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "price_stars is required for paid content."
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

    original_path = save_content_file(current_user.id, file)

    content = Content(
        user_id=current_user.id,
        content_type=content_type,
        duration_seconds=duration_seconds,
        original_file_path=original_path,
        is_paid=is_paid,
        price_stars=price_stars,
        has_spoiler=has_spoiler,
        audience_type=audience_type,
        audience_user_id=target_user_id,
        audience_group_id=target_group_id,
    )
    db.add(content)
    db.commit()
    db.refresh(content)
    return _to_content_out(db, current_user, content)


@router.get("", response_model=list[ContentOut])
def list_content(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ContentOut]:
    """
    Only content `current_user` is allowed to know about at all — a
    group/user-restricted item is simply absent from this list for
    anyone outside its audience, not merely marked hidden.

    Pinned items sort first (see MAX_PINNED_CONTENT_PER_USER), newest
    first within each group — matching the profile content grid's
    "pinned items lead" layout.
    """
    all_items = (
        db.query(Content)
        .filter(Content.user_id == user_id)
        .order_by(Content.is_pinned.desc(), Content.created_at.desc())
        .all()
    )
    visible = [c for c in all_items if can_view_content(db, current_user, c)]
    return [_to_content_out(db, current_user, c) for c in visible]


@router.get("/{content_id}", response_model=ContentOut)
def get_content(
    content_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ContentOut:
    """
    Metadata only — `has_spoiler` and `can_see_original` are all a
    frontend needs to render the locked/unlocked state; it never has to
    request /file just to find out whether an item is worth tapping.
    """
    content = _get_visible_content(db, content_id, current_user)
    return _to_content_out(db, current_user, content)


@router.get("/{content_id}/file")
def get_content_file(
    content_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FileResponse:
    """
    The actual file bytes — requested either directly (no spoiler, just
    show it) or as the "tap to reveal" action (spoiler on). Every call
    re-checks access; there's no "already revealed, stays visible from
    now on" state — even an already-purchased item keeps its spoiler by
    default and needs another tap each time.
    """
    content = _get_visible_content(db, content_id, current_user)

    if not can_see_original(db, current_user, content):
        # 402 Payment Required: exists for exactly this situation.
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail={"reason": "payment_required", "price_stars": content.price_stars},
        )

    if content.has_spoiler:
        # Only a real "reveal" is worth logging (see ContentOpenLog) — a
        # plain, always-visible item has nothing to "open."
        db.add(ContentOpenLog(user_id=current_user.id, content_id=content.id))
        db.commit()

    return FileResponse(content.original_file_path)


@router.post("/{content_id}/purchase", response_model=PurchaseResult, status_code=status.HTTP_201_CREATED)
def purchase_content(
    content_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PurchaseResult:
    """
    Charges the buyer's wallet for paid content and grants permanent
    access, via app/wallet/service.py — see TECHNICAL_REQUIREMENTS.md,
    "مدل مالی و اعتبار". Calling this again for an item already
    purchased is idempotent: it just confirms access, no second charge.
    """
    content = _get_visible_content(db, content_id, current_user)
    if not content.is_paid:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This item isn't for sale.")

    provider_id = content.user_id
    if provider_id == current_user.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You already own this item.")

    existing = (
        db.query(ContentPurchase)
        .filter(ContentPurchase.user_id == current_user.id, ContentPurchase.content_id == content.id)
        .first()
    )
    if existing is not None:
        return PurchaseResult(unlocked=True)

    try:
        pay_for_item(
            db,
            kind=TransactionKind.CONTENT_PURCHASE,
            buyer_id=current_user.id,
            provider_id=provider_id,
            gross_price_stars=content.price_stars,
            commission_rate_percent=settings.content_commission_percent,
            content_id=content.id,
        )
    except InsufficientBalanceError as exc:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail={
                "reason": "insufficient_balance",
                "needed_toman": exc.needed_toman,
                "available_toman": exc.available_toman,
            },
        ) from exc

    db.add(ContentPurchase(user_id=current_user.id, content_id=content.id))
    db.commit()

    return PurchaseResult(unlocked=True)


@router.post("/{content_id}/pin", response_model=ContentOut)
def pin_content(
    content_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ContentOut:
    """Pins an item to the front of the owner's content grid — up to
    MAX_PINNED_CONTENT_PER_USER at a time (mirrors the active-offer cap
    pattern in app/offer/router.py)."""
    content = db.get(Content, content_id)
    if content is None or content.user_id != current_user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Content not found.")

    if not content.is_pinned:
        pinned_count = (
            db.query(Content)
            .filter(Content.user_id == current_user.id, Content.is_pinned.is_(True))
            .count()
        )
        if pinned_count >= MAX_PINNED_CONTENT_PER_USER:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"You can only pin up to {MAX_PINNED_CONTENT_PER_USER} items.",
            )
        content.is_pinned = True
        db.commit()
        db.refresh(content)

    return _to_content_out(db, current_user, content)


@router.post("/{content_id}/unpin", response_model=ContentOut)
def unpin_content(
    content_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ContentOut:
    content = db.get(Content, content_id)
    if content is None or content.user_id != current_user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Content not found.")

    if content.is_pinned:
        content.is_pinned = False
        db.commit()
        db.refresh(content)

    return _to_content_out(db, current_user, content)


@router.post("/{content_id}/like", response_model=ContentOut, status_code=status.HTTP_201_CREATED)
def like_content(
    content_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ContentOut:
    """Idempotent: liking an already-liked item just confirms the
    current state instead of erroring — the uq_like unique constraint is
    the real guard against double-counting, this just avoids surfacing
    it as a 500 to the frontend."""
    content = _get_visible_content(db, content_id, current_user)

    existing = (
        db.query(Like)
        .filter(Like.user_id == current_user.id, Like.content_id == content.id)
        .first()
    )
    if existing is None:
        db.add(Like(user_id=current_user.id, content_id=content.id))
        db.commit()

    return _to_content_out(db, current_user, content)


@router.delete("/{content_id}/like", response_model=ContentOut)
def unlike_content(
    content_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ContentOut:
    content = _get_visible_content(db, content_id, current_user)

    existing = (
        db.query(Like)
        .filter(Like.user_id == current_user.id, Like.content_id == content.id)
        .first()
    )
    if existing is not None:
        db.delete(existing)
        db.commit()

    return _to_content_out(db, current_user, content)


@router.delete("/{content_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_content(
    content_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    content = db.get(Content, content_id)
    if content is None or content.user_id != current_user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Content not found.")

    delete_content_file(content.original_file_path)
    db.delete(content)
    db.commit()
