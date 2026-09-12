"""Restore purchase commissions and zero the withdrawal commission.

Revision ID: a3e7c41b8d92
Revises: 7d2c18a40e91

Reverses a product decision, not a bug: revision 7d2c18a40e91 had moved the
platform's revenue from the purchase to the cash-out. That charged a provider
at the moment they collect their own earnings, and — because withdrawals are
checked against the whole wallet balance — it could also take a cut of money a
user had merely topped up and never spent. Commission goes back onto the
purchase (for a chat, only once the session closed cleanly and the transaction
is released), and the withdrawal commission stays as a lever fixed at 0.

Existing rows keep their frozen numbers; only future transactions are affected.
"""
from alembic import op
import sqlalchemy as sa

revision = 'a3e7c41b8d92'
down_revision = '7d2c18a40e91'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('platform_rates') as batch:
        # server_default carries the values onto the existing singleton row;
        # the ORM model holds the same defaults for freshly created rows.
        batch.add_column(sa.Column('chat_commission_percent', sa.Integer(), nullable=False, server_default='10'))
        batch.add_column(sa.Column('content_commission_percent', sa.Integer(), nullable=False, server_default='5'))
        batch.create_check_constraint(
            'ck_purchase_commission_percentages',
            'chat_commission_percent BETWEEN 0 AND 100 AND content_commission_percent BETWEEN 0 AND 100',
        )
    # The lever stays in the schema; only its value changes. Done as an UPDATE
    # rather than a default change so an already-deployed 10% stops applying.
    op.execute('UPDATE platform_rates SET withdrawal_commission_percent = 0')


def downgrade():
    with op.batch_alter_table('platform_rates') as batch:
        batch.drop_constraint('ck_purchase_commission_percentages', type_='check')
        batch.drop_column('content_commission_percent')
        batch.drop_column('chat_commission_percent')
