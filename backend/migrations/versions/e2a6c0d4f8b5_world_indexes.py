"""Indexes the world needs to pick one page of people without reading
everybody (section 32: nothing may scale with the number of people).

Revision ID: e2a6c0d4f8b5
Revises: d1f5b9c3e7a4
"""

from alembic import op

revision = 'e2a6c0d4f8b5'
down_revision = 'd1f5b9c3e7a4'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # The world orders by users.last_seen_at too; that index has existed
    # since the column did (f60c92a4ed18), so only the messages need one.
    op.execute(
        'CREATE INDEX IF NOT EXISTS ix_chat_messages_sender_created ON chat_messages (sender_id, created_at)'
    )


def downgrade() -> None:
    op.execute('DROP INDEX IF EXISTS ix_chat_messages_sender_created')
