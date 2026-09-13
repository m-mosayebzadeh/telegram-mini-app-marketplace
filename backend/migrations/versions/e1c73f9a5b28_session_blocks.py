"""A session reserves its price and settles block by block.

Revision ID: e1c73f9a5b28
Revises: d9b06f4e1c35

A session used to buy a fixed thing the moment it was paid for. It now reserves
the whole price, runs for a known length divided into equal blocks, and settles
only for the blocks actually used — so the transaction cannot be written until
the session ends and the final number exists.

Hence `transaction_id` becoming nullable, the frozen block plan copied onto the
session (so editing or deleting an offer cannot change what a running session
was sold as), and two new ledger row types for the hold and its release.
"""
from alembic import op
import sqlalchemy as sa
from app.core.time import UTCDateTime

revision = 'e1c73f9a5b28'
down_revision = 'd9b06f4e1c35'
branch_labels = None
depends_on = None

LEDGER_SOURCE_WITH_SESSIONS = (
    "(type IN ('topup_dev_stub', 'topup') AND transaction_id IS NULL AND withdrawal_id IS NULL) OR "
    "(type IN ('withdrawal', 'withdrawal_refund') AND transaction_id IS NULL AND withdrawal_id IS NOT NULL) OR "
    "(type = 'commission' AND ((transaction_id IS NOT NULL AND withdrawal_id IS NULL) OR "
    "(transaction_id IS NULL AND withdrawal_id IS NOT NULL))) OR "
    "(type IN ('spend', 'receive') AND transaction_id IS NOT NULL AND withdrawal_id IS NULL) OR "
    "(type IN ('session_hold', 'session_hold_release') AND chat_session_id IS NOT NULL)"
)
LEDGER_SOURCE_BEFORE = (
    "(type IN ('topup_dev_stub', 'topup') AND transaction_id IS NULL AND withdrawal_id IS NULL) OR "
    "(type IN ('withdrawal', 'withdrawal_refund') AND transaction_id IS NULL AND withdrawal_id IS NOT NULL) OR "
    "(type = 'commission' AND ((transaction_id IS NOT NULL AND withdrawal_id IS NULL) OR "
    "(transaction_id IS NULL AND withdrawal_id IS NOT NULL))) OR "
    "(type IN ('spend', 'receive') AND transaction_id IS NOT NULL AND withdrawal_id IS NULL)"
)


def upgrade():
    with op.batch_alter_table('chat_sessions') as batch:
        batch.alter_column('transaction_id', existing_type=sa.Integer(), nullable=True)
        for column in ('reserved_blocks', 'block_duration_seconds', 'block_price_drops',
                       'block_price_toman', 'reserved_toman', 'released_toman',
                       'consumed_toman', 'consumed_blocks'):
            batch.add_column(sa.Column(column, sa.Integer(), nullable=False, server_default='0'))
        batch.add_column(sa.Column('scheduled_end_at', UTCDateTime(), nullable=True))
        batch.add_column(sa.Column('close_at_block_end_by_user_id', sa.Integer(), nullable=True))
        batch.add_column(sa.Column('end_reason', sa.String(32), nullable=True))
        batch.create_foreign_key('fk_session_close_at_block_end_by', 'users',
                                 ['close_at_block_end_by_user_id'], ['id'])

    with op.batch_alter_table('credit_ledger_entries') as batch:
        batch.drop_constraint('ck_ledger_source', type_='check')
        batch.add_column(sa.Column('chat_session_id', sa.Integer(), nullable=True))
        batch.create_foreign_key('fk_ledger_chat_session', 'chat_sessions', ['chat_session_id'], ['id'])
        batch.create_check_constraint('ck_ledger_source', LEDGER_SOURCE_WITH_SESSIONS)


def downgrade():
    with op.batch_alter_table('credit_ledger_entries') as batch:
        batch.drop_constraint('ck_ledger_source', type_='check')
        batch.drop_constraint('fk_ledger_chat_session', type_='foreignkey')
        batch.drop_column('chat_session_id')
        batch.create_check_constraint('ck_ledger_source', LEDGER_SOURCE_BEFORE)

    with op.batch_alter_table('chat_sessions') as batch:
        batch.drop_constraint('fk_session_close_at_block_end_by', type_='foreignkey')
        batch.drop_column('end_reason')
        batch.drop_column('close_at_block_end_by_user_id')
        batch.drop_column('scheduled_end_at')
        for column in ('consumed_blocks', 'consumed_toman', 'released_toman', 'reserved_toman',
                       'block_price_toman', 'block_price_drops', 'block_duration_seconds',
                       'reserved_blocks'):
            batch.drop_column(column)
        batch.alter_column('transaction_id', existing_type=sa.Integer(), nullable=False)
