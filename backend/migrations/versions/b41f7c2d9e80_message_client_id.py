"""A name the sender's phone gives each message, so a resend is not a repeat.

Revision ID: b41f7c2d9e80
Revises: a93e51d07c24

On a weak connection a message can reach the server while the answer never
gets back, and the phone sends it again. The phone now names every message
before sending, and the server answers a name it has already seen with the
message it already saved.
"""
from alembic import op
import sqlalchemy as sa

revision = 'b41f7c2d9e80'
down_revision = 'a93e51d07c24'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('chat_messages', sa.Column('client_id', sa.String(length=64), nullable=True))
    op.create_unique_constraint(
        'uq_chat_message_sender_client_id', 'chat_messages', ['sender_id', 'client_id']
    )


def downgrade():
    op.drop_constraint('uq_chat_message_sender_client_id', 'chat_messages', type_='unique')
    op.drop_column('chat_messages', 'client_id')
