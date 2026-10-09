"""support answers: locks, openings, and who wrote each team answer

Staff answer people who wrote to Cosmos Team (TECHNICAL_REQUIREMENTS.md
section 43; app/models/support.py).

Revision ID: b4d8f2a6c1e3
Revises: a8c3e5f1b7d9
"""
from alembic import op
import sqlalchemy as sa

revision = 'b4d8f2a6c1e3'
down_revision = 'a8c3e5f1b7d9'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('chat_messages', sa.Column('staff_id', sa.BigInteger(), sa.ForeignKey('users.id'), nullable=True))
    op.create_table(
        'support_locks',
        sa.Column('conversation_id', sa.Integer(), sa.ForeignKey('conversations.id'), primary_key=True),
        sa.Column('holder_id', sa.BigInteger(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('touched_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('handed', sa.Boolean(), server_default='false', nullable=False),
    )
    op.create_table(
        'support_openings',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('conversation_id', sa.Integer(), sa.ForeignKey('conversations.id'), nullable=False),
        sa.Column('staff_id', sa.BigInteger(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('opened_at', sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index('ix_support_openings_conversation_id', 'support_openings', ['conversation_id'])


def downgrade() -> None:
    op.drop_index('ix_support_openings_conversation_id', 'support_openings')
    op.drop_table('support_openings')
    op.drop_table('support_locks')
    op.drop_column('chat_messages', 'staff_id')
