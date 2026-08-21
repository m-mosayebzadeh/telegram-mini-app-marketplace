"""
Tests for the database-level business rules on Photo (see
TECHNICAL_REQUIREMENTS.md, section 4): these are CHECK constraints, so
they're enforced by SQLite itself, not by application code — these tests
make sure the constraints actually do what we think they do.
"""

import pytest
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.database import Base
from app.models.photo import Photo, PhotoAudience


@pytest.fixture()
def db():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(bind=engine)
    with Session(engine) as session:
        yield session


def _photo(**overrides) -> Photo:
    fields = dict(
        profile_id=1,
        original_file_path="original.jpg",
        blurred_file_path=None,
        is_paid=False,
        is_blurred=False,
        audience_type=PhotoAudience.PUBLIC,
    )
    fields.update(overrides)
    return Photo(**fields)


def test_free_public_unblurred_photo_is_allowed(db):
    db.add(_photo())
    db.commit()  # would raise IntegrityError if rejected

    assert db.query(Photo).count() == 1


def test_paid_photo_must_be_blurred(db):
    db.add(_photo(is_paid=True, price_stars=10, is_blurred=False))

    with pytest.raises(IntegrityError):
        db.commit()


def test_paid_photo_requires_a_price(db):
    db.add(
        _photo(
            is_paid=True,
            price_stars=None,
            is_blurred=True,
            blurred_file_path="blurred.jpg",
        )
    )

    with pytest.raises(IntegrityError):
        db.commit()


def test_blurred_photo_requires_a_blurred_file(db):
    db.add(_photo(is_blurred=True, blurred_file_path=None))

    with pytest.raises(IntegrityError):
        db.commit()


def test_unblurred_photo_cannot_have_a_blurred_file(db):
    db.add(_photo(is_blurred=False, blurred_file_path="blurred.jpg"))

    with pytest.raises(IntegrityError):
        db.commit()


def test_blurred_free_photo_with_a_blurred_file_is_allowed(db):
    db.add(_photo(is_blurred=True, blurred_file_path="blurred.jpg"))
    db.commit()

    assert db.query(Photo).count() == 1


def test_free_photo_cannot_have_a_price(db):
    db.add(_photo(is_paid=False, price_stars=10))

    with pytest.raises(IntegrityError):
        db.commit()


def test_user_audience_requires_a_target_user(db):
    db.add(_photo(audience_type=PhotoAudience.USER))

    with pytest.raises(IntegrityError):
        db.commit()


def test_user_audience_with_a_target_user_is_allowed(db):
    db.add(_photo(audience_type=PhotoAudience.USER, audience_user_id=42))
    db.commit()

    assert db.query(Photo).count() == 1


def test_group_audience_cannot_also_target_a_user(db):
    db.add(
        _photo(
            audience_type=PhotoAudience.GROUP,
            audience_group_id=1,
            audience_user_id=42,
        )
    )

    with pytest.raises(IntegrityError):
        db.commit()
