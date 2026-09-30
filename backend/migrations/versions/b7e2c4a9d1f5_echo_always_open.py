"""Echo can be open all day, from the panel, without losing its hours.

Revision ID: b7e2c4a9d1f5
Revises: a1d5e8f2c6b9
"""

import sqlalchemy as sa
from alembic import op

revision = 'b7e2c4a9d1f5'
down_revision = 'a1d5e8f2c6b9'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'feature_schedules',
        sa.Column('always_open', sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column('feature_schedules', 'always_open')
