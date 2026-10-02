"""The note of the day, and asking "eighteen or over" in Echo.

Revision ID: c9e3a5b7d1f2
Revises: b8d2f4a6c0e1
"""

import sqlalchemy as sa
from alembic import op

revision = 'c9e3a5b7d1f2'
down_revision = 'b8d2f4a6c0e1'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('profiles', sa.Column('note', sa.String(60), nullable=True))
    op.add_column('profiles', sa.Column('note_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        'feature_schedules',
        sa.Column('ask_adult', sa.Boolean(), nullable=False, server_default=sa.true()),
    )


def downgrade() -> None:
    op.drop_column('feature_schedules', 'ask_adult')
    op.drop_column('profiles', 'note_at')
    op.drop_column('profiles', 'note')
