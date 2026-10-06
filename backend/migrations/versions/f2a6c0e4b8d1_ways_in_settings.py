"""Managing the ways in from inside the account (section 36).

Revision ID: f2a6c0e4b8d1
Revises: e6f0a4c8b2d5
"""

import sqlalchemy as sa
from alembic import op

revision = 'f2a6c0e4b8d1'
down_revision = 'e6f0a4c8b2d5'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('auth_identities', sa.Column('label', sa.String(128), nullable=True))
    op.add_column('auth_sessions', sa.Column('confirmed_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('auth_sessions', sa.Column('google_state_hash', sa.String(64), nullable=True))
    op.add_column('auth_sessions', sa.Column('google_purpose', sa.String(8), nullable=True))
    op.create_index('ix_auth_sessions_google_state_hash', 'auth_sessions', ['google_state_hash'])
    op.add_column('auth_bot_requests', sa.Column('purpose', sa.String(8), nullable=False, server_default='sign_in'))
    op.add_column('auth_bot_requests', sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=True))
    op.add_column('auth_bot_requests', sa.Column('problem', sa.String(16), nullable=True))


def downgrade() -> None:
    op.drop_column('auth_bot_requests', 'problem')
    op.drop_column('auth_bot_requests', 'user_id')
    op.drop_column('auth_bot_requests', 'purpose')
    op.drop_index('ix_auth_sessions_google_state_hash', 'auth_sessions')
    op.drop_column('auth_sessions', 'google_purpose')
    op.drop_column('auth_sessions', 'google_state_hash')
    op.drop_column('auth_sessions', 'confirmed_at')
    op.drop_column('auth_identities', 'label')
