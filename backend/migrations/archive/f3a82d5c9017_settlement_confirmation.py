"""Either side can sign off on a finished session.

Revision ID: f3a82d5c9017
Revises: e1c73f9a5b28

The settlement window exists so an unhappy participant can freeze the money.
Once BOTH sides have said there is nothing to freeze, waiting out the rest of
it protects nobody, so the provider is paid immediately.

Recorded per side rather than as one flag because confirming gives up only the
confirming party's right to complain — the other keeps theirs.
"""
from alembic import op
import sqlalchemy as sa
from app.core.time import UTCDateTime

revision = 'f3a82d5c9017'
down_revision = 'e1c73f9a5b28'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('chat_sessions') as batch:
        batch.add_column(sa.Column('settlement_confirmed_by_buyer_at', UTCDateTime(), nullable=True))
        batch.add_column(sa.Column('settlement_confirmed_by_provider_at', UTCDateTime(), nullable=True))


def downgrade():
    with op.batch_alter_table('chat_sessions') as batch:
        batch.drop_column('settlement_confirmed_by_provider_at')
        batch.drop_column('settlement_confirmed_by_buyer_at')
