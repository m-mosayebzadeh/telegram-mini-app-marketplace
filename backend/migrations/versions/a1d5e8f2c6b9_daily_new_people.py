"""One daily budget for meeting strangers, across "say hello" and Echo.

Revision ID: a1d5e8f2c6b9
Revises: f3c7a9e1d2b4

The owner's number: ten new people a day in total, editable from the panel.
It replaces a fixed twenty hellos a day that lived in code.
"""
from alembic import op
import sqlalchemy as sa

revision = 'a1d5e8f2c6b9'
down_revision = 'f3c7a9e1d2b4'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('platform_rates', sa.Column('daily_new_people', sa.Integer(), nullable=False, server_default='10'))
    op.drop_constraint('ck_positive_expiries', 'platform_rates', type_='check')
    op.create_check_constraint(
        'ck_positive_expiries',
        'platform_rates',
        'offer_expiry_days > 0 AND request_expiry_hours > 0 AND start_window_minutes > 0 AND daily_new_people > 0',
    )


def downgrade():
    op.drop_constraint('ck_positive_expiries', 'platform_rates', type_='check')
    op.create_check_constraint(
        'ck_positive_expiries',
        'platform_rates',
        'offer_expiry_days > 0 AND request_expiry_hours > 0 AND start_window_minutes > 0',
    )
    op.drop_column('platform_rates', 'daily_new_people')
