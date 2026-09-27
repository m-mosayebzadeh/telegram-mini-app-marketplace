"""Who opened a conversation, for the daily cap on approaching strangers.

Revision ID: f3c7a9e1d2b4
Revises: e2b6d4a8c1f3

The cap counted every thread a person had joined in the last day, which
counted the people who wrote to them: twenty hellos locked somebody out of
greeting anyone, and development data did the same to the owner's test
account. It now counts only the threads a person opened themselves.
Existing threads have no opener recorded and count for nobody.
"""
from alembic import op
import sqlalchemy as sa

revision = 'f3c7a9e1d2b4'
down_revision = 'e2b6d4a8c1f3'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('conversations', sa.Column('opened_by_id', sa.Integer(), nullable=True))
    op.create_foreign_key('fk_conversations_opened_by_id', 'conversations', 'users', ['opened_by_id'], ['id'])
    op.create_index('ix_conversations_opened_by_id', 'conversations', ['opened_by_id'])


def downgrade():
    op.drop_index('ix_conversations_opened_by_id', 'conversations')
    op.drop_constraint('fk_conversations_opened_by_id', 'conversations', type_='foreignkey')
    op.drop_column('conversations', 'opened_by_id')
