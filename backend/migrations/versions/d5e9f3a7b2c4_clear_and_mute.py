"""Clearing a chat's history no longer takes it out of the list; deleting
the chat does. And a chat can be muted.

Revision ID: d5e9f3a7b2c4
Revises: c4d8e2f6a1b3
"""

import sqlalchemy as sa
from alembic import op

revision = 'd5e9f3a7b2c4'
down_revision = 'c4d8e2f6a1b3'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'conversation_participants',
        sa.Column('hidden_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        'conversation_participants',
        sa.Column('muted', sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    # Until now clearing always took the thread out of the list, so every
    # thread cleared before this change was, in today's words, deleted.
    op.execute('UPDATE conversation_participants SET hidden_at = cleared_at WHERE cleared_at IS NOT NULL')


def downgrade() -> None:
    op.drop_column('conversation_participants', 'muted')
    op.drop_column('conversation_participants', 'hidden_at')
