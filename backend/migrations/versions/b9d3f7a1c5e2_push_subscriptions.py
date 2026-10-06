"""Notifications when the app is closed (section 38).

Revision ID: b9d3f7a1c5e2
Revises: a8c2e6f0d4b7
"""

import sqlalchemy as sa
from alembic import op

revision = 'b9d3f7a1c5e2'
down_revision = 'a8c2e6f0d4b7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'push_subscriptions',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False, index=True),
        sa.Column('session_id', sa.Integer(), sa.ForeignKey('auth_sessions.id'), nullable=False, index=True),
        sa.Column('endpoint', sa.String(1000), nullable=False, unique=True),
        sa.Column('p256dh', sa.String(200), nullable=False),
        sa.Column('auth', sa.String(100), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table('push_subscriptions')
