"""A thank-you from the provider, after the money has arrived.

Revision ID: a4e8c1d6b2f9
Revises: d7a3c9e2f415

One of three fixed reactions, sent at most once and never required
(TECHNICAL_REQUIREMENTS.md section 30.17). Two nullable columns; nothing
existing changes.
"""
import sqlalchemy as sa
from alembic import op

revision = 'a4e8c1d6b2f9'
down_revision = 'd7a3c9e2f415'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('chat_sessions', sa.Column('thanks_reaction', sa.String(length=16), nullable=True))
    op.add_column('chat_sessions', sa.Column('thanked_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column('chat_sessions', 'thanked_at')
    op.drop_column('chat_sessions', 'thanks_reaction')
