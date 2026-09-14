"""
The migration and the models have to describe the same schema.

This used to replay the whole migration history and check that money survived
it. That history is gone — twenty-four migrations, several of them hand-written
SQLite that could never run on Postgres, were squashed into one baseline — and
with no real data yet there was nothing to carry across.

What matters from here on is the failure that squash makes possible: someone
changes a model and forgets the migration. Everything passes, because the test
suite builds its schema from the models; then the first real deployment runs
the migrations instead and gets a different database. This runs the real
migration against a real Postgres and compares the result to the models.
"""
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text

from app.core.config import settings
from app.core.database import Base
from tests.conftest import TEST_DATABASE_URL, _admin_engine


@pytest.fixture()
def migrated_database():
    """An empty database with the migrations run against it, and nothing else."""
    name = "test_migrated"
    admin = _admin_engine()
    with admin.connect() as connection:
        connection.execute(text(f'DROP DATABASE IF EXISTS "{name}"'))
        connection.execute(text(f'CREATE DATABASE "{name}"'))
    admin.dispose()

    url = TEST_DATABASE_URL.rsplit("/", 1)[0] + "/" + name
    # migrations/env.py sets the URL from settings itself, and does it after
    # anything passed in here — so point settings at the throwaway database
    # rather than fighting over the config value.
    original_url = settings.database_url
    settings.database_url = url
    try:
        command.upgrade(Config(str(Path(__file__).resolve().parents[1] / "alembic.ini")), "head")
    finally:
        settings.database_url = original_url

    engine = create_engine(url)
    try:
        yield engine
    finally:
        engine.dispose()
        admin = _admin_engine()
        with admin.connect() as connection:
            connection.execute(text(f'DROP DATABASE IF EXISTS "{name}"'))
        admin.dispose()


def test_the_migration_builds_the_schema_the_models_describe(migrated_database):
    """Every table, and every column of it. A model changed without a matching
    migration fails here, which is the whole reason this test exists."""
    inspector = inspect(migrated_database)
    migrated_tables = set(inspector.get_table_names()) - {"alembic_version"}

    assert migrated_tables == set(Base.metadata.tables)

    for name, table in Base.metadata.tables.items():
        columns = {c["name"] for c in inspector.get_columns(name)}
        assert columns == set(table.columns.keys()), name


def test_enums_are_stored_as_text_rather_than_postgres_types(migrated_database):
    """Deliberate: adding a value to a native Postgres enum later is an ALTER
    TYPE that cannot run inside a transaction. As text with a CHECK, a new
    value is an ordinary migration — and behaves the same on every engine."""
    with migrated_database.connect() as connection:
        created_types = connection.execute(
            text("SELECT typname FROM pg_type WHERE typtype = 'e'")
        ).fetchall()

    assert created_types == []


def test_the_migration_can_be_taken_back(migrated_database):
    """A migration nobody can reverse is a migration nobody can deploy with
    any confidence."""
    original_url = settings.database_url
    settings.database_url = migrated_database.url.render_as_string(hide_password=False)
    try:
        command.downgrade(Config(str(Path(__file__).resolve().parents[1] / "alembic.ini")), "base")
    finally:
        settings.database_url = original_url

    remaining = set(inspect(migrated_database).get_table_names()) - {"alembic_version"}
    assert remaining == set()
