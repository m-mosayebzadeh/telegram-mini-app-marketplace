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

from app.core.config import settings
from app.core.database import Base, get_db
from app.main import app


@pytest.fixture(autouse=True)
def isolated_uploads_dir(tmp_path):
    """
    Redirects settings.uploads_dir to a fresh, throwaway temp folder for
    every single test (autouse=True means every test gets this without
    asking for it by name) — otherwise a test that uploads a photo would
    write real files into this developer's actual backend/uploads/.

    pytest's built-in `tmp_path` fixture already creates and cleans up a
    unique directory per test on its own.
    """
    original = settings.uploads_dir
    settings.uploads_dir = tmp_path
    yield
    settings.uploads_dir = original


@pytest.fixture()
def db_engine():
    """
    The throwaway, in-memory database engine behind a test — split out
    from `client` below so a test can ALSO get a direct Session on this
    same database (via `db_session`) for setup that has no HTTP endpoint
    of its own, e.g. crediting a wallet directly (the real top-up
    endpoint is dev-tools-only, and tests deliberately run with dev
    tools off, matching production — see the env vars set above).

    StaticPool makes every connection from this engine reuse the same
    in-memory SQLite database instead of each one getting its own empty
    database (SQLite's normal in-memory behavior) — otherwise a row one
    connection creates wouldn't be visible to another.
    """
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    yield engine


@pytest.fixture()
def client(db_engine):
    """
    A TestClient wired to `db_engine` instead of the real app.db, via
    FastAPI's dependency_overrides mechanism — so running the test suite
    never reads or writes real local dev data.

    Shared across every test file: any test that needs to make HTTP
    requests against the app just adds `client` as a parameter and
    pytest injects this fixture automatically — no import needed.

    Note: this fixture never starts the app (no `with TestClient(...)`),
    so app.main's lifespan — which calls create_all against the *real*
    engine — never runs here either.
    """
    TestingSessionLocal = sessionmaker(bind=db_engine)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    yield TestClient(app)
    app.dependency_overrides.clear()


@pytest.fixture()
def db_session(db_engine):
    """
    A direct Session on the SAME database `client` uses within a test —
    for setup steps that have no HTTP endpoint, most notably crediting a
    wallet (see the `db_engine` docstring above for why this is needed
    instead of just calling the dev top-up endpoint).
    """
    TestingSessionLocal = sessionmaker(bind=db_engine)
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()
