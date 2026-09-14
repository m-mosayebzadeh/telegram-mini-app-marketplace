"""split User.display_name into first_name/last_name

Revision ID: 3f1a9c7d2b40
Revises: 2af8c0262f96
Create Date: 2026-08-30 00:00:00.000000

Written by hand (not autogenerate) as a plain rebuild, the same
raw-SQL table-rebuild approach used to recover from the earlier batch
migration issues (see migrations/versions/24933f06d7ed's docstring) —
`users` is referenced by foreign keys from most other tables, so this
sticks to a straightforward CREATE + INSERT...SELECT + swap that keeps
every id exactly as it was, rather than routing through batch mode's
automatic (and here unnecessary) constraint-reflection machinery.

Existing rows: the old display_name value becomes first_name as-is
(whatever free text a user already had), last_name starts NULL — there
is no reliable way to un-combine an already-joined name string, so no
attempt is made to guess a split.
"""
from typing import Sequence, Union

from alembic import op


revision: str = '3f1a9c7d2b40'
down_revision: Union[str, Sequence[str], None] = '2af8c0262f96'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE users_new (
            id INTEGER NOT NULL,
            telegram_id BIGINT NOT NULL,
            first_name VARCHAR(128) NOT NULL,
            last_name VARCHAR(128),
            username VARCHAR(64),
            joined_at DATETIME NOT NULL,
            status VARCHAR(7) NOT NULL,
            PRIMARY KEY (id)
        )
        """
    )
    op.execute(
        """
        INSERT INTO users_new (id, telegram_id, first_name, last_name, username, joined_at, status)
        SELECT id, telegram_id, display_name, NULL, username, joined_at, status FROM users
        """
    )
    op.execute("DROP TABLE users")
    op.execute("ALTER TABLE users_new RENAME TO users")
    op.execute("CREATE UNIQUE INDEX ix_users_telegram_id ON users (telegram_id)")
    op.execute("CREATE UNIQUE INDEX uq_users_username ON users (username)")


def downgrade() -> None:
    op.execute(
        """
        CREATE TABLE users_old (
            id INTEGER NOT NULL,
            telegram_id BIGINT NOT NULL,
            display_name VARCHAR(128) NOT NULL,
            username VARCHAR(64),
            joined_at DATETIME NOT NULL,
            status VARCHAR(7) NOT NULL,
            PRIMARY KEY (id)
        )
        """
    )
    op.execute(
        """
        INSERT INTO users_old (id, telegram_id, display_name, username, joined_at, status)
        SELECT id, telegram_id,
               CASE WHEN last_name IS NOT NULL THEN first_name || ' ' || last_name ELSE first_name END,
               username, joined_at, status
        FROM users
        """
    )
    op.execute("DROP TABLE users")
    op.execute("ALTER TABLE users_old RENAME TO users")
    op.execute("CREATE UNIQUE INDEX ix_users_telegram_id ON users (telegram_id)")
