"""Whether notifications show what a message says (section 38).

Revision ID: c3e7a1d5f9b2
Revises: b9d3f7a1c5e2
"""

import sqlalchemy as sa
from alembic import op

revision = 'c3e7a1d5f9b2'
down_revision = 'b9d3f7a1c5e2'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('users', sa.Column('push_preview', sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    op.drop_column('users', 'push_preview')
