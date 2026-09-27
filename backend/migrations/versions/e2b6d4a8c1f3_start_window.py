"""A requester has a limited time to pay once the offerer has confirmed.

Revision ID: e2b6d4a8c1f3
Revises: a4e8c1d6b2f9

Section 16 decided it long ago ("مهلت شروع پس از پذیرش", fifteen minutes,
editable from the panel) and it was never built, so a request confirmed and
never paid held the offerer's single open slot forever. The number lives
with the other deadlines on the rates row.
"""
from alembic import op
import sqlalchemy as sa

revision = 'e2b6d4a8c1f3'
down_revision = 'a4e8c1d6b2f9'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'platform_rates',
        sa.Column('start_window_minutes', sa.Integer(), nullable=False, server_default='15'),
    )
    op.drop_constraint('ck_positive_expiries', 'platform_rates', type_='check')
    op.create_check_constraint(
        'ck_positive_expiries',
        'platform_rates',
        'offer_expiry_days > 0 AND request_expiry_hours > 0 AND start_window_minutes > 0',
    )


def downgrade():
    op.drop_constraint('ck_positive_expiries', 'platform_rates', type_='check')
    op.create_check_constraint(
        'ck_positive_expiries', 'platform_rates', 'offer_expiry_days > 0 AND request_expiry_hours > 0'
    )
    op.drop_column('platform_rates', 'start_window_minutes')
