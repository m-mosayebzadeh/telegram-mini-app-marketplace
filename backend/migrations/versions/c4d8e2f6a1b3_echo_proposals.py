"""Echo holds two people for each other while both decide.

Revision ID: c4d8e2f6a1b3
Revises: b7e2c4a9d1f5
"""

import sqlalchemy as sa
from alembic import op

revision = 'c4d8e2f6a1b3'
down_revision = 'b7e2c4a9d1f5'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'echo_proposals',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('user_a_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('user_b_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('shared_tags', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('accepted_by_a', sa.Boolean(), nullable=False),
        sa.Column('accepted_by_b', sa.Boolean(), nullable=False),
        sa.Column('outcome', sa.String(16), nullable=True),
        sa.Column('decided_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('declined_by_user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('session_id', sa.Integer(), sa.ForeignKey('random_chat_sessions.id'), nullable=True),
    )
    op.create_index('ix_echo_proposals_user_a_id', 'echo_proposals', ['user_a_id'])
    op.create_index('ix_echo_proposals_user_b_id', 'echo_proposals', ['user_b_id'])
    op.create_index('ix_echo_proposals_expires_at', 'echo_proposals', ['expires_at'])
    op.create_index('ix_echo_proposals_outcome', 'echo_proposals', ['outcome'])
    op.add_column(
        'feature_schedules',
        sa.Column('proposal_seconds', sa.Integer(), nullable=False, server_default='30'),
    )


def downgrade() -> None:
    op.drop_column('feature_schedules', 'proposal_seconds')
    op.drop_table('echo_proposals')
