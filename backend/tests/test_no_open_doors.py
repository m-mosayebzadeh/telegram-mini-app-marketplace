"""
No door opens with a number alone (TECHNICAL_REQUIREMENTS.md section 40).

People's ids are drawn at random so nobody can walk from one person to the
next by adding one. That hides the ids; it protects nothing by itself. What
protects people is that every route taking somebody's id checks what the
asker may see — these tests hold that line: the staff routes refuse
ordinary people, a block closes a profile both ways, and what somebody
spent is not anybody's to read.
"""

import re

import pytest
from fastapi.routing import APIRoute

from app.main import app
from app.models.block import Block
from app.models.offer import Offer
from app.models.request import Request
from app.models.user import ID_HIGH, ID_LOW, User, new_user_id
from tests.helpers import sign_init_data


def _as(telegram_id, name="Test"):
    return {"X-Telegram-Init-Data": sign_init_data({"id": telegram_id, "first_name": name})}


def _id(client, headers):
    return client.get("/me", headers=headers).json()["id"]


# --- the ids themselves ----------------------------------------------------------


def test_ids_are_drawn_at_random_not_counted(client):
    ids = [_id(client, _as(81000 + n)) for n in range(5)]
    assert all(ID_LOW <= i < ID_HIGH for i in ids)
    assert all(i < 2**53 for i in ids)  # held exactly by the app's JavaScript
    # Not one after another.
    assert sorted(ids) != list(range(min(ids), min(ids) + 5))


def test_drawing_ids_spreads_them_out():
    drawn = {new_user_id() for _ in range(2000)}
    assert len(drawn) == 2000
    assert all(len(str(i)) == 16 for i in drawn)


# --- the staff routes --------------------------------------------------------------

#: Asks only about the asker themself.
OPEN_TO_ANYBODY = {"/admin/me"}


def _staff_routes():
    for route in app.routes:
        if isinstance(route, APIRoute) and route.path.startswith("/admin") and route.path not in OPEN_TO_ANYBODY:
            for method in route.methods:
                yield method, route.path


@pytest.mark.parametrize("method,path", sorted(_staff_routes()))
def test_every_staff_route_refuses_an_ordinary_person(client, method, path):
    headers = _as(82001, "Nobody")
    client.get("/me", headers=headers)
    url = re.sub(r"\{[^}]+\}", "1", path)
    answer = client.request(method, url, headers=headers, json={})
    assert answer.status_code in (401, 403, 404, 422), (method, path, answer.status_code)
    if answer.status_code == 422:
        # A body the route could not read hides whether it would have let
        # this person in; send none and look at the answer again.
        again = client.request(method, url, headers=headers)
        assert again.status_code in (401, 403, 404, 422)


# --- a block closes a profile, both ways ----------------------------------------------

PROFILE_PAGES = ("", "/photos", "/provider-summary", "/followers", "/following")


def _pages(user_id, page):
    return f"/follow/{user_id}{page}" if page in ("/followers", "/following") else f"/profiles/{user_id}{page}"


def test_a_block_closes_the_profile_both_ways(client, db_session):
    sara, bob = _as(83001, "Sara"), _as(83002, "Bob")
    sara_id, bob_id = _id(client, sara), _id(client, bob)
    assert client.get(f"/profiles/{bob_id}", headers=sara).status_code == 200
    db_session.add(Block(blocker_id=bob_id, blocked_id=sara_id))
    db_session.commit()
    for page in PROFILE_PAGES:
        url_bob = _pages(bob_id, page)
        url_sara = _pages(sara_id, page)
        if client.get(url_bob, headers=_as(83003)).status_code == 404:
            continue  # a page that does not exist under this name
        assert client.get(url_bob, headers=sara).status_code == 404, page
        assert client.get(url_sara, headers=bob).status_code == 404, page
    # Each still sees their own.
    assert client.get(f"/profiles/{sara_id}", headers=sara).status_code == 200


# --- what somebody spent ------------------------------------------------------------


def test_what_somebody_spent_is_only_for_an_offerer_they_asked(client, db_session):
    sara, bob, stranger = _as(84001, "Sara"), _as(84002, "Bob"), _as(84003, "Stranger")
    sara_id, bob_id = _id(client, sara), _id(client, bob)
    _id(client, stranger)
    # A stranger with the id learns nothing.
    assert client.get(f"/profiles/{sara_id}/buyer-summary", headers=stranger).status_code == 404
    # Sara sees her own.
    assert client.get(f"/profiles/{sara_id}/buyer-summary", headers=sara).status_code == 200
    # Bob, once Sara has asked for one of his offers, may see it to decide.
    offer = Offer(provider_id=bob_id, title="Talk", price_photons=12, session_duration_seconds=1200, description="A talk")
    db_session.add(offer)
    db_session.flush()
    db_session.add(Request(offer_id=offer.id, buyer_id=sara_id))
    db_session.commit()
    assert client.get(f"/profiles/{sara_id}/buyer-summary", headers=bob).status_code == 200
    assert db_session.get(User, sara_id) is not None
