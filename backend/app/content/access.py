"""
The two access questions every content endpoint needs answered, kept
separate from each other on purpose (see TECHNICAL_REQUIREMENTS.md
section 4 — audience and paid-status are independent axes):

  1. can_view_content(): is this viewer even allowed to know the content
     item exists at all? (the audience check — public/followers/user/group)
  2. can_see_original(): assuming (1) is already true, is this viewer
     allowed to see the real content right now (spoiler lifted)?

Both take a `db` session because answering them may require querying
Follow or AudienceGroupMember — they're not decidable from the Content
row alone.
"""

from sqlalchemy.orm import Session

from app.models.audience_group import AudienceGroupMember
from app.models.content import Content, ContentAudience
from app.models.content_access import ContentPurchase
from app.models.follow import Follow, FollowStatus
from app.models.user import User


def _is_accepted_follower(db: Session, *, follower_id: int, followee_id: int) -> bool:
    return (
        db.query(Follow)
        .filter(
            Follow.follower_id == follower_id,
            Follow.followee_id == followee_id,
            Follow.status == FollowStatus.ACCEPTED,
        )
        .first()
        is not None
    )


def _is_group_member(db: Session, *, group_id: int, user_id: int) -> bool:
    return (
        db.query(AudienceGroupMember)
        .filter(
            AudienceGroupMember.group_id == group_id,
            AudienceGroupMember.user_id == user_id,
        )
        .first()
        is not None
    )


def can_view_content(db: Session, viewer: User, content: Content) -> bool:
    """
    Whether `viewer` is allowed to know this content item exists at all.

    A "no" here should make the item disappear entirely — left out of
    listings, and 404 (not 403) if requested directly — never hinted at,
    per TECHNICAL_REQUIREMENTS.md section 4.
    """
    owner_id = content.user_id
    if viewer.id == owner_id:
        return True

    if content.audience_type == ContentAudience.PUBLIC:
        return True
    if content.audience_type == ContentAudience.FOLLOWERS:
        return _is_accepted_follower(db, follower_id=viewer.id, followee_id=owner_id)
    if content.audience_type == ContentAudience.USER:
        return viewer.id == content.audience_user_id
    if content.audience_type == ContentAudience.GROUP:
        return _is_group_member(db, group_id=content.audience_group_id, user_id=viewer.id)

    return False  # unreachable given the CHECK constraint, but no silent "yes"


def can_see_original(db: Session, viewer: User, content: Content) -> bool:
    """
    Assuming can_view_content() is already True: can `viewer` see the
    real content right now (i.e. would tapping its spoiler actually
    reveal it)?

    No spoiler at all -> always yes. Spoiler and free -> always yes (the
    "tap to reveal" gesture never actually needs to be checked against
    anything but eligibility, which the caller already confirmed).
    Spoiler and paid -> only the owner, or someone with a
    ContentPurchase record for this exact item.
    """
    if not content.has_spoiler:
        return True
    if viewer.id == content.user_id:
        return True
    if not content.is_paid:
        return True

    return (
        db.query(ContentPurchase)
        .filter(ContentPurchase.user_id == viewer.id, ContentPurchase.content_id == content.id)
        .first()
        is not None
    )
