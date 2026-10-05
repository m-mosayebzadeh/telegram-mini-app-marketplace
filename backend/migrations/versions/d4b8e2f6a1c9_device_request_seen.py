"""When the phone opened a device sign-in request (section 32), so the
waiting device can say "now confirm on your phone".

Revision ID: d4b8e2f6a1c9
Revises: c7e1a5b9d3f2
"""

import sqlalchemy as sa
from alembic import op

revision = 'd4b8e2f6a1c9'
down_revision = 'c7e1a5b9d3f2'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('auth_device_requests', sa.Column('seen_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column('auth_device_requests', 'seen_at')
