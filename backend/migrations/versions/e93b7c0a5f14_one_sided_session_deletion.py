"""Each participant can remove a finished conversation from their own side.

Revision ID: e93b7c0a5f14
Revises: d4e8a1f76b52

Archiving already keeps the list tidy, but an archive fills up too. Removing
follows the same shape as archiving and for the same reason: a conversation two
people took part in is not one of them to erase, so each side gets its own
timestamp and the other side's view is untouched. The messages are never
deleted — the other person is still reading them.
"""
from alembic import op
import sqlalchemy as sa
from app.core.time import UTCDateTime

revision = 'e93b7c0a5f14'
down_revision = 'd4e8a1f76b52'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('chat_sessions', sa.Column('deleted_by_buyer_at', UTCDateTime(), nullable=True))
    op.add_column('chat_sessions', sa.Column('deleted_by_provider_at', UTCDateTime(), nullable=True))


def downgrade():
    op.drop_column('chat_sessions', 'deleted_by_provider_at')
    op.drop_column('chat_sessions', 'deleted_by_buyer_at')
