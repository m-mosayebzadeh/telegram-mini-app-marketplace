"""The session clock starts when the provider arrives, not when money is held.

Revision ID: a71e4c93b5d6
Revises: f3a82d5c9017

A buyer should not pay for the seconds spent waiting for the other person to
show up, so the clock now starts on the provider's first message rather than at
the moment the price was reserved.

The useful side-effect is that a whole rule disappears. There used to be a
special case for a provider who never said anything — counted at closing time
and refunded by hand. Now that the clock only runs once they speak, a provider
who never arrives has sold no time at all, and the refund falls out of the
ordinary arithmetic instead of being an exception to it.

A reservation nobody started still expires, after the length the session was
sold as, so a forgotten one cleans itself up rather than sitting on the buyer's
money. That reuses a number the user already knows instead of inventing one.
"""
from alembic import op
import sqlalchemy as sa
from app.core.time import UTCDateTime

revision = 'a71e4c93b5d6'
down_revision = 'f3a82d5c9017'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('chat_sessions') as batch:
        batch.add_column(sa.Column('started_at', UTCDateTime(), nullable=True))
    # Anything already running was sold under the old rule, where holding the
    # money and starting the clock were the same moment. Keep those honest.
    op.execute('UPDATE chat_sessions SET started_at = opened_at')


def downgrade():
    with op.batch_alter_table('chat_sessions') as batch:
        batch.drop_column('started_at')
