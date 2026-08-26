from logging.config import fileConfig

from sqlalchemy import engine_from_config
from sqlalchemy import pool

from alembic import context

# Importing app.core.database gets us Base (the shared declarative base
# every model attaches its table to). Importing app.models — not any one
# model directly — is what actually REGISTERS every model with
# Base.metadata (see that package's own docstring for why); without this
# import, target_metadata below would be empty and autogenerate would
# think every existing table should be dropped.
from app.core.config import settings
from app.core.database import Base
from app.core.time import UTCDateTime
from app import models  # noqa: F401

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# The app's own settings (backend/.env via pydantic-settings — see
# app/core/config.py) is the single source of truth for the database URL,
# not a second copy hardcoded in alembic.ini. This is also what makes
# migrations work against whichever database each machine/environment is
# actually configured for (a developer's local SQLite file today, a real
# Postgres URL once TECHNICAL_REQUIREMENTS.md's move to Postgres happens)
# without editing this file.
config.set_main_option("sqlalchemy.url", settings.database_url)

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# add your model's MetaData object here
# for 'autogenerate' support
target_metadata = Base.metadata


def render_item(type_, obj, autogen_context):
    """
    Every timestamp column in this app uses our own UTCDateTime type
    (app/core/time.py), not plain sa.DateTime — autogenerate correctly
    figures out it needs the dotted reference 'app.core.time.UTCDateTime'
    for a type it doesn't recognize, but (at least on this Alembic
    version) it does NOT add the matching import to the generated file,
    so the migration would fail with NameError the first time anyone
    actually ran it. This hook is what adds that import — the same
    mechanism autogenerate already uses internally for sa.Integer etc.,
    just pointed at our own type too. Returning False for anything else
    tells Alembic "render this the normal way," so only UTCDateTime
    columns are affected.
    """
    if type_ == "type" and isinstance(obj, UTCDateTime):
        autogen_context.imports.add("import app.core.time")
        return "app.core.time.UTCDateTime()"
    return False

# other values from the config, defined by the needs of env.py,
# can be acquired:
# my_important_option = config.get_main_option("my_important_option")
# ... etc.


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_item=render_item,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode.

    In this scenario we need to create an Engine
    and associate a connection with the context.

    """
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_item=render_item,
            # SQLite can't ALTER a column/constraint in place the way
            # Postgres can — Alembic works around this by rebuilding the
            # whole table (new table, copy rows, drop old, rename) under
            # the hood. render_as_batch=True is what turns that on; it's
            # a no-op (and harmless) on Postgres, so leaving it enabled
            # unconditionally keeps this file identical across both.
            render_as_batch=True,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
