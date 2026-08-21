"""
Integration test for GET /me: the full chain from a raw initData string,
through FastAPI's dependency chain (_get_telegram_user ->
get_current_user), to an actual User row — using FastAPI's TestClient to
call the app in-process (no server needs to be running).

Unlike test_telegram_auth.py (which tests validate_init_data alone),
this exercises real HTTP responses (status codes, JSON body) and a real
(but isolated, in-memory) database.
"""

import hashlib
import hmac
import json
import time
from urllib.parse import urlencode

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import settings
from app.core.database import Base, get_db
from app.main import app


def _sign_init_data(user: dict) -> str:
    """Builds a validly-signed initData string, the same way Telegram does."""
    fields = {
        "auth_date": str(int(time.time())),
        "query_id": "AAFakeQueryId",
        "user": json.dumps(user, separators=(",", ":")),
    }
    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(fields.items()))
    secret_key = hmac.new(
        b"WebAppData", settings.telegram_bot_token.encode(), hashlib.sha256
    ).digest()
    fields["hash"] = hmac.new(
        secret_key, data_check_string.encode(), hashlib.sha256
    ).hexdigest()
    return urlencode(fields)


@pytest.fixture()
def client():
    """
    A TestClient wired to a throwaway, in-memory database instead of the
    real app.db, via FastAPI's dependency_overrides mechanism — so
    running the test suite never reads or writes real local dev data.

    StaticPool makes every connection from this engine reuse the same
    in-memory SQLite database instead of each one getting its own empty
    database (SQLite's normal in-memory behavior) — otherwise the row a
    test creates in one request wouldn't be visible in the next.

    Note: this fixture never starts the app (no `with TestClient(...)`),
    so app.main's lifespan — which calls create_all against the *real*
    engine — never runs here either.
    """
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(bind=engine)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_me_requires_init_data_header(client):
    response = client.get("/me")

    # FastAPI's own validation for a missing required header.
    assert response.status_code == 422


def test_me_rejects_tampered_signature(client):
    init_data = _sign_init_data({"id": 1, "first_name": "X"})

    response = client.get(
        "/me", headers={"X-Telegram-Init-Data": init_data + "tampered"}
    )

    assert response.status_code == 401


def test_me_creates_user_on_first_login(client):
    init_data = _sign_init_data({"id": 555, "first_name": "Reza", "username": "reza_dev"})

    response = client.get("/me", headers={"X-Telegram-Init-Data": init_data})

    assert response.status_code == 200
    body = response.json()
    assert body["telegram_id"] == 555
    assert body["display_name"] == "Reza"
    assert body["username"] == "reza_dev"
    assert body["status"] == "active"


def test_me_reuses_existing_user_on_second_login(client):
    init_data_1 = _sign_init_data({"id": 777, "first_name": "Ali"})
    first = client.get("/me", headers={"X-Telegram-Init-Data": init_data_1}).json()

    # A second, freshly-signed initData for the SAME telegram id — like
    # opening the mini app again later.
    init_data_2 = _sign_init_data({"id": 777, "first_name": "Ali"})
    second = client.get("/me", headers={"X-Telegram-Init-Data": init_data_2}).json()

    assert first["id"] == second["id"]
