"""Echo cards remember the interest groups two people share.

Revision ID: a3c7e1f5b9d2
Revises: f2b6d8a4c1e9
"""

import sqlalchemy as sa
from alembic import op

revision = 'a3c7e1f5b9d2'
down_revision = 'f2b6d8a4c1e9'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'echo_proposals',
        sa.Column('shared_groups', sa.JSON(), nullable=False, server_default='[]'),
    )


def downgrade() -> None:
    op.drop_column('echo_proposals', 'shared_groups')
