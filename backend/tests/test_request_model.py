"""
Tests for the database-level ck_reason_matches_status constraint on
Request (see TECHNICAL_REQUIREMENTS.md, section 4: rejecting always
needs a reason, and pending/accepted never carry one).
"""

import pytest
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.database import Base
from app.models.request import Request, RequestStatus


@pytest.fixture()
def db():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(bind=engine)
    with Session(engine) as session:
        yield session


def _request(**overrides) -> Request:
    fields = dict(buyer_id=1, offer_id=1, status=RequestStatus.PENDING, reason=None)
    fields.update(overrides)
    return Request(**fields)


def test_pending_without_reason_is_allowed(db):
    db.add(_request())
    db.commit()

    assert db.query(Request).count() == 1


def test_pending_with_a_reason_is_rejected(db):
    db.add(_request(reason="too early"))

    with pytest.raises(IntegrityError):
        db.commit()


def test_rejected_without_a_reason_is_rejected(db):
    db.add(_request(status=RequestStatus.REJECTED, reason=None))

    with pytest.raises(IntegrityError):
        db.commit()


def test_rejected_with_a_reason_is_allowed(db):
    db.add(_request(status=RequestStatus.REJECTED, reason="not available"))
    db.commit()

    assert db.query(Request).count() == 1


def test_cancelled_without_a_reason_is_rejected(db):
    db.add(_request(status=RequestStatus.CANCELLED, reason=None))

    with pytest.raises(IntegrityError):
        db.commit()
