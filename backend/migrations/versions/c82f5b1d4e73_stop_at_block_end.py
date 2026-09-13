"""Either side can ask the session to stop when the running block does.

Revision ID: c82f5b1d4e73
Revises: b4d97e2a8c31

It costs the same as closing immediately — the running block is paid for either
way — so what it buys is the rest of the time already paid for, plus protection
from an accident: without it, anyone who does not want the next block has to
watch the clock and press close before the boundary, and being a few seconds
late costs a whole block.

The boundary is stored rather than recalculated. A recalculated one would slide
forward into each new block, and the session would never actually stop.
"""
from alembic import op
import sqlalchemy as sa
from app.core.time import UTCDateTime

revision = 'c82f5b1d4e73'
down_revision = 'b4d97e2a8c31'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('chat_sessions') as batch:
        batch.add_column(sa.Column('close_at_block_end_at', UTCDateTime(), nullable=True))


def downgrade():
    with op.batch_alter_table('chat_sessions') as batch:
        batch.drop_column('close_at_block_end_at')
