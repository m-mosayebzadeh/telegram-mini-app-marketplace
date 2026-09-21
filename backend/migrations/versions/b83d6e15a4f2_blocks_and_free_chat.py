"""Blocking someone, now that anyone can write to anyone.

Revision ID: b83d6e15a4f2
Revises: a71f3c90d284

Free messaging means an open channel to every user, so a way to close it is
not an extra feature — it is the other half of that decision.

One-directional and one-sided: A blocks B, and nothing about B's own choices
changes. The unique pair is what makes blocking twice harmless.
"""
from alembic import op
import sqlalchemy as sa

from app.core.time import UTCDateTime

revision = 'b83d6e15a4f2'
down_revision = 'a71f3c90d284'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'blocks',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('blocker_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('blocked_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('created_at', UTCDateTime(), nullable=False),
        sa.UniqueConstraint('blocker_id', 'blocked_id', name='uq_block_pair'),
    )
    op.create_index('ix_blocks_blocker_id', 'blocks', ['blocker_id'])
    op.create_index('ix_blocks_blocked_id', 'blocks', ['blocked_id'])


def downgrade():
    op.drop_index('ix_blocks_blocked_id', table_name='blocks')
    op.drop_index('ix_blocks_blocker_id', table_name='blocks')
    op.drop_table('blocks')
