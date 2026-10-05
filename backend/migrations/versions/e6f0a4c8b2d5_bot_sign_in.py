"""Signing in through our Telegram bot (section 32).

Revision ID: e6f0a4c8b2d5
Revises: d4b8e2f6a1c9
"""

import sqlalchemy as sa
from alembic import op

revision = 'e6f0a4c8b2d5'
down_revision = 'd4b8e2f6a1c9'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'auth_bot_requests',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('code', sa.String(32), nullable=False, unique=True),
        sa.Column('secret_hash', sa.String(64), nullable=False),
        sa.Column('device', sa.String(80), nullable=False, server_default=''),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('seen_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('telegram_id', sa.BigInteger(), nullable=True),
        sa.Column('first_name', sa.String(64), nullable=True),
        sa.Column('last_name', sa.String(64), nullable=True),
        sa.Column('username', sa.String(64), nullable=True),
        sa.Column('approved_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('refused_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('claimed_at', sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_table('auth_bot_requests')
