"""An offer is a session: a real duration and a price that splits into blocks.

Revision ID: d9b06f4e1c35
Revises: c5a19e73d840

`display_duration_minutes` was decoration — the old model said in so many words
that nothing read it — and becomes `session_duration_seconds`, the length the
session actually runs for before closing itself.

Seconds rather than minutes because a session is divided into four equal
blocks: any whole number of minutes divides exactly by four once expressed in
seconds, while a count of minutes would not (30 minutes has no whole quarter).
Existing values are converted, not reinterpreted.

Both the price and the duration are constrained to whole blocks. That is what
lets every later block calculation be plain integer arithmetic, with no
fraction of a Drop left anywhere.
"""
from alembic import op
import sqlalchemy as sa

revision = 'd9b06f4e1c35'
down_revision = 'c5a19e73d840'
branch_labels = None
depends_on = None

BLOCKS = 4


def upgrade():
    with op.batch_alter_table('offers') as batch:
        batch.alter_column('display_duration_minutes', new_column_name='session_duration_seconds')
    op.execute('UPDATE offers SET session_duration_seconds = session_duration_seconds * 60')
    # Dev-only data, so prices are rounded up to the next whole block rather
    # than the rows being rejected by the constraint added just below.
    op.execute(
        f'UPDATE offers SET price_drops = (((price_drops + {BLOCKS - 1}) / {BLOCKS}) * {BLOCKS}) '
        f'WHERE price_drops % {BLOCKS} != 0'
    )
    with op.batch_alter_table('offers') as batch:
        batch.create_check_constraint(
            'ck_offer_price_divides_into_blocks',
            f'price_drops > 0 AND price_drops % {BLOCKS} = 0',
        )
        batch.create_check_constraint(
            'ck_offer_duration_divides_into_blocks',
            f'session_duration_seconds > 0 AND session_duration_seconds % {BLOCKS} = 0',
        )


def downgrade():
    with op.batch_alter_table('offers') as batch:
        batch.drop_constraint('ck_offer_duration_divides_into_blocks', type_='check')
        batch.drop_constraint('ck_offer_price_divides_into_blocks', type_='check')
    op.execute('UPDATE offers SET session_duration_seconds = session_duration_seconds / 60')
    with op.batch_alter_table('offers') as batch:
        batch.alter_column('session_duration_seconds', new_column_name='display_duration_minutes')
