"""A buyer can ask for one more block.

Revision ID: b4d97e2a8c31
Revises: a71e4c93b5d6

One block at a time, as often as they like, and always the buyer asking. A
provider cannot offer one: being able to would turn a conversation into a sales
pitch and bring back the incentive to stretch things out that selling time in
blocks exists to remove.

The block's price is held the moment it is asked for, so the provider's tap
cannot land on a wallet that has since emptied. A single timestamp is enough to
model it, because only one request can be outstanding at a time.
"""
from alembic import op
import sqlalchemy as sa
from app.core.time import UTCDateTime

revision = 'b4d97e2a8c31'
down_revision = 'a71e4c93b5d6'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('chat_sessions') as batch:
        batch.add_column(sa.Column('extension_requested_at', UTCDateTime(), nullable=True))


def downgrade():
    with op.batch_alter_table('chat_sessions') as batch:
        batch.drop_column('extension_requested_at')
