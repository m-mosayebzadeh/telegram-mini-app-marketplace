"""
Profile endpoints — two routers on purpose:
  - `router` (prefix /profile, singular): "my own profile" — GET/PUT /profile/me.
  - `public_router` (prefix /profiles, plural): viewing ANY user's basic
    profile info, e.g. for a provider reviewing who's requesting their
    offer. No audience/privacy restriction — this is intentionally
    public, unlike Content's audience rules.
"""

from datetime import date

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.core.database import get_db
from app.core.storage import delete_avatar_file, save_avatar_file
from app.models.follow import Follow, FollowStatus
from app.models.offer import Offer
from app.models.profile import MAX_INTERESTS, Profile
from app.models.profile_photo import ProfilePhoto
from app.models.request import Request, RequestStatus
from app.models.transaction import Transaction, TransactionStatus
from app.models.user import User
from app.profile.photos import get_current_avatar_url
from app.profile.schemas import (
    BuyerSummaryOut,
    ProfileOut,
    ProfilePhotoOut,
    ProfileUpdate,
    ProviderSummaryOut,
    PublicProfileOut,
)

router = APIRouter(prefix="/profile", tags=["profile"])
public_router = APIRouter(prefix="/profiles", tags=["profile"])


def _followers_count(db: Session, user_id: int) -> int:
    return (
        db.query(Follow)
        .filter(Follow.followee_id == user_id, Follow.status == FollowStatus.ACCEPTED)
        .count()
    )


def _following_count(db: Session, user_id: int) -> int:
    return (
        db.query(Follow)
        .filter(Follow.follower_id == user_id, Follow.status == FollowStatus.ACCEPTED)
        .count()
    )


def _follow_status(db: Session, *, viewer_id: int, target_id: int) -> str:
    """The VIEWER's own relationship to target_id — see
    PublicProfileOut.follow_status's docstring. Trivially "not_following"
    when viewing your own profile, since a self-follow Follow row can
    never exist (see the model's ck_no_self_follow constraint)."""
    follow = (
        db.query(Follow)
        .filter(Follow.follower_id == viewer_id, Follow.followee_id == target_id)
        .first()
    )
    return follow.status.value if follow else "not_following"


def _to_profile_out(db: Session, profile: Profile) -> ProfileOut:
    return ProfileOut(
        id=profile.id,
        avatar_url=get_current_avatar_url(db, profile.user_id),
        bio=profile.bio,
        location=profile.location,
        interests=profile.interests,
        is_trusted=profile.is_trusted,
        birthday_month=profile.birthday_month,
        birthday_day=profile.birthday_day,
    )


@router.get("/me", response_model=ProfileOut)
def read_my_profile(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ProfileOut:
    profile = db.query(Profile).filter(Profile.user_id == current_user.id).first()
    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="You haven't created a profile yet.",
        )
    return _to_profile_out(db, profile)


@router.put("/me", response_model=ProfileOut)
def upsert_my_profile(
    payload: ProfileUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ProfileOut:
    """
    Create-or-update: PUT is idempotent, so one endpoint handles both "I
    don't have a profile yet" and "update my existing profile" — the
    caller doesn't need to know which case they're in.
    """
    if len(payload.interests) > MAX_INTERESTS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"You can only have up to {MAX_INTERESTS} interests."
        )
    if (payload.birthday_month is None) != (payload.birthday_day is None):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "birthday_month and birthday_day must be set together."
        )
    if payload.birthday_month is not None and payload.birthday_day is not None:
        # ProfileUpdate's Field(ge=..., le=...) only bounds each of
        # birthday_month/birthday_day independently (1-12, 1-31) — it
        # can't catch a combination like month=2, day=30 that doesn't
        # exist in ANY year. 2000 is a leap year, so this also accepts
        # Feb 29 (Gregorian; the year itself is never stored, see
        # Profile.birthday_month's docstring).
        try:
            date(2000, payload.birthday_month, payload.birthday_day)
        except ValueError:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "birthday_month/birthday_day is not a real calendar date."
            ) from None

    profile = db.query(Profile).filter(Profile.user_id == current_user.id).first()
    if profile is None:
        profile = Profile(user_id=current_user.id)
        db.add(profile)

    # avatar_url is deliberately NOT touched here — it's only ever set
    # via POST /profile/me/avatar below, so a plain bio/location edit
    # can never accidentally wipe out an existing photo.
    profile.bio = payload.bio
    profile.location = payload.location
    profile.interests = payload.interests
    profile.birthday_month = payload.birthday_month
    profile.birthday_day = payload.birthday_day
    # is_trusted is intentionally untouched here — see ProfileUpdate's
    # docstring; this endpoint can never grant it.

    db.commit()
    db.refresh(profile)
    return _to_profile_out(db, profile)


@router.post("/me/avatar", response_model=ProfileOut, status_code=status.HTTP_201_CREATED)
def upload_my_avatar(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ProfileOut:
    """
    ADDS a new profile photo — the "Set Photo" action in the profile
    header — without deleting any earlier ones (see
    app/models/profile_photo.py). It becomes the current avatar shown
    everywhere a single avatar_url is used, since that's always just the
    newest ProfilePhoto row; every previous photo is still there to
    swipe back through in the fullscreen gallery
    (GET /profiles/{user_id}/photos below) until its owner deletes it.
    """
    # A Profile row isn't strictly needed to own photos, but every other
    # endpoint here assumes one exists once a user has touched their
    # profile at all — create it now rather than leaving photos orphaned
    # from a profile that's never been created.
    profile = db.query(Profile).filter(Profile.user_id == current_user.id).first()
    if profile is None:
        profile = Profile(user_id=current_user.id)
        db.add(profile)
        db.flush()

    db.add(ProfilePhoto(user_id=current_user.id, url=save_avatar_file(current_user.id, file)))
    db.commit()

    return _to_profile_out(db, profile)


@router.get("/me/photos", response_model=list[ProfilePhotoOut])
def list_my_photos(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ProfilePhoto]:
    """Shorthand for GET /profiles/{my own id}/photos — see that route
    below for the actual query; this just saves the caller from needing
    to already know their own user id."""
    return _query_photos(db, current_user.id)


@router.delete("/me/photos/{photo_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_my_photo(
    photo_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Deletes ONE specific photo from the fullscreen gallery's trash
    icon. If it happened to be the newest (i.e. "the" current avatar),
    whichever photo is now newest becomes the avatar automatically —
    see get_current_avatar_url()."""
    photo = (
        db.query(ProfilePhoto)
        .filter(ProfilePhoto.id == photo_id, ProfilePhoto.user_id == current_user.id)
        .first()
    )
    if photo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Photo not found.")

    delete_avatar_file(photo.url)
    db.delete(photo)
    db.commit()


def _query_photos(db: Session, user_id: int) -> list[ProfilePhoto]:
    return (
        db.query(ProfilePhoto)
        .filter(ProfilePhoto.user_id == user_id)
        .order_by(ProfilePhoto.created_at.desc())
        .all()
    )


@public_router.get("/{user_id}/photos", response_model=list[ProfilePhotoOut])
def list_photos(
    user_id: int,
    current_user: User = Depends(get_current_user),  # requires auth, just not "self"
    db: Session = Depends(get_db),
) -> list[ProfilePhoto]:
    """
    Every photo `user_id` has ever uploaded, newest first — feeds the
    fullscreen gallery's swipe-through-previous-photos view. Public, no
    audience restriction, same as the rest of this file — a profile
    photo has no privacy rule the way Content does.
    """
    if db.get(User, user_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found.")
    return _query_photos(db, user_id)


@public_router.get("/{user_id}", response_model=PublicProfileOut)
def read_public_profile(
    user_id: int,
    current_user: User = Depends(get_current_user),  # still requires auth, just not "self"
    db: Session = Depends(get_db),
) -> PublicProfileOut:
    """
    Works even if `user_id` has never created a Profile row — a bare
    User (display_name/username only, no avatar/bio) is still a valid
    thing to look at, e.g. right after their first login.
    """
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    profile = db.query(Profile).filter(Profile.user_id == user_id).first()

    return PublicProfileOut(
        user_id=target.id,
        display_name=target.display_name,
        username=target.username,
        avatar_url=get_current_avatar_url(db, user_id),
        bio=profile.bio if profile else None,
        location=profile.location if profile else None,
        interests=profile.interests if profile else [],
        is_trusted=profile.is_trusted if profile else False,
        birthday_month=profile.birthday_month if profile else None,
        birthday_day=profile.birthday_day if profile else None,
        followers_count=_followers_count(db, user_id),
        following_count=_following_count(db, user_id),
        follow_status=_follow_status(db, viewer_id=current_user.id, target_id=user_id),
    )


@public_router.get("/{user_id}/provider-summary", response_model=ProviderSummaryOut)
def read_provider_summary(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ProviderSummaryOut:
    """
    What a prospective buyer sees about `user_id` as a PROVIDER, before
    requesting one of their offers — see ProviderSummaryOut's docstring
    and TECHNICAL_REQUIREMENTS.md section 2 for which fields are real
    today vs. still waiting on the (unbuilt) Rating entity.
    """
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    completed_services_count = (
        db.query(Transaction)
        .filter(Transaction.provider_id == user_id, Transaction.status == TransactionStatus.SUCCEEDED)
        .count()
    )

    # Every request ever sent to one of this user's offers — the provider
    # is only reachable via Request.offer.provider_id, so this always
    # joins through Offer rather than filtering Request directly.
    requests_query = db.query(Request).join(Offer, Request.offer_id == Offer.id).filter(
        Offer.provider_id == user_id
    )
    total_requests = requests_query.count()
    responded_requests = requests_query.filter(
        Request.status.in_([RequestStatus.ACCEPTED, RequestStatus.REJECTED])
    ).count()
    rejected_requests = requests_query.filter(Request.status == RequestStatus.REJECTED).count()

    disputed_transactions_count = (
        db.query(Transaction)
        .filter(Transaction.provider_id == user_id, Transaction.disputed_at.isnot(None))
        .count()
    )

    return ProviderSummaryOut(
        status="established" if completed_services_count >= 1 else "new",
        joined_at=target.joined_at,
        completed_services_count=completed_services_count,
        # None (not 0.0) with zero requests received — see
        # ProviderSummaryOut's docstring for why that distinction matters.
        response_rate=(responded_requests / total_requests) if total_requests > 0 else None,
        rejection_rate=(rejected_requests / total_requests) if total_requests > 0 else None,
        disputed_transactions_count=disputed_transactions_count,
    )


@public_router.get("/{user_id}/buyer-summary", response_model=BuyerSummaryOut)
def read_buyer_summary(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> BuyerSummaryOut:
    """
    What a provider sees about `user_id` as a BUYER, before accepting or
    rejecting their request — see BuyerSummaryOut's docstring for which
    fields are real today vs. still blocked (buyer-cancel, disputes,
    ratings — none of those exist yet).
    """
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    completed_transactions_count = (
        db.query(Transaction)
        .filter(Transaction.buyer_id == user_id, Transaction.status == TransactionStatus.SUCCEEDED)
        .count()
    )

    # Both PENDING and SUCCEEDED count as "spent" -- the buyer's SPEND
    # ledger entry is written the instant they pay, regardless of
    # whether the transaction has released to its provider yet (see
    # app/wallet/service.py's pay_for_item).
    total_stars_spent = (
        db.query(Transaction)
        .filter(
            Transaction.buyer_id == user_id,
            Transaction.status.in_([TransactionStatus.PENDING, TransactionStatus.SUCCEEDED]),
        )
        .with_entities(Transaction.gross_price_stars)
        .all()
    )
    total_stars_spent_sum = sum(row[0] for row in total_stars_spent)

    return BuyerSummaryOut(
        status="established" if completed_transactions_count >= 1 else "new",
        joined_at=target.joined_at,
        completed_transactions_count=completed_transactions_count,
        total_stars_spent=total_stars_spent_sum,
    )
