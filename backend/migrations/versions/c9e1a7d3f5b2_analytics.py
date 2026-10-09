"""analytics: active days and app events

What the app counts about itself (TECHNICAL_REQUIREMENTS.md section 43;
app/models/analytics.py). Counts only, never what anybody said.

Revision ID: c9e1a7d3f5b2
Revises: b4d8f2a6c1e3
"""
from alembic import op
import sqlalchemy as sa

revision = 'c9e1a7d3f5b2'
down_revision = 'b4d8f2a6c1e3'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'active_days',
        sa.Column('user_id', sa.BigInteger(), sa.ForeignKey('users.id'), primary_key=True),
        sa.Column('day', sa.Date(), primary_key=True),
    )
    op.create_index('ix_active_days_day', 'active_days', ['day'])
    op.create_table(
        'app_events',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('name', sa.String(32), nullable=False),
        sa.Column('user_id', sa.BigInteger(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('value', sa.Integer(), nullable=True),
        sa.Column('detail', sa.String(32), nullable=True),
    )
    op.create_index('ix_app_events_name_at', 'app_events', ['name', 'at'])


def downgrade() -> None:
    op.drop_index('ix_app_events_name_at', 'app_events')
    op.drop_table('app_events')
    op.drop_index('ix_active_days_day', 'active_days')
    op.drop_table('active_days')
