"""
Tests for the database-level business rules on Content (see
TECHNICAL_REQUIREMENTS.md, section 4): these are CHECK constraints, so
they're enforced by SQLite itself, not by application code — these tests
make sure the constraints actually do what we think they do.
"""

import pytest
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.database import Base
from app.models.content import Content, ContentAudience, ContentType


@pytest.fixture()
def db():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(bind=engine)
    with Session(engine) as session:
        yield session


def _content(**overrides) -> Content:
    fields = dict(
        user_id=1,
        content_type=ContentType.PHOTO,
        original_file_path="original.jpg",
        is_paid=False,
        has_spoiler=False,
        audience_type=ContentAudience.PUBLIC,
    )
    fields.update(overrides)
    return Content(**fields)


def test_free_public_photo_without_a_spoiler_is_allowed(db):
    db.add(_content())
    db.commit()  # would raise IntegrityError if rejected

    assert db.query(Content).count() == 1


def test_paid_content_must_have_a_spoiler(db):
    db.add(_content(is_paid=True, price_stars=10, has_spoiler=False))

    with pytest.raises(IntegrityError):
        db.commit()


def test_paid_content_requires_a_price(db):
    db.add(_content(is_paid=True, price_stars=None, has_spoiler=True))

    with pytest.raises(IntegrityError):
        db.commit()


def test_free_content_cannot_have_a_price(db):
    db.add(_content(is_paid=False, price_stars=10))

    with pytest.raises(IntegrityError):
        db.commit()


def test_user_audience_requires_a_target_user(db):
    db.add(_content(audience_type=ContentAudience.USER))

    with pytest.raises(IntegrityError):
        db.commit()


def test_user_audience_with_a_target_user_is_allowed(db):
    db.add(_content(audience_type=ContentAudience.USER, audience_user_id=42))
    db.commit()

    assert db.query(Content).count() == 1


def test_group_audience_cannot_also_target_a_user(db):
    db.add(
        _content(
            audience_type=ContentAudience.GROUP,
            audience_group_id=1,
            audience_user_id=42,
        )
    )

    with pytest.raises(IntegrityError):
        db.commit()


# --- content_type / duration_seconds pairing (new for Content) -----------


def test_photo_cannot_have_a_duration(db):
    db.add(_content(content_type=ContentType.PHOTO, duration_seconds=10))

    with pytest.raises(IntegrityError):
        db.commit()


def test_short_video_requires_a_duration(db):
    db.add(_content(content_type=ContentType.SHORT_VIDEO, duration_seconds=None))

    with pytest.raises(IntegrityError):
        db.commit()


def test_short_video_duration_cannot_exceed_the_policy_limit(db):
    db.add(_content(content_type=ContentType.SHORT_VIDEO, duration_seconds=61))

    with pytest.raises(IntegrityError):
        db.commit()


def test_short_video_with_valid_duration_is_allowed(db):
    db.add(_content(content_type=ContentType.SHORT_VIDEO, duration_seconds=60))
    db.commit()

    assert db.query(Content).count() == 1
