"""add platform rates

Revision ID: 9c1f2a7e4b3d
Revises: 732f56f522ee
Create Date: 2026-08-31 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

from app.core.time import UTCDateTime


# revision identifiers, used by Alembic.
revision: str = '9c1f2a7e4b3d'
down_revision: Union[str, Sequence[str], None] = '732f56f522ee'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # A brand-new table with no CHECK constraints, so — unlike several
    # earlier migrations in this project — there's no SQLite
    # autogenerate blind spot to work around here; a plain create_table
    # is enough. The single row itself is created lazily at first read
    # (see app/core/rates.py's get_rates()), not seeded here, so this
    # works the same for a fresh database and an existing one.
    op.create_table(
        'platform_rates',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('star_to_toman_rate', sa.Integer(), nullable=False),
        sa.Column('chat_commission_percent', sa.Integer(), nullable=False),
        sa.Column('content_commission_percent', sa.Integer(), nullable=False),
        sa.Column('updated_at', UTCDateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )


def downgrade() -> None:
    op.drop_table('platform_rates')
