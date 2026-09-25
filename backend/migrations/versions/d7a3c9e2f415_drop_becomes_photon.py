"""The currency is called Photon now, in the database too.

Revision ID: d7a3c9e2f415
Revises: c5e2a8f1b3d7

The owner renamed the app's currency from Drop to Photon — a particle of
light, in a product that is a night sky (TECHNICAL_REQUIREMENTS.md 29.14).
The columns follow, so that nobody reading the schema a year from now has
to remember that "drops" was once the name of the money.

Only names change. Postgres rewrites the CHECK constraints that mention a
renamed column by itself, and every amount keeps its value.
"""
from alembic import op

revision = 'd7a3c9e2f415'
down_revision = 'c5e2a8f1b3d7'
branch_labels = None
depends_on = None

RENAMES = [
    ('chat_sessions', 'block_price_drops', 'block_price_photons'),
    ('contents', 'price_drops', 'price_photons'),
    ('offers', 'price_drops', 'price_photons'),
    ('platform_rates', 'drop_to_toman_rate', 'photon_to_toman_rate'),
    ('topup_requests', 'requested_drops', 'requested_photons'),
    ('topup_requests', 'drop_rate_at_request', 'photon_rate_at_request'),
    ('transactions', 'gross_price_drops', 'gross_price_photons'),
    ('transactions', 'commission_drops', 'commission_photons'),
    ('transactions', 'net_provider_drops', 'net_provider_photons'),
    ('transactions', 'drop_to_toman_rate', 'photon_to_toman_rate'),
    ('withdrawals', 'drops', 'photons'),
    ('withdrawals', 'drop_rate', 'photon_rate'),
]


def upgrade():
    for table, old, new in RENAMES:
        op.alter_column(table, old, new_column_name=new)


def downgrade():
    for table, old, new in RENAMES:
        op.alter_column(table, new, new_column_name=old)
