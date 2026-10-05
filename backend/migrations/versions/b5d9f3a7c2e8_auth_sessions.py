"""Sign-in sessions and the doors people come in through (section 32,
"signing in without Telegram").

Every existing person came in through Telegram, so each gets that door
recorded here; the Telegram id stops being required, because somebody who
comes in through Google or a phone number has none.

Revision ID: b5d9f3a7c2e8
Revises: a4c8e2f6b1d3
"""

import sqlalchemy as sa
from alembic import op

revision = 'b5d9f3a7c2e8'
down_revision = 'a4c8e2f6b1d3'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'auth_identities',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('provider', sa.String(16), nullable=False),
        sa.Column('subject', sa.String(128), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint('provider', 'subject', name='uq_auth_identity_door'),
    )
    op.create_index('ix_auth_identities_user_id', 'auth_identities', ['user_id'])
    op.create_table(
        'auth_sessions',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('token_hash', sa.String(64), nullable=False, unique=True),
        sa.Column('provider', sa.String(16), nullable=False),
        sa.Column('device', sa.String(80), nullable=False, server_default=''),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('last_used_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_auth_sessions_user_id', 'auth_sessions', ['user_id'])
    op.create_index('ix_auth_sessions_user_open', 'auth_sessions', ['user_id', 'revoked_at'])
    op.alter_column('users', 'telegram_id', existing_type=sa.BigInteger(), nullable=True)
    # Everybody so far came through Telegram; a deleted account (negative
    # id, let go of by "start again") has no door any more.
    op.execute(
        "INSERT INTO auth_identities (user_id, provider, subject, created_at) "
        "SELECT id, 'telegram', telegram_id::text, now() FROM users "
        "WHERE telegram_id IS NOT NULL AND telegram_id > 0 AND status <> 'deleted'"
    )


def downgrade() -> None:
    op.drop_table('auth_sessions')
    op.drop_table('auth_identities')
