"""Replying to, editing, deleting and reacting to messages.

Revision ID: c5e2a8f1b3d7
Revises: b41f7c2d9e80

Nothing here ever removes a row. An edit keeps the previous text in
message_edits, deleting for everyone sets a time on the message, and
deleting for yourself adds a row to hidden_messages — so staff can always
see what was said, which a guarantee around paying strangers depends on.
"""
from alembic import op
import sqlalchemy as sa

from app.core.time import UTCDateTime

revision = 'c5e2a8f1b3d7'
down_revision = 'b41f7c2d9e80'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('chat_messages', sa.Column('reply_to_id', sa.Integer(), nullable=True))
    op.create_foreign_key(
        'fk_chat_messages_reply_to_id', 'chat_messages', 'chat_messages', ['reply_to_id'], ['id']
    )
    op.add_column('chat_messages', sa.Column('edited_at', UTCDateTime(), nullable=True))
    op.add_column('chat_messages', sa.Column('deleted_at', UTCDateTime(), nullable=True))

    op.create_table(
        'message_edits',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('message_id', sa.Integer(), sa.ForeignKey('chat_messages.id'), nullable=False),
        sa.Column('previous_text', sa.String(length=4000), nullable=False),
        sa.Column('edited_at', UTCDateTime(), nullable=False),
    )
    op.create_index('ix_message_edits_message_id', 'message_edits', ['message_id'])

    op.create_table(
        'hidden_messages',
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), primary_key=True),
        sa.Column('message_id', sa.Integer(), sa.ForeignKey('chat_messages.id'), primary_key=True),
        sa.Column('hidden_at', UTCDateTime(), nullable=False),
    )

    op.create_table(
        'message_reactions',
        sa.Column('message_id', sa.Integer(), sa.ForeignKey('chat_messages.id'), primary_key=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), primary_key=True),
        sa.Column('emoji', sa.String(length=32), nullable=False),
        sa.Column('created_at', UTCDateTime(), nullable=False),
    )
    op.create_index('ix_message_reactions_user_id', 'message_reactions', ['user_id'])


def downgrade():
    op.drop_index('ix_message_reactions_user_id', 'message_reactions')
    op.drop_table('message_reactions')
    op.drop_table('hidden_messages')
    op.drop_index('ix_message_edits_message_id', 'message_edits')
    op.drop_table('message_edits')
    op.drop_column('chat_messages', 'deleted_at')
    op.drop_column('chat_messages', 'edited_at')
    op.drop_constraint('fk_chat_messages_reply_to_id', 'chat_messages', type_='foreignkey')
    op.drop_column('chat_messages', 'reply_to_id')
