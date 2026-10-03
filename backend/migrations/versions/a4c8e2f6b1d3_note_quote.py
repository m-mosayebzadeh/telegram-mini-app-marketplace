"""A message can answer somebody's note of the day, and keeps a copy of it
(section 32: the note is erased a day later; the reply must still make
sense).

Revision ID: a4c8e2f6b1d3
Revises: f3b7d1e9a2c6
"""

import sqlalchemy as sa
from alembic import op

revision = 'a4c8e2f6b1d3'
down_revision = 'f3b7d1e9a2c6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('chat_messages', sa.Column('note_quote', sa.String(60), nullable=True))


def downgrade() -> None:
    op.drop_column('chat_messages', 'note_quote')
