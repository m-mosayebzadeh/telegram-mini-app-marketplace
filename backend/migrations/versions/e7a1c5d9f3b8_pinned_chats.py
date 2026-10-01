"""Chats can be pinned to the top of the list.

Revision ID: e7a1c5d9f3b8
Revises: d5e9f3a7b2c4
"""

import sqlalchemy as sa
from alembic import op

revision = 'e7a1c5d9f3b8'
down_revision = 'd5e9f3a7b2c4'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'conversation_participants',
        sa.Column('pinned_at', sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('conversation_participants', 'pinned_at')
