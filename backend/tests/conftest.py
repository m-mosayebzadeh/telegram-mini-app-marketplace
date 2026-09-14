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
import uuid

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-bot-token-for-pytest-only")
os.environ.setdefault("ENABLE_DEV_TOOLS", "false")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.core.database import Base, get_db
from app.main import app

# Tests run on Postgres, the same engine production does.
#
# They used to run on in-memory SQLite, which was faster and needed nothing
# installed — but this codebase's hardest rules are about money and about what
# two requests racing each other are allowed to see, and those depend entirely
# on how the database takes locks. Proving them on a different engine from the
# one that will run them proves nothing.
TEST_DATABASE_URL = os.environ.setdefault(
    "TEST_DATABASE_URL",
    "postgresql+psycopg://marketplace:devpass@localhost:5433/marketplace",
)


def _admin_engine():
    """A connection outside any test database, for creating and dropping them."""
    return create_engine(TEST_DATABASE_URL, isolation_level="AUTOCOMMIT")


@pytest.fixture(autouse=True)
def isolated_uploads_dir(tmp_path):
    """
    Redirects settings.uploads_dir to a fresh, throwaway temp folder for
    every single test (autouse=True means every test gets this without
    asking for it by name) — otherwise a test that uploads content would
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
    A throwaway Postgres database, created and dropped around each test.

    One database per test rather than one schema that gets emptied: a test can
    then open several real connections at once — which the concurrency tests
    need — without any of them seeing another test's rows.
    """
    name = f"test_{uuid.uuid4().hex}"
    admin = _admin_engine()
    with admin.connect() as connection:
        connection.execute(text(f'CREATE DATABASE "{name}"'))
    admin.dispose()

    url = TEST_DATABASE_URL.rsplit("/", 1)[0] + "/" + name
    engine = create_engine(url)
    Base.metadata.create_all(bind=engine)
    try:
        yield engine
    finally:
        engine.dispose()
        admin = _admin_engine()
        with admin.connect() as connection:
            # Anything still attached would block the drop; tests that leak a
            # connection should fail loudly here rather than leave a database
            # behind.
            connection.execute(
                text(
                    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                    f"WHERE datname = '{name}' AND pid <> pg_backend_pid()"
                )
            )
            connection.execute(text(f'DROP DATABASE IF EXISTS "{name}"'))
        admin.dispose()


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
