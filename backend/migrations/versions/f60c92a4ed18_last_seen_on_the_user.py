"""When somebody was last here.

Revision ID: f60c92a4ed18
Revises: e4b71c082d59

The world needs to know who is present right now: the ring around an orb
means that and nothing else. Written on authenticated requests, but only
once a minute — a column updated on literally every request would turn
every read in the app into a write.

Null means never seen since this existed, which reads as offline. That is
the right way round: somebody wrongly shown as away is a small thing,
somebody wrongly shown as here is a wasted message.
"""
from alembic import op
import sqlalchemy as sa

from app.core.time import UTCDateTime

revision = 'f60c92a4ed18'
down_revision = 'e4b71c082d59'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('users', sa.Column('last_seen_at', UTCDateTime(), nullable=True))
    op.create_index('ix_users_last_seen_at', 'users', ['last_seen_at'])


def downgrade():
    op.drop_index('ix_users_last_seen_at', table_name='users')
    op.drop_column('users', 'last_seen_at')
