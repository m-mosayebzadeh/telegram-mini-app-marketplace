"""Echo's waiting screen numbers can be switched off in the panel.

Revision ID: f2b6d8a4c1e9
Revises: e7a1c5d9f3b8
"""

import sqlalchemy as sa
from alembic import op

revision = 'f2b6d8a4c1e9'
down_revision = 'e7a1c5d9f3b8'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'feature_schedules',
        sa.Column('show_counts', sa.Boolean(), nullable=False, server_default=sa.true()),
    )


def downgrade() -> None:
    op.drop_column('feature_schedules', 'show_counts')
