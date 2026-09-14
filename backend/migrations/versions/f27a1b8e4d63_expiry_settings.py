"""How long an offer and a request stay alive, editable from the panel.

Revision ID: f27a1b8e4d63
Revises: e93b7c0a5f14

A listing goes stale — an offer from somebody who has since left is worse than
no offer, because a buyer spends a request finding out — and a request nobody
answers holds the buyer's one-live-request slot while telling them nothing.

Both are read from here rather than fixed in code, because the right numbers
are a judgement about how busy the market is and that will change. Both are
enforced when something is read, not by anything that ticks.
"""
from alembic import op
import sqlalchemy as sa

revision = 'f27a1b8e4d63'
down_revision = 'e93b7c0a5f14'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('platform_rates') as batch:
        batch.add_column(sa.Column('offer_expiry_days', sa.Integer(), nullable=False,
                                   server_default='7'))
        batch.add_column(sa.Column('request_expiry_hours', sa.Integer(), nullable=False,
                                   server_default='24'))
        batch.create_check_constraint(
            'ck_positive_expiries', 'offer_expiry_days > 0 AND request_expiry_hours > 0'
        )


def downgrade():
    with op.batch_alter_table('platform_rates') as batch:
        batch.drop_constraint('ck_positive_expiries', type_='check')
        batch.drop_column('request_expiry_hours')
        batch.drop_column('offer_expiry_days')
