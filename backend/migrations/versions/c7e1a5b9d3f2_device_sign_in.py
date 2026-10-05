"""Signing in a new device with a phone already signed in (section 32).

Revision ID: c7e1a5b9d3f2
Revises: b5d9f3a7c2e8
"""

import sqlalchemy as sa
from alembic import op

revision = 'c7e1a5b9d3f2'
down_revision = 'b5d9f3a7c2e8'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'auth_device_requests',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('code', sa.String(12), nullable=False, unique=True),
        sa.Column('secret_hash', sa.String(64), nullable=False),
        sa.Column('device', sa.String(80), nullable=False, server_default=''),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('approved_by_user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('approved_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('refused_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('claimed_at', sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_table('auth_device_requests')
