"""add per-viewer chat session archive flags

Revision ID: 2af8c0262f96
Revises: 24933f06d7ed
Create Date: 2026-08-28 17:52:54.347367

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '2af8c0262f96'
down_revision: Union[str, Sequence[str], None] = '24933f06d7ed'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # NOTE: autogenerate also proposed dropping+recreating the
    # users.username uniqueness as a table-level constraint instead of
    # the unique INDEX the previous migration actually created it as
    # (uq_users_username). Left out on purpose: a unique index and a
    # unique constraint are enforced identically in SQLite (a constraint
    # IS an index internally) — this is a harmless representation
    # difference in how autogenerate compares the two, not a real
    # schema change, and isn't worth a table rebuild to "fix."
    with op.batch_alter_table('chat_sessions', schema=None) as batch_op:
        batch_op.add_column(sa.Column('archived_by_buyer', sa.Boolean(), nullable=False, server_default=sa.false()))
        batch_op.add_column(sa.Column('archived_by_provider', sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    with op.batch_alter_table('chat_sessions', schema=None) as batch_op:
        batch_op.drop_column('archived_by_provider')
        batch_op.drop_column('archived_by_buyer')
