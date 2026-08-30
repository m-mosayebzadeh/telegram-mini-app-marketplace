"""make user username unique

Revision ID: 24933f06d7ed
Revises: baccd8850bb2
Create Date: 2026-08-26 20:27:39.814536

NOTE: autogenerate originally also proposed dropping the leftover
photos/photo_purchases/photo_open_logs tables and rebuilding
profiles/transactions (missing NOT NULL, a missing CHECK constraint, a
stale FK still pointing at the long-gone 'photos' table). All of that
was pre-existing drift on one specific development machine — a
database hand-patched across the Photo->Content rename before Alembic
was introduced, not a real difference between this revision and the
last. It was fixed by hand on that one database (mirroring the one-time
`alembic stamp head` step every pre-Alembic database needed — see
migrations/README.md) and deliberately left OUT of this file, so this
migration only records the one real, intentional schema change: making
usernames unique.
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '24933f06d7ed'
down_revision: Union[str, Sequence[str], None] = 'baccd8850bb2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.create_unique_constraint('uq_users_username', ['username'])


def downgrade() -> None:
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_constraint('uq_users_username', type_='unique')
