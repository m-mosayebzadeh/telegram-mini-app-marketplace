"""Remove the Telegram Stars top-up channel entirely.

Revision ID: c5a19e73d840
Revises: b8f4d21c6a07

Buying Drops with Telegram Stars is gone as a product decision, not as a
cleanup: it was the last thing tying the money side of the app to Telegram, and
Telegram's own settlement held the platform's real liquidity for about three
weeks behind an instant wallet credit. Card-to-card top-up stays as the way
money enters the wallet.

That takes the whole chain with it — the star_purchases table, the ledger's
link to a purchase, the Telegram-specific exchange rate, the bot payment
helpers, and the webhook that existed only to confirm those payments.

The ledger's source CHECK constraint is rewritten rather than merely reduced,
because it enumerated the purchase link by name.
"""
from alembic import op
import sqlalchemy as sa

revision = 'c5a19e73d840'
down_revision = 'b8f4d21c6a07'
branch_labels = None
depends_on = None

LEDGER_SOURCE_WITHOUT_STARS = (
    "(type IN ('topup_dev_stub', 'topup') AND transaction_id IS NULL AND withdrawal_id IS NULL) OR "
    "(type IN ('withdrawal', 'withdrawal_refund') AND transaction_id IS NULL AND withdrawal_id IS NOT NULL) OR "
    "(type = 'commission' AND ((transaction_id IS NOT NULL AND withdrawal_id IS NULL) OR "
    "(transaction_id IS NULL AND withdrawal_id IS NOT NULL))) OR "
    "(type IN ('spend', 'receive') AND transaction_id IS NOT NULL AND withdrawal_id IS NULL)"
)


def upgrade():
    with op.batch_alter_table('credit_ledger_entries') as batch:
        # The column carries a foreign key and a unique constraint of its own,
        # both of which have to go before the column itself can.
        batch.drop_constraint('ck_ledger_source', type_='check')
        batch.drop_constraint('uq_ledger_star_purchase', type_='unique')
        batch.drop_constraint('fk_ledger_star_purchase', type_='foreignkey')
        batch.drop_column('star_purchase_id')
        batch.create_check_constraint('ck_ledger_source', LEDGER_SOURCE_WITHOUT_STARS)

    with op.batch_alter_table('platform_rates') as batch:
        batch.drop_constraint('ck_positive_financial_rates', type_='check')
        batch.drop_column('telegram_star_to_toman_rate')
        batch.create_check_constraint(
            'ck_positive_financial_rates',
            'drop_to_toman_rate > 0 AND minimum_withdrawal_toman > 0',
        )

    op.drop_table('star_purchases')


def downgrade():
    # Recreated bare: the rows themselves are gone for good, and nothing in the
    # application reads this table any more.
    op.create_table(
        'star_purchases',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('stars', sa.Integer(), nullable=False),
        sa.Column('invoice_payload', sa.String(64), nullable=False, unique=True),
        sa.Column('telegram_payment_charge_id', sa.String(128), nullable=True),
        sa.Column('status', sa.String(16), nullable=False, server_default='pending'),
        sa.Column('created_at', sa.DateTime(), nullable=False),
    )
    with op.batch_alter_table('platform_rates') as batch:
        batch.drop_constraint('ck_positive_financial_rates', type_='check')
        batch.add_column(sa.Column('telegram_star_to_toman_rate', sa.Integer(), nullable=False,
                                   server_default='2500'))
        batch.create_check_constraint(
            'ck_positive_financial_rates',
            'drop_to_toman_rate > 0 AND telegram_star_to_toman_rate > 0 AND minimum_withdrawal_toman > 0',
        )
    with op.batch_alter_table('credit_ledger_entries') as batch:
        batch.add_column(sa.Column('star_purchase_id', sa.Integer(), nullable=True))
        batch.create_foreign_key('fk_ledger_star_purchase', 'star_purchases',
                                 ['star_purchase_id'], ['id'])
        batch.create_unique_constraint('uq_ledger_star_purchase', ['star_purchase_id'])
