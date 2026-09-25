"""
What deleting a piece of content means, which depends on whether anyone paid.

Nobody did: it really goes, row and file both — nothing refers to it and
keeping it would only take space.

Somebody did: the row stays, because a purchase records WHAT was bought and a
transaction pointing at nothing is a receipt for an unnamed thing. So does the
file, because the people who paid keep access. A seller may take something off
sale; taking it back out of the hands of people who bought it is a different
act, and not one a delete button should quietly perform.
"""
from pathlib import Path

from app.models.content import Content
from app.models.content_access import ContentPurchase
from tests.helpers import give_wallet_balance, sign_init_data
from tests.test_content_endpoints import _upload

RATE = 1000  # Toman per Photon, the fixed peg


def _auth(telegram_id: int, first_name: str = "Test") -> dict:
    return {"X-Telegram-Init-Data": sign_init_data({"id": telegram_id, "first_name": first_name})}


def _sold_content(client, db_session, *, price_photons=10):
    """A paid item, and one buyer who owns it."""
    seller, buyer = _auth(1, "Alice"), _auth(2, "Bob")
    client.get("/me", headers=seller)
    buyer_id = client.get("/me", headers=buyer).json()["id"]
    item = _upload(client, seller, is_paid=True, price_photons=price_photons).json()
    give_wallet_balance(db_session, buyer_id, amount_toman=price_photons * RATE)
    assert client.post(f"/content/{item['id']}/purchase", headers=buyer).status_code == 201
    return item, seller, buyer


def test_content_nobody_bought_is_really_gone(client, db_session):
    seller = _auth(1, "Alice")
    client.get("/me", headers=seller)
    item = _upload(client, seller, is_paid=True, price_photons=10).json()
    stored = db_session.get(Content, item["id"])
    file_path = Path(stored.original_file_path)
    assert file_path.exists()

    assert client.delete(f"/content/{item['id']}", headers=seller).status_code == 204

    db_session.expire_all()
    assert db_session.get(Content, item["id"]) is None
    assert not file_path.exists()


def test_content_someone_bought_keeps_its_row_and_its_file(client, db_session):
    item, seller, _ = _sold_content(client, db_session)
    file_path = Path(db_session.get(Content, item["id"]).original_file_path)

    assert client.delete(f"/content/{item['id']}", headers=seller).status_code == 204

    db_session.expire_all()
    stored = db_session.get(Content, item["id"])
    assert stored is not None
    assert stored.deleted_at is not None
    # The file survives because someone paid for what is inside it.
    assert file_path.exists()


def test_the_buyer_keeps_seeing_what_they_paid_for(client, db_session):
    """The whole point. A seller may withdraw something from sale; they may not
    take it back from the people who bought it."""
    item, seller, buyer = _sold_content(client, db_session)
    client.delete(f"/content/{item['id']}", headers=seller)

    response = client.get(f"/content/{item['id']}", headers=buyer)

    assert response.status_code == 200
    assert response.json()["is_deleted"] is True
    assert response.json()["can_see_original"] is True
    assert client.get(f"/content/{item['id']}/file", headers=buyer).status_code == 200


def test_nobody_else_sees_it_afterwards_not_even_the_seller(client, db_session):
    item, seller, _ = _sold_content(client, db_session)
    stranger = _auth(3, "Carol")
    client.get("/me", headers=stranger)
    client.delete(f"/content/{item['id']}", headers=seller)

    assert client.get(f"/content/{item['id']}", headers=stranger).status_code == 404
    # Including the person who deleted it: otherwise "deleted" would mean
    # something different to them than it looks.
    assert client.get(f"/content/{item['id']}", headers=seller).status_code == 404


def test_it_leaves_the_sellers_grid(client, db_session):
    item, seller, _ = _sold_content(client, db_session)
    seller_id = client.get("/me", headers=seller).json()["id"]
    client.delete(f"/content/{item['id']}", headers=seller)

    listing = client.get(f"/content?user_id={seller_id}", headers=seller).json()

    assert [row["id"] for row in listing] == []


def test_the_seller_is_told_how_many_people_bought_it(client, db_session):
    """The number they need before deciding, shown before the decision."""
    item, seller, _ = _sold_content(client, db_session)

    owner_view = client.get(f"/content/{item['id']}", headers=seller).json()

    assert owner_view["purchase_count"] == 1


def test_the_count_is_nobody_elses_business(client, db_session):
    item, _, buyer = _sold_content(client, db_session)

    assert client.get(f"/content/{item['id']}", headers=buyer).json()["purchase_count"] == 0


# --- where a buyer finds what they bought ----------------------------------


def test_purchases_live_in_the_buyers_own_place(client, db_session):
    """What you paid for belongs in your space, not the seller's. Before this,
    the only route back to a purchase was remembering whose profile it was on —
    and a seller taking it down removed that route while the purchase stayed."""
    item, _, buyer = _sold_content(client, db_session)

    purchased = client.get("/content/purchased", headers=buyer).json()

    assert [row["id"] for row in purchased] == [item["id"]]


def test_a_purchase_stays_there_after_the_seller_deletes_it(client, db_session):
    item, seller, buyer = _sold_content(client, db_session)
    client.delete(f"/content/{item['id']}", headers=seller)

    purchased = client.get("/content/purchased", headers=buyer).json()

    assert [row["id"] for row in purchased] == [item["id"]]
    assert purchased[0]["is_deleted"] is True


def test_nobody_sees_anyone_elses_purchases(client, db_session):
    """In this app especially: what someone bought, and from whom, is theirs."""
    item, seller, _ = _sold_content(client, db_session)

    assert client.get("/content/purchased", headers=seller).json() == []


def test_the_database_itself_prevents_buying_the_same_item_twice(client, db_session):
    """Which is what keeps the purchased list from repeating a row per
    purchase — the join relies on it."""
    import pytest
    from sqlalchemy.exc import IntegrityError

    item, _, buyer = _sold_content(client, db_session)
    buyer_id = client.get("/me", headers=buyer).json()["id"]

    db_session.add(ContentPurchase(user_id=buyer_id, content_id=item["id"]))
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()
