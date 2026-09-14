"""Rename the pricing unit from Stars to Drops, and split the two rates apart.

Revision ID: b8f4d21c6a07
Revises: a3e7c41b8d92

Telegram Stars are no longer the unit this product is priced in — the Drop is,
at a fixed peg of 1000 Toman. Telegram becomes one way to BUY Drops, exactly
like a card transfer, which is what keeps the product portable off Telegram.

That is why `star_to_toman_rate` splits into two columns. It had been doing two
unrelated jobs: converting a price into wallet money (now `drop_to_toman_rate`,
a fixed peg) and converting a purchased Telegram Star into wallet money (now
`telegram_star_to_toman_rate`, a real exchange rate that floats). Rows that
genuinely describe Telegram Stars — star_purchases and its ledger link — keep
their names.

CHECK constraints that mention a renamed column are dropped and recreated
inside the same batch, since SQLite rebuilds the table for a rename and would
otherwise carry the old column name into the new definition.
"""
from alembic import op
import sqlalchemy as sa

revision = 'b8f4d21c6a07'
down_revision = 'a3e7c41b8d92'
branch_labels = None
depends_on = None

# Every existing row is dev data, so the peg is applied to the singleton rates
# row as a plain UPDATE rather than being carried over from the old rate.
DROP_PEG_TOMAN = 1000


def upgrade():
    with op.batch_alter_table('platform_rates') as batch:
        batch.drop_constraint('ck_positive_financial_rates', type_='check')
        batch.alter_column('star_to_toman_rate', new_column_name='drop_to_toman_rate')
        batch.add_column(sa.Column('telegram_star_to_toman_rate', sa.Integer(), nullable=False,
                                   server_default='2500'))
        batch.create_check_constraint(
            'ck_positive_financial_rates',
            'drop_to_toman_rate > 0 AND telegram_star_to_toman_rate > 0 AND minimum_withdrawal_toman > 0',
        )
    op.execute(f'UPDATE platform_rates SET drop_to_toman_rate = {DROP_PEG_TOMAN}')

    with op.batch_alter_table('transactions') as batch:
        batch.drop_constraint('ck_star_split_sums_to_gross', type_='check')
        batch.alter_column('gross_price_stars', new_column_name='gross_price_drops')
        batch.alter_column('commission_stars', new_column_name='commission_drops')
        batch.alter_column('net_provider_stars', new_column_name='net_provider_drops')
        batch.alter_column('star_to_toman_rate', new_column_name='drop_to_toman_rate')
        batch.create_check_constraint(
            'ck_drop_split_sums_to_gross',
            'commission_drops + net_provider_drops = gross_price_drops',
        )

    with op.batch_alter_table('offers') as batch:
        batch.alter_column('price_stars', new_column_name='price_drops')

    with op.batch_alter_table('contents') as batch:
        batch.drop_constraint('ck_price_matches_is_paid', type_='check')
        batch.alter_column('price_stars', new_column_name='price_drops')
        batch.create_check_constraint(
            'ck_price_matches_is_paid',
            '(is_paid AND price_drops IS NOT NULL) OR (NOT is_paid AND price_drops IS NULL)',
        )

    # A card-to-card top-up is denominated in the app's own unit too — only a
    # Telegram Stars purchase is actually in Stars.
    with op.batch_alter_table('topup_requests') as batch:
        batch.alter_column('requested_stars', new_column_name='requested_drops')
        batch.alter_column('star_rate_at_request', new_column_name='drop_rate_at_request')

    with op.batch_alter_table('withdrawals') as batch:
        batch.drop_constraint('ck_withdrawal_amounts', type_='check')
        batch.alter_column('stars', new_column_name='drops')
        batch.alter_column('star_rate', new_column_name='drop_rate')
        batch.create_check_constraint(
            'ck_withdrawal_amounts',
            'drops > 0 AND drop_rate > 0 AND gross_toman = drops * drop_rate AND fee_toman >= 0 '
            'AND net_toman > 0 AND fee_toman + net_toman = gross_toman',
        )


def downgrade():
    with op.batch_alter_table('withdrawals') as batch:
        batch.drop_constraint('ck_withdrawal_amounts', type_='check')
        batch.alter_column('drops', new_column_name='stars')
        batch.alter_column('drop_rate', new_column_name='star_rate')
        batch.create_check_constraint(
            'ck_withdrawal_amounts',
            'stars > 0 AND star_rate > 0 AND gross_toman = stars * star_rate AND fee_toman >= 0 '
            'AND net_toman > 0 AND fee_toman + net_toman = gross_toman',
        )

    with op.batch_alter_table('topup_requests') as batch:
        batch.alter_column('requested_drops', new_column_name='requested_stars')
        batch.alter_column('drop_rate_at_request', new_column_name='star_rate_at_request')

    with op.batch_alter_table('contents') as batch:
        batch.drop_constraint('ck_price_matches_is_paid', type_='check')
        batch.alter_column('price_drops', new_column_name='price_stars')
        batch.create_check_constraint(
            'ck_price_matches_is_paid',
            '(is_paid AND price_stars IS NOT NULL) OR (NOT is_paid AND price_stars IS NULL)',
        )

    with op.batch_alter_table('offers') as batch:
        batch.alter_column('price_drops', new_column_name='price_stars')

    with op.batch_alter_table('transactions') as batch:
        batch.drop_constraint('ck_drop_split_sums_to_gross', type_='check')
        batch.alter_column('gross_price_drops', new_column_name='gross_price_stars')
        batch.alter_column('commission_drops', new_column_name='commission_stars')
        batch.alter_column('net_provider_drops', new_column_name='net_provider_stars')
        batch.alter_column('drop_to_toman_rate', new_column_name='star_to_toman_rate')
        batch.create_check_constraint(
            'ck_star_split_sums_to_gross',
            'commission_stars + net_provider_stars = gross_price_stars',
        )

    with op.batch_alter_table('platform_rates') as batch:
        batch.drop_constraint('ck_positive_financial_rates', type_='check')
        batch.drop_column('telegram_star_to_toman_rate')
        batch.alter_column('drop_to_toman_rate', new_column_name='star_to_toman_rate')
        batch.create_check_constraint(
            'ck_positive_financial_rates',
            'star_to_toman_rate > 0 AND minimum_withdrawal_toman > 0',
        )
