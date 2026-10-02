"""The "me" step: who may message you, hiding when you are online, the
eighteen-or-over confirmation, deleted accounts, and "report a problem".

Revision ID: b8d2f4a6c0e1
Revises: a3c7e1f5b9d2
"""

import sqlalchemy as sa
from alembic import op

revision = 'b8d2f4a6c0e1'
down_revision = 'a3c7e1f5b9d2'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # The paid door is gone with the paid layer; "only people I follow"
    # takes its place. Nobody can be left behind a door that no longer
    # exists, so a paid door becomes an open one.
    op.execute("UPDATE profiles SET chat_door = 'open' WHERE chat_door = 'paid'")
    op.drop_constraint('ck_profile_chat_door', 'profiles', type_='check')
    op.create_check_constraint('ck_profile_chat_door', 'profiles', "chat_door IN ('open', 'following')")

    op.add_column(
        'profiles',
        sa.Column('hide_online', sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column('users', sa.Column('adult_confirmed_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('users', sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True))

    op.create_table(
        'feedback',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('text', sa.String(1000), nullable=False),
        sa.Column('where', sa.String(120), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index('ix_feedback_user_id', 'feedback', ['user_id'])
    op.create_index('ix_feedback_created_at', 'feedback', ['created_at'])


def downgrade() -> None:
    op.drop_index('ix_feedback_created_at', 'feedback')
    op.drop_index('ix_feedback_user_id', 'feedback')
    op.drop_table('feedback')
    op.drop_column('users', 'deleted_at')
    op.drop_column('users', 'adult_confirmed_at')
    op.drop_column('profiles', 'hide_online')
    op.drop_constraint('ck_profile_chat_door', 'profiles', type_='check')
    op.create_check_constraint('ck_profile_chat_door', 'profiles', "chat_door IN ('open', 'paid')")
