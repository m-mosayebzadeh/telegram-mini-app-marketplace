"""Cosmos Team (section 37): the language a person uses the app in, and a
message's action ("close this session").

Revision ID: a8c2e6f0d4b7
Revises: f2a6c0e4b8d1
"""

import sqlalchemy as sa
from alembic import op

revision = 'a8c2e6f0d4b7'
down_revision = 'f2a6c0e4b8d1'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('users', sa.Column('language', sa.String(8), nullable=True))
    op.add_column('chat_messages', sa.Column('action', sa.String(64), nullable=True))


def downgrade() -> None:
    op.drop_column('chat_messages', 'action')
    op.drop_column('users', 'language')
