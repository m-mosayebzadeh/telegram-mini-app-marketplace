"""Bank withdrawals and withdrawal-only commission settings.

Revision ID: 7d2c18a40e91
Revises: 0312f72d0c56
"""
from alembic import op
import sqlalchemy as sa
revision = '7d2c18a40e91'
down_revision = '0312f72d0c56'
branch_labels = None
depends_on = None

def upgrade():
    with op.batch_alter_table('platform_rates') as batch:
        batch.add_column(sa.Column('withdrawal_commission_percent', sa.Integer(), nullable=False, server_default='10'))
        batch.add_column(sa.Column('complaint_commission_percent', sa.Integer(), nullable=False, server_default='0'))
        batch.add_column(sa.Column('minimum_withdrawal_toman', sa.Integer(), nullable=False, server_default='500000'))
        batch.drop_column('chat_commission_percent')
        batch.drop_column('content_commission_percent')
        batch.create_check_constraint('ck_positive_financial_rates', 'star_to_toman_rate > 0 AND minimum_withdrawal_toman > 0')
        batch.create_check_constraint('ck_financial_percentages', 'withdrawal_commission_percent BETWEEN 0 AND 100 AND complaint_commission_percent BETWEEN 0 AND 100')
    op.create_table('bank_accounts',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('holder_name', sa.String(128), nullable=False),
        sa.Column('card_number', sa.String(16), nullable=False),
        sa.Column('iban', sa.String(26), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False))
    op.create_index('ix_bank_accounts_user_id', 'bank_accounts', ['user_id'])
    op.create_table('withdrawals',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('bank_account_id', sa.Integer(), sa.ForeignKey('bank_accounts.id'), nullable=False),
        sa.Column('idempotency_key', sa.String(64), nullable=False),
        sa.Column('holder_name', sa.String(128), nullable=False),
        sa.Column('card_number', sa.String(16), nullable=False),
        sa.Column('iban', sa.String(26), nullable=False),
        *[sa.Column(name, sa.Integer(), nullable=False) for name in ['stars','star_rate','fee_percent','minimum_toman','gross_toman','fee_toman','net_toman']],
        sa.Column('status', sa.String(24), nullable=False),
        sa.Column('assigned_to_user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('reference', sa.String(128), nullable=True),
        sa.Column('reason', sa.String(500), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.UniqueConstraint('user_id','idempotency_key',name='uq_withdrawal_retry'),
        sa.CheckConstraint("status IN ('pending','processing','bank_pending','paid','rejected','failed','cancelled')",name='ck_withdrawal_status'),
        sa.CheckConstraint('stars > 0 AND star_rate > 0 AND gross_toman = stars * star_rate AND fee_toman >= 0 AND net_toman > 0 AND fee_toman + net_toman = gross_toman',name='ck_withdrawal_amounts'),
        sa.CheckConstraint("status != 'paid' OR (reference IS NOT NULL AND length(trim(reference)) > 0)",name='ck_withdrawal_paid_reference'))
    op.create_index('ix_withdrawals_user_id','withdrawals',['user_id'])
    op.create_index('ix_withdrawals_status','withdrawals',['status'])
    op.create_table('withdrawal_events',
        sa.Column('id',sa.Integer(),primary_key=True),
        sa.Column('withdrawal_id',sa.Integer(),sa.ForeignKey('withdrawals.id'),nullable=False),
        sa.Column('actor_id',sa.Integer(),sa.ForeignKey('users.id'),nullable=False),
        sa.Column('status',sa.String(24),nullable=False),
        sa.Column('reference',sa.String(128),nullable=True),
        sa.Column('reason',sa.String(500),nullable=True),
        sa.Column('created_at',sa.DateTime(),nullable=False))
    op.create_index('ix_withdrawal_events_withdrawal_id','withdrawal_events',['withdrawal_id'])
    with op.batch_alter_table('credit_ledger_entries') as batch:
        batch.add_column(sa.Column('withdrawal_id',sa.Integer(),nullable=True))
        batch.add_column(sa.Column('star_purchase_id',sa.Integer(),nullable=True))
        batch.create_foreign_key('fk_ledger_withdrawal','withdrawals',['withdrawal_id'],['id'])
        batch.create_foreign_key('fk_ledger_star_purchase','star_purchases',['star_purchase_id'],['id'])
        batch.create_unique_constraint('uq_withdrawal_ledger_type',['withdrawal_id','type'])
        batch.create_unique_constraint('uq_ledger_star_purchase',['star_purchase_id'])
        batch.drop_constraint('ck_topup_entries_have_no_transaction',type_='check')
        batch.create_check_constraint('ck_ledger_source',
            "(type IN ('topup_dev_stub', 'topup') AND transaction_id IS NULL AND withdrawal_id IS NULL) OR "
            "(type IN ('withdrawal', 'withdrawal_refund') AND transaction_id IS NULL AND withdrawal_id IS NOT NULL) OR "
            "(type = 'commission' AND ((transaction_id IS NOT NULL AND withdrawal_id IS NULL) OR (transaction_id IS NULL AND withdrawal_id IS NOT NULL))) OR "
            "(type IN ('spend', 'receive') AND transaction_id IS NOT NULL AND withdrawal_id IS NULL)")

def downgrade():
    # Settled/held withdrawal money must never disappear through a schema rollback.
    bind = op.get_bind()
    if bind.execute(sa.text('SELECT COUNT(*) FROM withdrawals')).scalar():
        raise RuntimeError('Cannot downgrade with withdrawal records; restore a verified backup instead.')
    with op.batch_alter_table('credit_ledger_entries') as batch:
        batch.drop_constraint('ck_ledger_source',type_='check')
        batch.drop_constraint('uq_withdrawal_ledger_type',type_='unique')
        batch.drop_constraint('uq_ledger_star_purchase',type_='unique')
        batch.drop_constraint('fk_ledger_withdrawal',type_='foreignkey')
        batch.drop_constraint('fk_ledger_star_purchase',type_='foreignkey')
        batch.drop_column('withdrawal_id')
        batch.drop_column('star_purchase_id')
        batch.create_check_constraint('ck_topup_entries_have_no_transaction',
            "(type IN ('topup_dev_stub', 'topup') AND transaction_id IS NULL) OR (type NOT IN ('topup_dev_stub', 'topup') AND transaction_id IS NOT NULL)")
    op.drop_table('withdrawal_events')
    op.drop_table('withdrawals')
    op.drop_table('bank_accounts')
    with op.batch_alter_table('platform_rates') as batch:
        batch.drop_constraint('ck_positive_financial_rates',type_='check')
        batch.drop_constraint('ck_financial_percentages',type_='check')
        batch.add_column(sa.Column('chat_commission_percent',sa.Integer(),nullable=False,server_default='0'))
        batch.add_column(sa.Column('content_commission_percent',sa.Integer(),nullable=False,server_default='0'))
        batch.drop_column('withdrawal_commission_percent')
        batch.drop_column('complaint_commission_percent')
        batch.drop_column('minimum_withdrawal_toman')
