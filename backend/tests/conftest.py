"""
Shared pytest setup, loaded automatically before any test file in this
folder.

app.core.config creates its `settings` singleton (which requires
TELEGRAM_BOT_TOKEN) the moment it's imported. If a test file imports
anything from `app` and no .env file exists yet (e.g. a fresh clone, or
CI) that import would crash before a single test runs. Setting a fixed
value here — before any test module gets to `import app...` — means the
test suite never depends on a developer's local .env file.

pytest guarantees conftest.py in a directory is loaded before the test
modules inside it, so this always runs first.
"""

import os

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-bot-token-for-pytest-only")
os.environ.setdefault("ENABLE_DEV_TOOLS", "false")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.main import app


@pytest.fixture()
def client():
    """
    A TestClient wired to a throwaway, in-memory database instead of the
    real app.db, via FastAPI's dependency_overrides mechanism — so
    running the test suite never reads or writes real local dev data.

    Shared across every test file: any test that needs to make HTTP
    requests against the app just adds `client` as a parameter and
    pytest injects this fixture automatically — no import needed.

    StaticPool makes every connection from this engine reuse the same
    in-memory SQLite database instead of each one getting its own empty
    database (SQLite's normal in-memory behavior) — otherwise a row one
    request creates wouldn't be visible to the next.

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
