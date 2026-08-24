"""
Integration test for GET /me: the full chain from a raw initData string,
through FastAPI's dependency chain (_get_telegram_user ->
get_current_user), to an actual User row — using FastAPI's TestClient to
call the app in-process (no server needs to be running).

Unlike test_telegram_auth.py (which tests validate_init_data alone),
this exercises real HTTP responses (status codes, JSON body) and a real
(but isolated, in-memory) database. The `client` fixture used below comes
from conftest.py.
"""

from app.core.config import settings
from tests.helpers import sign_init_data


def test_me_requires_init_data_header(client):
    response = client.get("/me")

    # FastAPI's own validation for a missing required header.
    assert response.status_code == 422


def test_me_rejects_tampered_signature(client):
    init_data = sign_init_data({"id": 1, "first_name": "X"})

    response = client.get(
        "/me", headers={"X-Telegram-Init-Data": init_data + "tampered"}
    )

    assert response.status_code == 401


def test_me_creates_user_on_first_login(client):
    init_data = sign_init_data({"id": 555, "first_name": "Reza", "username": "reza_dev"})

    response = client.get("/me", headers={"X-Telegram-Init-Data": init_data})

    assert response.status_code == 200
    body = response.json()
    assert body["telegram_id"] == 555
    assert body["display_name"] == "Reza"
    assert body["username"] == "reza_dev"
    assert body["status"] == "active"
    # Regression guard: joined_at must be an unambiguous UTC timestamp,
    # not a naive one that looks like (but isn't) local time.
    assert body["joined_at"].endswith("+00:00")


def test_me_reuses_existing_user_on_second_login(client):
    init_data_1 = sign_init_data({"id": 777, "first_name": "Ali"})
    first = client.get("/me", headers={"X-Telegram-Init-Data": init_data_1}).json()

    # A second, freshly-signed initData for the SAME telegram id — like
    # opening the mini app again later.
    init_data_2 = sign_init_data({"id": 777, "first_name": "Ali"})
    second = client.get("/me", headers={"X-Telegram-Init-Data": init_data_2}).json()

    assert first["id"] == second["id"]


def test_pricing_config_matches_current_settings(client):
    """GET /pricing — what CreateOffer.tsx and OfferDetail.tsx use to
    show a Toman/commission breakdown without a round trip per keystroke
    (see app/main.py's read_pricing_config)."""
    init_data = sign_init_data({"id": 1, "first_name": "Alice"})

    response = client.get("/pricing", headers={"X-Telegram-Init-Data": init_data})

    assert response.status_code == 200
    body = response.json()
    assert body["star_to_toman_rate"] == settings.star_to_toman_rate
    assert body["chat_commission_percent"] == settings.chat_commission_percent
    assert body["content_commission_percent"] == settings.content_commission_percent
